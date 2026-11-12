/**
 * Hand-written shape checks mirroring contracts/evidence-wire-format/v1/*.schema.json
 * (required fields, types, patterns, enums, integer ranges). Additional properties are allowed,
 * as the schemas allow them. Problems name the field path only, never the value.
 */

type Check = (v: unknown, path: string, out: string[]) => void;

const MAX_SAFE = 9007199254740991;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PUBKEY = /^[A-Za-z0-9_-]{43}$/;
const SIG = /^[A-Za-z0-9_-]{86}$/;
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{1,63}$/;
const EVENT_TYPE = /^[a-z][a-z0-9_]{0,63}$/;
// RFC 3339 date-time (the schema's "format": "date-time").
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/;

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str =
  (pattern?: RegExp, maxLength?: number): Check =>
  (v, path, out) => {
    if (typeof v !== "string") return void out.push(`${path}: expected string`);
    if (pattern && !pattern.test(v)) out.push(`${path}: does not match its pattern`);
    if (maxLength !== undefined && [...v].length > maxLength) out.push(`${path}: too long`);
  };

const int =
  (min = 0, max = MAX_SAFE): Check =>
  (v, path, out) => {
    if (typeof v !== "number" || !Number.isInteger(v)) return void out.push(`${path}: expected integer`);
    if (v < min || v > max) out.push(`${path}: out of range`);
  };

const constant =
  (c: string | number): Check =>
  (v, path, out) => {
    if (v !== c) out.push(`${path}: unexpected value`);
  };

const oneOf =
  (...values: string[]): Check =>
  (v, path, out) => {
    if (typeof v !== "string" || !values.includes(v)) out.push(`${path}: not an allowed value`);
  };

const obj =
  (required: Record<string, Check>, optional: Record<string, Check> = {}): Check =>
  (v, path, out) => {
    if (!isObject(v)) return void out.push(`${path}: expected object`);
    for (const [k, check] of Object.entries(required)) {
      if (!Object.hasOwn(v, k)) out.push(`${path}.${k}: missing`);
      else check(v[k], `${path}.${k}`, out);
    }
    for (const [k, check] of Object.entries(optional)) {
      if (Object.hasOwn(v, k)) check(v[k], `${path}.${k}`, out);
    }
  };

const arr =
  (item: Check, minItems = 0): Check =>
  (v, path, out) => {
    if (!Array.isArray(v)) return void out.push(`${path}: expected array`);
    if (v.length < minItems) out.push(`${path}: too few items`);
    v.forEach((x, i) => item(x, `${path}[${i}]`, out));
  };

const anyObject: Check = (v, path, out) => {
  if (!isObject(v)) out.push(`${path}: expected object`);
};

const uuid = str(UUID);
const digest = str(DIGEST);
const classification = oneOf("restricted", "internal", "public");
const provider = oneOf("local", "company");
const position = obj({ seq: int(), event_hash: digest });

/** Body checks per v1 event type (spec section 5, event.schema.json). */
export const BODY_CHECKS: Readonly<Record<string, Check>> = {
  store_created: obj({ signing_key: str(PUBKEY), key_id: digest, app_version: str(undefined, 64) }),
  recovery_package_written: obj({ package_id: uuid, package_digest: digest }),
  recovery_key_issued: obj({ package_id: uuid }),
  continuation: obj(
    {
      reason: oneOf("restore", "key_rotation"),
      previous_epoch: int(1),
      resumed_from: position,
      last_checkpoint: position,
      signing_key: str(PUBKEY),
      key_id: digest,
    },
    { previous_key_id: digest },
  ),
  project_created: obj({ project_id: uuid, classification }),
  conversation_created: obj({ conversation_id: uuid, project_id: uuid, classification }),
  inference_completed: obj({
    conversation_id: uuid,
    message_id: uuid,
    provider,
    model_id: str(MODEL_ID),
    input_commitment: digest,
    output_commitment: digest,
    tokens_in: int(),
    tokens_out: int(),
    status: oneOf("ok", "cancelled", "error"),
  }),
  disclosure_confirmed: obj({ conversation_id: uuid, provider, classification }),
  model_installed: obj({ model_id: str(MODEL_ID), artefact_sha256: digest, catalogue_issued_at: str(DATE_TIME) }),
  project_exported: obj({ project_id: uuid, package_id: uuid, manifest_digest: digest }),
  project_imported: obj({ project_id: uuid, package_id: uuid, manifest_digest: digest }),
  evidence_exported: obj(
    { export_id: uuid, to_seq: int(), tip_hash: digest },
    { manifest_digest: digest, scope: oneOf("project", "range") },
  ),
};

/** Types the spec names (section 5) whose bodies it does not define: object, content-free. */
export const NAMED_WITHOUT_BODY_SCHEMA: ReadonlySet<string> = new Set([
  "project_reclassified",
  "project_deleted",
  "conversation_deleted",
  "provider_changed",
  "refusal",
]);

const eventCheck = obj({
  v: constant(1),
  stream_id: uuid,
  epoch: int(1),
  seq: int(0),
  prev_hash: digest,
  time: str(TIME),
  type: str(EVENT_TYPE),
  body: anyObject,
});

export function validateEvent(v: unknown): string[] {
  const out: string[] = [];
  eventCheck(v, "event", out);
  if (out.length > 0 || !isObject(v)) return out;
  if (v["seq"] === 0) {
    if (v["prev_hash"] !== "0".repeat(64)) out.push("event.prev_hash: genesis must be 64 zeros");
    if (v["epoch"] !== 1) out.push("event.epoch: genesis must be epoch 1");
    if (v["type"] !== "store_created") out.push("event.type: genesis must be store_created");
  }
  const body = BODY_CHECKS[v["type"] as string];
  if (body) body(v["body"], "event.body", out);
  return out;
}

const checkpointCheck = obj({
  v: constant(1),
  stream_id: uuid,
  epoch: int(1),
  seq: int(0),
  event_hash: digest,
  time: str(TIME),
  key_id: digest,
  sig: str(SIG),
});

export function validateCheckpoint(v: unknown): string[] {
  const out: string[] = [];
  checkpointCheck(v, "checkpoint", out);
  return out;
}

const manifestCheck = obj({
  format: constant("aios-evidence-export"),
  v: constant(1),
  export_id: uuid,
  created_at: str(TIME),
  stream_id: uuid,
  from_seq: constant(0),
  to_seq: int(0),
  tip_hash: digest,
  keys: arr(obj({ epoch: int(1), key_id: digest, public_key: str(PUBKEY) }), 1),
  files: arr(obj({ path: oneOf("events.jsonl", "checkpoints.jsonl"), size_bytes: int(0), sha256: digest }), 2),
  scope: obj(
    { kind: oneOf("project", "date_range", "stream"), first_seq: int(0), last_seq: int(0) },
    { project_id: uuid, from: str(), to: str() },
  ),
  checkpoints: arr(obj({ seq: int(0), key_id: digest })),
  custody: str(undefined, 128),
});

export function validateManifest(v: unknown): string[] {
  const out: string[] = [];
  manifestCheck(v, "manifest", out);
  if (out.length > 0 || !isObject(v)) return out;
  // Beyond the schema, needed for an unambiguous reading: each file once, each epoch once.
  const paths = (v["files"] as { path: string }[]).map((f) => f.path);
  if (new Set(paths).size !== paths.length) out.push("manifest.files: a path is listed twice");
  const epochs = (v["keys"] as { epoch: number }[]).map((k) => k.epoch);
  if (new Set(epochs).size !== epochs.length) out.push("manifest.keys: an epoch is listed twice");
  return out;
}

const manifestSigCheck = obj({ v: constant(1), key_id: digest, sig: str(SIG) });

export function validateManifestSignature(v: unknown): string[] {
  const out: string[] = [];
  manifestSigCheck(v, "manifest.sig", out);
  return out;
}
