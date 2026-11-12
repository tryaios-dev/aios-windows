import { inflateRawSync } from "node:zlib";

/**
 * A small, strict ZIP reader for evidence export bundles (spec section 10).
 *
 * Accepts: a single-disk archive without ZIP64, entries stored (0) or deflated (8), no
 * encryption, no directories, no symlinks, no duplicate names, names without path separators.
 * The central directory is authoritative and must agree with each local header. Entries are
 * inflated with a hard output cap, and their size and CRC-32 are checked.
 */

export class ZipError extends Error {
  override readonly name = "ZipError";
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

export interface ZipEntry {
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  /** Offset of the entry data (after the local header). */
  dataOffset: number;
}

export interface ZipArchive {
  readonly entries: ReadonlyMap<string, ZipEntry>;
  /** Inflate one entry; throws ZipError if it would exceed maxBytes or fails its checks. */
  extract(name: string, maxBytes: number): Uint8Array;
}

let crcTable: Uint32Array | undefined;

export function crc32(data: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = crcTable[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const MAX_ENTRIES = 16;
const MAX_NAME = 255;

function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (22 + 0xffff));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD && i + 22 + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new ZipError("end of central directory not found");
}

const asciiOrUtf8 = new TextDecoder("utf-8", { fatal: true });

export function readZip(input: Uint8Array): ZipArchive {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (buf.length < 22) throw new ZipError("too short to be a ZIP archive");
  const eocd = findEocd(buf);
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_ZIP64_LOCATOR) throw new ZipError("ZIP64 is not supported");
  const disk = buf.readUInt16LE(eocd + 4);
  const cdDisk = buf.readUInt16LE(eocd + 6);
  const countDisk = buf.readUInt16LE(eocd + 8);
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (disk !== 0 || cdDisk !== 0 || countDisk !== count) throw new ZipError("multi-disk archives are not supported");
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError("ZIP64 is not supported");
  if (count > MAX_ENTRIES) throw new ZipError("too many entries");
  if (cdOffset + cdSize !== eocd) throw new ZipError("central directory does not end at the end record");

  const entries = new Map<string, ZipEntry>();
  const spans: [number, number][] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > eocd || buf.readUInt32LE(p) !== SIG_CENTRAL) throw new ZipError("bad central directory entry");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const diskStart = buf.readUInt16LE(p + 34);
    const external = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    const end = p + 46 + nameLen + extraLen + commentLen;
    if (end > eocd) throw new ZipError("central directory entry overruns");
    if (nameLen === 0 || nameLen > MAX_NAME) throw new ZipError("bad entry name length");
    let name: string;
    try {
      name = asciiOrUtf8.decode(buf.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new ZipError("entry name is not UTF-8");
    }
    if (flags & 0x0001 || flags & 0x0040) throw new ZipError("encrypted entries are not supported");
    if (method !== 0 && method !== 8) throw new ZipError("unsupported compression method");
    if (diskStart !== 0) throw new ZipError("multi-disk archives are not supported");
    if (/[/\\]/.test(name) || name.includes("\u0000")) throw new ZipError("directories and paths are not allowed");
    if (external & 0x10) throw new ZipError("directory entries are not allowed");
    const unixType = (external >>> 16) & 0o170000;
    if (unixType !== 0 && unixType !== 0o100000) throw new ZipError("only regular files are allowed");
    if (csize === 0xffffffff || usize === 0xffffffff || localOffset === 0xffffffff) throw new ZipError("ZIP64 is not supported");
    if (method === 0 && csize !== usize) throw new ZipError("stored entry sizes disagree");
    if (entries.has(name)) throw new ZipError("duplicate entry name");

    // Local header must agree with the central directory.
    if (localOffset + 30 > cdOffset || buf.readUInt32LE(localOffset) !== SIG_LOCAL) throw new ZipError("bad local header");
    const lFlags = buf.readUInt16LE(localOffset + 6);
    const lMethod = buf.readUInt16LE(localOffset + 8);
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    if (lFlags & 0x0001 || lFlags & 0x0040) throw new ZipError("encrypted entries are not supported");
    if (lMethod !== method || lNameLen !== nameLen) throw new ZipError("local header disagrees with central directory");
    if (!buf.subarray(localOffset + 30, localOffset + 30 + lNameLen).equals(buf.subarray(p + 46, p + 46 + nameLen))) {
      throw new ZipError("local header name disagrees with central directory");
    }
    if (!(lFlags & 0x0008)) {
      if (buf.readUInt32LE(localOffset + 14) !== crc || buf.readUInt32LE(localOffset + 18) !== csize || buf.readUInt32LE(localOffset + 22) !== usize) {
        throw new ZipError("local header sizes disagree with central directory");
      }
    }
    const dataOffset = localOffset + 30 + lNameLen + lExtraLen;
    if (dataOffset + csize > cdOffset) throw new ZipError("entry data overruns");
    spans.push([localOffset, dataOffset + csize]);
    entries.set(name, { name, method, crc32: crc, compressedSize: csize, uncompressedSize: usize, dataOffset });
    p = end;
  }
  if (p !== eocd) throw new ZipError("trailing bytes in central directory");
  spans.sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < spans.length; i++) {
    if (spans[i]![0] < spans[i - 1]![1]) throw new ZipError("overlapping entries");
  }

  return {
    entries,
    extract(name: string, maxBytes: number): Uint8Array {
      const e = entries.get(name);
      if (!e) throw new ZipError(`missing entry ${name}`);
      if (e.uncompressedSize > maxBytes) throw new ZipError(`entry ${name} exceeds its size limit`);
      const data = buf.subarray(e.dataOffset, e.dataOffset + e.compressedSize);
      let out: Buffer;
      if (e.method === 0) {
        out = Buffer.from(data);
      } else {
        try {
          // One byte over the declared size is enough to detect a lying header.
          out = inflateRawSync(data, { maxOutputLength: Math.max(1, e.uncompressedSize + 1) });
        } catch {
          throw new ZipError(`entry ${name} does not inflate within its declared size`);
        }
      }
      if (out.length !== e.uncompressedSize) throw new ZipError(`entry ${name} has the wrong size`);
      if (crc32(out) !== e.crc32) throw new ZipError(`entry ${name} fails its CRC-32`);
      return new Uint8Array(out);
    },
  };
}
