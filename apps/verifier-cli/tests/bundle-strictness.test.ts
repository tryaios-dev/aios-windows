import { describe, expect, it } from "vitest";
import { verifyBundles, type VerificationReport } from "../src/verify.js";
import { readZip, ZipError } from "../src/zip.js";
import { loadCase } from "./helpers/vectors.js";
import { writeZip, type TestEntry } from "./helpers/zipwriter.js";

const ORDER = ["manifest.json", "manifest.sig.json", "events.jsonl", "checkpoints.jsonl"] as const;
type Name = (typeof ORDER)[number];

function unpack(caseName: string): Record<Name, Uint8Array> {
  const zip = readZip(loadCase(caseName).bundles[0]!.bytes);
  const out = {} as Record<Name, Uint8Array>;
  for (const n of ORDER) out[n] = zip.extract(n, 1 << 20);
  return out;
}

function repack(files: Record<Name, Uint8Array>, extra: TestEntry[] = [], tweak?: (e: TestEntry) => TestEntry): Uint8Array {
  const entries: TestEntry[] = ORDER.map((n) => ({ name: n, data: files[n] }));
  return writeZip([...entries.map((e) => (tweak ? tweak(e) : e)), ...extra]);
}

function run(bytes: Uint8Array): VerificationReport {
  return verifyBundles([{ name: "handcrafted.zip", bytes }]);
}

function allCodes(r: VerificationReport): string[] {
  return [...r.errors, ...r.streams.flatMap((s) => s.errors)].map((e) => e.code);
}

const text = (b: Uint8Array): string => new TextDecoder().decode(b);
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("bundle strictness (spec section 10)", () => {
  it("ac-13: a faithful repack of the intact vector (deflate and stored) is still intact", () => {
    const files = unpack("intact");
    expect(run(repack(files)).verdict).toBe("intact");
    expect(run(repack(files, [], (e) => ({ ...e, method: 0 }))).verdict).toBe("intact");
  });

  it("ac-13: a handcrafted bundle with an extra ZIP entry is rejected", () => {
    const r = run(repack(unpack("intact"), [{ name: "notes.txt", data: bytes("hello") }]));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_SCHEMA");
  });

  it("ac-13: a directory entry is rejected", () => {
    const r = run(repack(unpack("intact"), [{ name: "extra/", data: new Uint8Array(0), externalAttrs: 0x10 }]));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_SCHEMA");
  });

  it("ac-13: a missing entry is rejected", () => {
    const files = unpack("intact");
    const entries = ORDER.filter((n) => n !== "checkpoints.jsonl").map((n) => ({ name: n, data: files[n] }));
    const r = run(writeZip(entries));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_SCHEMA");
  });

  it("ac-13: an encrypted entry is rejected", () => {
    expect(() => readZip(repack(unpack("intact"), [], (e) => ({ ...e, flags: 1 })))).toThrow(ZipError);
    expect(run(repack(unpack("intact"), [], (e) => ({ ...e, flags: 1 }))).verdict).toBe("altered");
  });

  it("ac-13: a compression method other than stored or deflate is rejected", () => {
    const r = run(repack(unpack("intact"), [], (e) => (e.name === "events.jsonl" ? { ...e, method: 12 } : e)));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_SCHEMA");
  });

  it("ac-13: a symlink entry is rejected", () => {
    const r = run(repack(unpack("intact"), [], (e) => (e.name === "events.jsonl" ? { ...e, externalAttrs: 0xa1ff0000 } : e)));
    expect(r.verdict).toBe("altered");
  });

  it("ac-13: bytes that are not a ZIP are rejected as altered", () => {
    const r = run(bytes("this is not a zip file at all, just some text"));
    expect(r.verdict).toBe("altered");
    expect(r.errors.map((e) => e.code)).toContain("E_SCHEMA");
  });

  it("ac-13: an entry that inflates beyond its declared size is rejected", () => {
    const files = unpack("intact");
    const zip = Buffer.from(repack(files));
    // Lower the uncompressed size of manifest.json in both headers: the reader must stop at it.
    const local = zip.indexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(10, local + 22);
    zip.writeUInt32LE(10, central + 24);
    expect(() => readZip(new Uint8Array(zip)).extract("manifest.json", 1 << 20)).toThrow(ZipError);
    expect(run(new Uint8Array(zip)).verdict).toBe("altered");
  });
});

describe("tampering inside a well-formed bundle", () => {
  it("ac-13: a checkpoint signature that does not verify gives altered (E_BAD_SIG)", () => {
    const files = unpack("intact");
    const lines = text(files["checkpoints.jsonl"]).split("\n");
    const cp = JSON.parse(lines[0]!) as { sig: string };
    const flipped = (cp.sig[0] === "A" ? "B" : "A") + cp.sig.slice(1);
    lines[0] = lines[0]!.replace(cp.sig, flipped);
    files["checkpoints.jsonl"] = bytes(lines.join("\n"));
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_BAD_SIG");
  });

  it("ac-13: a manifest signature that does not verify gives altered (E_MANIFEST_SIG)", () => {
    const files = unpack("intact");
    const sig = JSON.parse(text(files["manifest.sig.json"])) as { sig: string };
    const flipped = (sig.sig[0] === "A" ? "B" : "A") + sig.sig.slice(1);
    files["manifest.sig.json"] = bytes(text(files["manifest.sig.json"]).replace(sig.sig, flipped));
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_MANIFEST_SIG");
  });

  it("ac-13: a manifest with an edited field and the old signature gives altered", () => {
    const files = unpack("intact");
    files["manifest.json"] = bytes(text(files["manifest.json"]).replace('"to_seq":5', '"to_seq":4'));
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_MANIFEST_SIG");
  });

  it("ac-13: a non-canonical manifest (whitespace) gives altered (E_NONCANONICAL)", () => {
    const files = unpack("intact");
    files["manifest.json"] = bytes(text(files["manifest.json"]).replace('{"checkpoints"', '{ "checkpoints"'));
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_NONCANONICAL");
  });

  it("ac-13: CRLF line endings make events.jsonl exceed its declared size: altered, not truncated", () => {
    const files = unpack("intact");
    files["events.jsonl"] = bytes(text(files["events.jsonl"]).replaceAll("\n", "\r\n"));
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_FILE_DIGEST");
    expect(allCodes(r)).not.toContain("E_TRUNCATED");
  });

  it("ac-13: an event line with reordered keys (same size) gives altered (E_NONCANONICAL)", () => {
    const files = unpack("intact");
    const canonical = '"classification":"restricted","project_id":"a1a1a1a1-0000-4000-8000-000000000001"}';
    const reordered = '"project_id":"a1a1a1a1-0000-4000-8000-000000000001","classification":"restricted"}';
    const before = text(files["events.jsonl"]);
    expect(before).toContain(canonical);
    files["events.jsonl"] = bytes(before.replace(canonical, reordered));
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).toContain("E_NONCANONICAL");
  });

  it("ac-13: a duplicated event line gives altered, not branched", () => {
    const files = unpack("intact");
    const lines = text(files["events.jsonl"]).split("\n").filter((l) => l !== "");
    files["events.jsonl"] = bytes([...lines, lines[lines.length - 1]!].join("\n") + "\n");
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
  });

  it("ac-13: a removed middle event gives altered (link breaks), not truncated", () => {
    const files = unpack("intact");
    const lines = text(files["events.jsonl"]).split("\n").filter((l) => l !== "");
    lines.splice(2, 1);
    files["events.jsonl"] = bytes(lines.join("\n") + "\n");
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
    expect(allCodes(r)).not.toContain("E_TRUNCATED");
  });

  it("ac-13: an event from another stream gives altered", () => {
    const files = unpack("intact");
    files["events.jsonl"] = bytes(
      text(files["events.jsonl"]).replace(
        '"seq":3,"stream_id":"3f2a9c1e-7b4d-4e8f-9a01-0c1d2e3f4a5b"',
        '"seq":3,"stream_id":"00000000-7b4d-4e8f-9a01-0c1d2e3f4a5b"',
      ),
    );
    expect(run(repack(files)).verdict).toBe("altered");
  });

  it("ac-13: a truncated bundle whose remaining checkpoint was tampered with is altered, not truncated", () => {
    const files = unpack("truncated");
    const lines = text(files["checkpoints.jsonl"]).split("\n");
    const cp = JSON.parse(lines[0]!) as { sig: string };
    lines[0] = lines[0]!.replace(cp.sig, (cp.sig[0] === "A" ? "B" : "A") + cp.sig.slice(1));
    files["checkpoints.jsonl"] = bytes(lines.join("\n"));
    expect(run(repack(files)).verdict).toBe("altered");
  });

  it("ac-13: removing the last checkpoint is altered (manifest lists it, no truncation explains it)", () => {
    const files = unpack("intact");
    const lines = text(files["checkpoints.jsonl"]).split("\n").filter((l) => l !== "");
    files["checkpoints.jsonl"] = bytes(lines.slice(0, 1).join("\n") + "\n");
    const r = run(repack(files));
    expect(r.verdict).toBe("altered");
  });

  it("ac-13: the same bundle given twice is still intact (no branch)", () => {
    const b = loadCase("intact").bundles[0]!;
    expect(verifyBundles([b, { ...b, name: "copy.zip" }]).verdict).toBe("intact");
  });

  it("ac-13: an altered bundle together with a good one gives altered (precedence)", () => {
    const r = verifyBundles([...loadCase("intact").bundles, ...loadCase("altered").bundles.map((b) => ({ ...b, name: "altered.zip" }))]);
    expect(r.verdict).toBe("altered");
  });
});
