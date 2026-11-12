import { decodeBase64Url, domainHash, hexToBytes, keyIdFromPublicKey, sha256Hex, TAGS, verifyEd25519 } from "./crypto.js";
import { canonicalBytes, parseCanonicalJson } from "./jcs.js";
import {
  BODY_CHECKS,
  NAMED_WITHOUT_BODY_SCHEMA,
  validateCheckpoint,
  validateEvent,
  validateManifest,
  validateManifestSignature,
} from "./schema.js";
import { readZip, ZipError, type ZipArchive } from "./zip.js";

export type Verdict = "intact" | "altered" | "truncated" | "branched" | "unknown_signer";

export type ErrorCode =
  | "E_SCHEMA"
  | "E_NONCANONICAL"
  | "E_PREV_MISMATCH"
  | "E_SEQ_GAP"
  | "E_EPOCH"
  | "E_BAD_SIG"
  | "E_UNKNOWN_SIGNER"
  | "E_CHECKPOINT_MISMATCH"
  | "E_MANIFEST_SIG"
  | "E_TRUNCATED"
  | "E_FILE_DIGEST";

export type WarningCode = "W_UNSIGNED_TAIL" | "W_UNKNOWN_TYPE";

export interface Finding<C extends string = string> {
  code: C;
  /** Bundle file name the finding comes from (absent for findings across bundles). */
  bundle?: string;
  seq?: number;
  /** Field paths, ids, hashes and counts only: never content. */
  detail: string;
}

export interface Scope {
  kind: string;
  first_seq: number;
  last_seq: number;
  project_id?: string;
  from?: string;
  to?: string;
}

export interface BundleSummary {
  file: string;
  export_id: string;
  created_at: string;
  from_seq: number;
  to_seq: number;
  tip_hash: string;
  scope: Scope;
  custody: string;
  manifest_key_id: string | null;
  event_count: number;
  checkpoint_count: number;
}

export interface Branch {
  /** seq of the event both branches continue from (-1: two different genesis events). */
  after_seq: number;
  prev_hash: string;
  /** event_hash of the first event of each branch, sorted. */
  heads: string[];
}

export interface StreamReport {
  stream_id: string;
  verdict: Verdict;
  /** Every epoch seen in the verified chains, ascending. */
  epochs: number[];
  /** Trust anchor and rotated keys, as declared inside the chain (P-4), ascending by epoch. */
  keys: { epoch: number; key_id: string }[];
  bundles: BundleSummary[];
  branches: Branch[];
  errors: Finding<ErrorCode>[];
  warnings: Finding<WarningCode>[];
}

export interface VerificationReport {
  verdict: Verdict;
  exit_code: 0 | 1 | 2;
  streams: StreamReport[];
  /** Bundles that could not be attributed to a stream (unreadable ZIP or manifest). */
  errors: Finding<ErrorCode>[];
}

export interface BundleInput {
  name: string;
  bytes: Uint8Array;
}

export interface VerifyOptions {
  /** key_id the auditor expects for epoch 1 (P-4, `--expect-key`). */
  expectKey?: string;
}

const ALTERED_CODES: ReadonlySet<ErrorCode> = new Set([
  "E_SCHEMA",
  "E_NONCANONICAL",
  "E_PREV_MISMATCH",
  "E_SEQ_GAP",
  "E_EPOCH",
  "E_BAD_SIG",
  "E_CHECKPOINT_MISMATCH",
  "E_MANIFEST_SIG",
  "E_FILE_DIGEST",
]);

const RANK: Record<Verdict, number> = { intact: 0, branched: 1, truncated: 2, unknown_signer: 3, altered: 4 };
export const EXIT_CODES: Record<Verdict, 0 | 1 | 2> = { intact: 0, branched: 1, truncated: 2, unknown_signer: 2, altered: 2 };

const ENTRY_NAMES = ["manifest.json", "manifest.sig.json", "events.jsonl", "checkpoints.jsonl"] as const;
const MAX_MANIFEST_BYTES = 1 << 20;
const MAX_SIG_BYTES = 4096;
const MAX_DATA_BYTES = 1 << 30;
const ZERO_HASH = "0".repeat(64);

interface KeyInfo {
  key_id: string;
  publicKey: Uint8Array;
}

interface Manifest {
  export_id: string;
  created_at: string;
  stream_id: string;
  from_seq: number;
  to_seq: number;
  tip_hash: string;
  keys: { epoch: number; key_id: string; public_key: string }[];
  files: { path: string; size_bytes: number; sha256: string }[];
  scope: Scope;
  checkpoints: { seq: number; key_id: string }[];
  custody: string;
}

interface EventRecord {
  v: number;
  stream_id: string;
  epoch: number;
  seq: number;
  prev_hash: string;
  type: string;
  body: Record<string, unknown>;
}

interface CheckpointRecord {
  stream_id: string;
  epoch: number;
  seq: number;
  event_hash: string;
  key_id: string;
  sig: string;
}

interface VEvent {
  seq: number;
  epoch: number;
  type: string;
  prev_hash: string;
  hash: string;
  body: Record<string, unknown>;
  parent: VEvent | undefined;
  /** True when every link from genesis to this event verified. */
  linked: boolean;
  /** Keys declared per epoch along this event's ancestry (undefined when the chain is broken). */
  keys: ReadonlyMap<number, KeyInfo> | undefined;
}

interface BundleCheck {
  file: string;
  errors: Finding<ErrorCode>[];
  warnings: Finding<WarningCode>[];
  manifest?: Manifest;
  summary?: BundleSummary;
  events: VEvent[];
}

class BundleContext {
  readonly errors: Finding<ErrorCode>[] = [];
  readonly warnings: Finding<WarningCode>[] = [];
  constructor(readonly file: string) {}
  error(code: ErrorCode, detail: string, seq?: number): void {
    this.errors.push(seq === undefined ? { code, bundle: this.file, detail } : { code, bundle: this.file, seq, detail });
  }
  warn(code: WarningCode, detail: string, seq?: number): void {
    this.warnings.push(seq === undefined ? { code, bundle: this.file, detail } : { code, bundle: this.file, seq, detail });
  }
}

function decodeKey(publicKeyB64: string): Uint8Array | undefined {
  try {
    const raw = decodeBase64Url(publicKeyB64);
    return raw.length === 32 ? raw : undefined;
  } catch {
    return undefined;
  }
}

function decodeSig(sig: string): Uint8Array | undefined {
  try {
    const raw = decodeBase64Url(sig);
    return raw.length === 64 ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** Parse one JCS object file (manifest.json, manifest.sig.json). */
function parseObject(ctx: BundleContext, bytes: Uint8Array, what: string): unknown {
  const r = parseCanonicalJson(bytes);
  if (!r.ok) {
    ctx.error(r.code, `${what}: ${r.detail}`);
    return undefined;
  }
  return r.value;
}

/** Split a JSONL file into its lines: LF-terminated, no empty lines. */
function splitLines(ctx: BundleContext, bytes: Uint8Array, what: string): Uint8Array[] {
  if (bytes.length === 0) return [];
  const lines: Uint8Array[] = [];
  let start = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0a) {
      if (i === start) ctx.error("E_NONCANONICAL", `${what}: empty line ${lines.length + 1}`);
      else lines.push(bytes.subarray(start, i));
      start = i + 1;
    }
  }
  if (start !== bytes.length) {
    ctx.error("E_NONCANONICAL", `${what}: last line is not LF-terminated`);
    lines.push(bytes.subarray(start));
  }
  return lines;
}

function extractEntry(ctx: BundleContext, zip: ZipArchive, name: string, max: number): Uint8Array | undefined {
  try {
    return zip.extract(name, max);
  } catch (e) {
    ctx.error("E_SCHEMA", e instanceof ZipError ? e.message : `cannot read ${name}`);
    return undefined;
  }
}

function ancestorAt(e: VEvent, seq: number): VEvent | undefined {
  let cur: VEvent | undefined = e;
  while (cur && cur.seq > seq) cur = cur.parent;
  return cur && cur.seq === seq ? cur : undefined;
}

function checkBundle(input: BundleInput): BundleCheck {
  const ctx = new BundleContext(input.name);
  const result: BundleCheck = { file: input.name, errors: ctx.errors, warnings: ctx.warnings, events: [] };

  // --- ZIP container (section 10) ---
  let zip: ZipArchive;
  try {
    zip = readZip(input.bytes);
  } catch (e) {
    ctx.error("E_SCHEMA", e instanceof ZipError ? `not a valid bundle: ${e.message}` : "not a valid bundle");
    return result;
  }
  const names = [...zip.entries.keys()];
  const unexpected = names.filter((n) => !(ENTRY_NAMES as readonly string[]).includes(n));
  const missing = ENTRY_NAMES.filter((n) => !zip.entries.has(n));
  if (unexpected.length > 0) ctx.error("E_SCHEMA", `unexpected ZIP entries: ${unexpected.length}`);
  if (missing.length > 0) ctx.error("E_SCHEMA", `missing ZIP entries: ${missing.join(", ")}`);
  if (unexpected.length > 0 || missing.length > 0) return result;

  // --- manifest.json ---
  const manifestBytes = extractEntry(ctx, zip, "manifest.json", MAX_MANIFEST_BYTES);
  if (!manifestBytes) return result;
  const manifestValue = parseObject(ctx, manifestBytes, "manifest.json");
  if (manifestValue === undefined) return result;
  const manifestProblems = validateManifest(manifestValue);
  if (manifestProblems.length > 0) {
    for (const p of manifestProblems) ctx.error("E_SCHEMA", p);
    return result;
  }
  const manifest = manifestValue as unknown as Manifest;
  result.manifest = manifest;

  const manifestKeys = new Map<number, KeyInfo>();
  for (const k of manifest.keys) {
    const raw = decodeKey(k.public_key);
    if (!raw || keyIdFromPublicKey(raw) !== k.key_id) {
      ctx.error("E_SCHEMA", `manifest.keys: key_id does not match public_key for epoch ${k.epoch}`);
      continue;
    }
    manifestKeys.set(k.epoch, { key_id: k.key_id, publicKey: raw });
  }

  // --- manifest.sig.json (parsed now, verified once the tip epoch is known) ---
  let manifestSig: { key_id: string; sig: string } | undefined;
  const sigBytes = extractEntry(ctx, zip, "manifest.sig.json", MAX_SIG_BYTES);
  if (sigBytes) {
    const v = parseObject(ctx, sigBytes, "manifest.sig.json");
    if (v !== undefined) {
      const problems = validateManifestSignature(v);
      for (const p of problems) ctx.error("E_SCHEMA", p);
      if (problems.length === 0) manifestSig = v as { key_id: string; sig: string };
    }
  }

  // --- data files: sizes enforced while inflating, digests compared ---
  const fileData = new Map<string, { bytes: Uint8Array; matches: boolean; declaredSize: number }>();
  for (const path of ["events.jsonl", "checkpoints.jsonl"] as const) {
    const declared = manifest.files.find((f) => f.path === path)!;
    if (declared.size_bytes > MAX_DATA_BYTES) {
      ctx.error("E_SCHEMA", `manifest.files: ${path} declares more than the size limit`);
      continue;
    }
    if (zip.entries.get(path)!.uncompressedSize > declared.size_bytes) {
      ctx.error("E_FILE_DIGEST", `${path} is larger than the manifest declares`);
      continue;
    }
    const bytes = extractEntry(ctx, zip, path, declared.size_bytes);
    if (!bytes) continue;
    const matches = bytes.length === declared.size_bytes && sha256Hex(bytes) === declared.sha256;
    fileData.set(path, { bytes, matches, declaredSize: declared.size_bytes });
  }

  // --- events.jsonl ---
  const events: VEvent[] = [];
  const byHash = new Map<string, VEvent>();
  const seqsPresent = new Set<number>();
  const eventsFile = fileData.get("events.jsonl");
  let lastSeqInFile = -1;
  const eventLines = eventsFile ? splitLines(ctx, eventsFile.bytes, "events.jsonl") : [];
  eventLines.forEach((line, i) => {
    const parsed = parseCanonicalJson(line);
    if (!parsed.ok) return ctx.error(parsed.code, `events.jsonl line ${i + 1}: ${parsed.detail}`);
    const problems = validateEvent(parsed.value);
    if (problems.length > 0) {
      for (const p of problems) ctx.error("E_SCHEMA", `events.jsonl line ${i + 1}: ${p}`);
      return;
    }
    const ev = parsed.value as unknown as EventRecord;
    if (ev.stream_id !== manifest.stream_id) {
      return ctx.error("E_SCHEMA", `events.jsonl line ${i + 1}: stream_id differs from the manifest`, ev.seq);
    }
    const hash = domainHash(TAGS.event, line);
    if (byHash.has(hash)) return ctx.error("E_SCHEMA", "duplicate event", ev.seq);
    if (ev.seq < lastSeqInFile) ctx.error("E_SCHEMA", "events.jsonl is not in seq order", ev.seq);
    lastSeqInFile = Math.max(lastSeqInFile, ev.seq);
    if (!(ev.type in BODY_CHECKS) && !NAMED_WITHOUT_BODY_SCHEMA.has(ev.type)) {
      ctx.warn("W_UNKNOWN_TYPE", `unknown_type ${ev.type}`, ev.seq);
    }
    const v: VEvent = {
      seq: ev.seq,
      epoch: ev.epoch,
      type: ev.type,
      prev_hash: ev.prev_hash,
      hash,
      body: ev.body,
      parent: undefined,
      linked: false,
      keys: undefined,
    };
    events.push(v);
    byHash.set(hash, v);
    seqsPresent.add(ev.seq);
  });

  // --- chain: links, seq contiguity, genesis, epochs and declared keys (sections 4, 6) ---
  let genesisSeen = false;
  for (const e of events) {
    if (e.seq === 0) {
      // Schema already enforced prev_hash = zeros, epoch 1, store_created.
      if (genesisSeen) {
        ctx.error("E_SCHEMA", "second genesis event", 0);
        continue;
      }
      genesisSeen = true;
      const raw = decodeKey(e.body["signing_key"] as string);
      if (!raw || keyIdFromPublicKey(raw) !== e.body["key_id"]) {
        ctx.error("E_SCHEMA", "store_created: key_id does not match signing_key", 0);
        continue;
      }
      e.keys = new Map([[1, { key_id: e.body["key_id"] as string, publicKey: raw }]]);
      e.linked = true;
      continue;
    }
    const parent = byHash.get(e.prev_hash);
    if (!parent) {
      if (seqsPresent.has(e.seq - 1)) ctx.error("E_PREV_MISMATCH", "prev_hash does not match the event at seq - 1", e.seq);
      else ctx.error("E_SEQ_GAP", `no event at seq ${e.seq - 1}`, e.seq);
      continue;
    }
    e.parent = parent;
    if (parent.seq !== e.seq - 1) {
      ctx.error("E_PREV_MISMATCH", "prev_hash names an event that is not at seq - 1", e.seq);
      continue;
    }
    let ok = true;
    let keys = parent.keys;
    if (e.type === "continuation") {
      const b = e.body;
      if (e.epoch !== parent.epoch + 1 || b["previous_epoch"] !== parent.epoch) {
        ctx.error("E_EPOCH", "continuation must raise the epoch by exactly 1", e.seq);
        ok = false;
      }
      const raw = decodeKey(b["signing_key"] as string);
      if (!raw || keyIdFromPublicKey(raw) !== b["key_id"]) {
        ctx.error("E_SCHEMA", "continuation: key_id does not match signing_key", e.seq);
        ok = false;
      }
      const prevKey = parent.keys?.get(parent.epoch);
      if (b["previous_key_id"] !== undefined && prevKey && b["previous_key_id"] !== prevKey.key_id) {
        ctx.error("E_EPOCH", "continuation: previous_key_id is not the key of previous_epoch", e.seq);
        ok = false;
      }
      const resumed = b["resumed_from"] as { seq: number; event_hash: string };
      if (resumed.seq !== parent.seq || resumed.event_hash !== e.prev_hash) {
        ctx.error("E_PREV_MISMATCH", "continuation: resumed_from does not equal prev_hash", e.seq);
        ok = false;
      }
      const lastCp = b["last_checkpoint"] as { seq: number; event_hash: string };
      if (ancestorAt(parent, lastCp.seq)?.hash !== lastCp.event_hash) {
        ctx.error("E_CHECKPOINT_MISMATCH", "continuation: last_checkpoint is not an event of this chain", e.seq);
        ok = false;
      }
      if (raw && keys) {
        const next = new Map(keys);
        next.set(e.epoch, { key_id: b["key_id"] as string, publicKey: raw });
        keys = next;
      } else {
        keys = undefined;
      }
    } else if (e.epoch !== parent.epoch) {
      ctx.error("E_EPOCH", "epoch changes on a non-continuation event", e.seq);
      ok = false;
    }
    e.keys = keys;
    e.linked = ok && parent.linked && keys !== undefined;
  }
  if (events.length > 0 && !genesisSeen) ctx.error("E_SEQ_GAP", "no genesis event (seq 0)");

  // --- tip and truncation ---
  const maxSeq = events.reduce((m, e) => Math.max(m, e.seq), -1);
  const tip = byHash.get(manifest.tip_hash);
  let truncated = false;
  if (!eventsFile) {
    // events.jsonl could not be read within its declared size: already an error, nothing to compare.
  } else if (tip) {
    if (tip.seq !== manifest.to_seq) ctx.error("E_CHECKPOINT_MISMATCH", "manifest tip_hash is not at to_seq", tip.seq);
  } else if (maxSeq < manifest.to_seq) {
    truncated = true;
    ctx.error("E_TRUNCATED", `events stop at seq ${maxSeq}; manifest to_seq is ${manifest.to_seq}`);
  } else {
    ctx.error("E_CHECKPOINT_MISMATCH", "the event at manifest to_seq does not have tip_hash", manifest.to_seq);
  }
  const head =
    tip ?? events.filter((e) => e.seq === maxSeq).find((e) => e.linked) ?? events.filter((e) => e.seq === maxSeq)[0];

  // --- manifest keys must be the keys the chain declares (trust handover inside the chain) ---
  if (head?.keys) {
    for (const [epoch, k] of head.keys) {
      if (manifestKeys.get(epoch)?.key_id !== k.key_id) {
        ctx.error("E_UNKNOWN_SIGNER", `manifest.keys: epoch ${epoch} does not name the key the chain declares`);
      }
    }
    for (const epoch of manifestKeys.keys()) {
      if (!head.keys.has(epoch) && !(truncated && epoch > head.epoch)) {
        ctx.error("E_UNKNOWN_SIGNER", `manifest.keys: epoch ${epoch} is not declared in the chain`);
      }
    }
  }

  // --- manifest signature: key of the tip's epoch (section 10) ---
  if (manifestSig) {
    const tipEpoch = tip?.epoch ?? Math.max(...manifestKeys.keys(), 1);
    const expected = manifestKeys.get(tipEpoch);
    const named = [...manifestKeys.values()].some((k) => k.key_id === manifestSig.key_id);
    if (!named) {
      ctx.error("E_UNKNOWN_SIGNER", `manifest.sig.json: key_id ${manifestSig.key_id} is not named in the manifest`);
    } else if (!expected || expected.key_id !== manifestSig.key_id) {
      ctx.error("E_UNKNOWN_SIGNER", `manifest.sig.json: key_id is not the key of the tip's epoch ${tipEpoch}`);
    } else {
      const sig = decodeSig(manifestSig.sig);
      const digest = hexToBytes(domainHash(TAGS.export, manifestBytes));
      if (!sig || !verifyEd25519(expected.publicKey, digest, sig)) {
        ctx.error("E_MANIFEST_SIG", "manifest.sig.json does not verify");
      }
    }
  }

  // --- checkpoints.jsonl (section 7) ---
  const cpFile = fileData.get("checkpoints.jsonl");
  const cpLines = cpFile ? splitLines(ctx, cpFile.bytes, "checkpoints.jsonl") : [];
  const checkpoints: CheckpointRecord[] = [];
  let maxCheckpointSeq = -1;
  cpLines.forEach((line, i) => {
    const parsed = parseCanonicalJson(line);
    if (!parsed.ok) return ctx.error(parsed.code, `checkpoints.jsonl line ${i + 1}: ${parsed.detail}`);
    const problems = validateCheckpoint(parsed.value);
    if (problems.length > 0) {
      for (const p of problems) ctx.error("E_SCHEMA", `checkpoints.jsonl line ${i + 1}: ${p}`);
      return;
    }
    const cp = parsed.value as unknown as CheckpointRecord;
    checkpoints.push(cp);
    if (cp.stream_id !== manifest.stream_id) {
      return ctx.error("E_SCHEMA", `checkpoints.jsonl line ${i + 1}: stream_id differs from the manifest`, cp.seq);
    }
    const ev = byHash.get(cp.event_hash);
    let allowed: KeyInfo[];
    if (ev && ev.seq === cp.seq) {
      if (cp.epoch !== ev.epoch) {
        return ctx.error("E_CHECKPOINT_MISMATCH", "checkpoint epoch differs from the event's epoch", cp.seq);
      }
      const keys = ev.keys ?? manifestKeys;
      const own = keys.get(ev.epoch);
      const previous = ev.type === "continuation" ? keys.get(ev.epoch - 1) : undefined;
      allowed = [own, previous].filter((k): k is KeyInfo => k !== undefined);
    } else if (!ev && cp.seq > maxSeq) {
      // Refers to an event that is no longer present: truncation evidence, not alteration.
      // Its signature must still verify under a key the manifest names for that epoch.
      allowed = [manifestKeys.get(cp.epoch), manifestKeys.get(cp.epoch - 1)].filter((k): k is KeyInfo => k !== undefined);
      if (!truncated) ctx.error("E_CHECKPOINT_MISMATCH", "checkpoint beyond the manifest tip", cp.seq);
    } else {
      return ctx.error("E_CHECKPOINT_MISMATCH", "checkpoint event_hash differs from the computed hash at seq", cp.seq);
    }
    const key = allowed.find((k) => k.key_id === cp.key_id);
    if (!key) return ctx.error("E_UNKNOWN_SIGNER", `checkpoint key_id is not declared for epoch ${cp.epoch}`, cp.seq);
    const { sig: sigText, ...unsigned } = cp;
    // JCS(checkpoint without "sig"); unknown fields stay in, as they are hashed (section 2).
    const message = hexToBytes(domainHash(TAGS.checkpoint, canonicalBytes(unsigned)));
    const sig = decodeSig(sigText);
    if (!sig || !verifyEd25519(key.publicKey, message, sig)) {
      return ctx.error("E_BAD_SIG", "checkpoint signature does not verify", cp.seq);
    }
    maxCheckpointSeq = Math.max(maxCheckpointSeq, cp.seq);
  });

  // The manifest lists the checkpoints the export contains, in order.
  const listed = manifest.checkpoints;
  const sameAsListed = (n: number): boolean =>
    checkpoints.slice(0, n).every((c, i) => c.seq === listed[i]?.seq && c.key_id === listed[i]?.key_id);
  const checkpointsAreStrictPrefix = checkpoints.length < listed.length && sameAsListed(checkpoints.length);
  if (cpFile && !(checkpoints.length === listed.length && sameAsListed(listed.length))) {
    if (!(truncated && checkpointsAreStrictPrefix)) {
      ctx.error("E_CHECKPOINT_MISMATCH", "checkpoints.jsonl differs from manifest.checkpoints");
    }
  }

  // --- file digests: a mismatch is an alteration unless truncation explains it ---
  if (eventsFile && !eventsFile.matches && !(truncated && eventsFile.bytes.length < eventsFile.declaredSize)) {
    ctx.error("E_FILE_DIGEST", "events.jsonl size or sha256 differs from the manifest");
  }
  if (cpFile && !cpFile.matches && !(truncated && checkpointsAreStrictPrefix && cpFile.bytes.length < cpFile.declaredSize)) {
    ctx.error("E_FILE_DIGEST", "checkpoints.jsonl size or sha256 differs from the manifest");
  }

  if (head && head.seq > maxCheckpointSeq) {
    ctx.warn("W_UNSIGNED_TAIL", `${head.seq - maxCheckpointSeq} event(s) after the last checkpoint`, head.seq);
  }

  result.events = events;
  result.summary = {
    file: input.name,
    export_id: manifest.export_id,
    created_at: manifest.created_at,
    from_seq: manifest.from_seq,
    to_seq: manifest.to_seq,
    tip_hash: manifest.tip_hash,
    scope: pickScope(manifest.scope),
    custody: manifest.custody,
    manifest_key_id: manifestSig?.key_id ?? null,
    event_count: events.length,
    checkpoint_count: checkpoints.length,
  };
  return result;
}

function pickScope(s: Scope): Scope {
  const out: Scope = { kind: s.kind, first_seq: s.first_seq, last_seq: s.last_seq };
  if (typeof s.project_id === "string") out.project_id = s.project_id;
  if (typeof s.from === "string") out.from = s.from;
  if (typeof s.to === "string") out.to = s.to;
  return out;
}

function verdictOf(errors: Finding<ErrorCode>[], branched: boolean): Verdict {
  const codes = new Set(errors.map((e) => e.code));
  if ([...codes].some((c) => ALTERED_CODES.has(c))) return "altered";
  if (codes.has("E_UNKNOWN_SIGNER")) return "unknown_signer";
  if (codes.has("E_TRUNCATED")) return "truncated";
  return branched ? "branched" : "intact";
}

function streamReport(streamId: string, checks: BundleCheck[], opts: VerifyOptions): StreamReport {
  const errors = checks.flatMap((c) => c.errors);
  const warnings = checks.flatMap((c) => c.warnings);

  // Union of every event whose chain verified, across all bundles of the stream.
  const valid = new Map<string, VEvent>();
  for (const c of checks) for (const e of c.events) if (e.linked && !valid.has(e.hash)) valid.set(e.hash, e);

  const children = new Map<string, Set<string>>();
  for (const e of valid.values()) {
    const set = children.get(e.prev_hash) ?? new Set<string>();
    set.add(e.hash);
    children.set(e.prev_hash, set);
  }
  const branches: Branch[] = [];
  for (const [prev, set] of children) {
    if (set.size < 2) continue;
    const heads = [...set].sort();
    const after = prev === ZERO_HASH ? -1 : valid.get(heads[0]!)!.seq - 1;
    branches.push({ after_seq: after, prev_hash: prev, heads });
  }
  branches.sort((a, b) => a.after_seq - b.after_seq || (a.prev_hash < b.prev_hash ? -1 : 1));

  const epochs = [...new Set([...valid.values()].map((e) => e.epoch))].sort((a, b) => a - b);
  const keySet = new Map<string, { epoch: number; key_id: string }>();
  for (const e of valid.values()) {
    for (const [epoch, k] of e.keys ?? []) keySet.set(`${epoch}:${k.key_id}`, { epoch, key_id: k.key_id });
  }
  const keys = [...keySet.values()].sort((a, b) => a.epoch - b.epoch || (a.key_id < b.key_id ? -1 : 1));

  if (opts.expectKey !== undefined) {
    const anchors = keys.filter((k) => k.epoch === 1);
    if (anchors.length === 0 || anchors.some((k) => k.key_id !== opts.expectKey)) {
      errors.push({ code: "E_UNKNOWN_SIGNER", detail: "epoch-1 key_id differs from --expect-key" });
    }
  }

  return {
    stream_id: streamId,
    verdict: verdictOf(errors, branches.length > 0),
    epochs,
    keys,
    bundles: checks.map((c) => c.summary).filter((s): s is BundleSummary => s !== undefined),
    branches,
    errors,
    warnings,
  };
}

/** Verify one or more export bundles; bundles of the same stream are verified together. */
export function verifyBundles(inputs: BundleInput[], opts: VerifyOptions = {}): VerificationReport {
  const checks = inputs.map(checkBundle);
  const orphanErrors: Finding<ErrorCode>[] = [];
  const byStream = new Map<string, BundleCheck[]>();
  for (const c of checks) {
    if (!c.manifest) {
      orphanErrors.push(...c.errors);
      continue;
    }
    const list = byStream.get(c.manifest.stream_id) ?? [];
    list.push(c);
    byStream.set(c.manifest.stream_id, list);
  }
  const streams = [...byStream].map(([id, list]) => streamReport(id, list, opts));
  let verdict: Verdict = orphanErrors.length > 0 ? "altered" : "intact";
  for (const s of streams) if (RANK[s.verdict] > RANK[verdict]) verdict = s.verdict;
  return { verdict, exit_code: EXIT_CODES[verdict], streams, errors: orphanErrors };
}
