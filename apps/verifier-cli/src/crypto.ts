import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

/** Domain tags of evidence-wire-format v1 (spec section 9). */
export const TAGS = {
  event: "aios/evidence/v1/event",
  checkpoint: "aios/evidence/v1/checkpoint",
  commitInput: "aios/evidence/v1/commit/input",
  commitOutput: "aios/evidence/v1/commit/output",
  export: "aios/evidence/v1/export",
  key: "aios/key/v1/ed25519",
} as const;

/** H(tag, bytes) = SHA-256(UTF-8(tag) || 0x00 || bytes), lowercase hex (spec section 2). */
export function domainHash(tag: string, ...parts: Uint8Array[]): string {
  const h = createHash("sha256");
  h.update(Buffer.from(tag, "utf8"));
  h.update(Buffer.from([0]));
  for (const p of parts) h.update(p);
  return h.digest("hex");
}

/** commitment = H(tag, nonce || bytes) (spec section 8). */
export function commitment(tag: string, nonce: Uint8Array, bytes: Uint8Array): string {
  return domainHash(tag, nonce, bytes);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function keyIdFromPublicKey(raw: Uint8Array): string {
  return domainHash(TAGS.key, raw);
}

const B64URL = /^[A-Za-z0-9_-]*$/;

/** Strict base64url without padding (RFC 4648 section 5): rejects padding, other alphabets, non-zero tail bits. */
export function decodeBase64Url(s: string): Uint8Array {
  if (!B64URL.test(s) || s.length % 4 === 1) throw new Error("invalid base64url");
  const out = Buffer.from(s, "base64url");
  if (out.toString("base64url") !== s) throw new Error("non-canonical base64url");
  return new Uint8Array(out);
}

export function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})*$/.test(hex)) throw new Error("invalid hex");
  return new Uint8Array(Buffer.from(hex, "hex"));
}

function ed25519Key(raw: Uint8Array): KeyObject {
  if (raw.length !== 32) throw new Error("Ed25519 public key must be 32 bytes");
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(raw).toString("base64url") },
    format: "jwk",
  });
}

/** Pure Ed25519 (RFC 8032) verification. Returns false for any malformed input. */
export function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  try {
    return verify(null, message, ed25519Key(publicKey), signature);
  } catch {
    return false;
  }
}
