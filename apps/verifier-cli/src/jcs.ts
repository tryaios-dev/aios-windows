/**
 * RFC 8785 JSON Canonicalization Scheme, restricted to the evidence wire format's number rule:
 * integers only, |n| <= 2^53 - 1 (the format additionally requires n >= 0; the schema checks that).
 *
 * Written from the RFC; shares no code with any other implementation in the repository.
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export class JcsError extends Error {
  override readonly name = "JcsError";
}

/** Compare two strings by UTF-16 code units (RFC 8785 section 3.2.3). */
export function compareUtf16(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = a.charCodeAt(i) - b.charCodeAt(i);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function serializeString(s: string): string {
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1;
      if (next < 0xdc00 || next > 0xdfff) throw new JcsError("lone surrogate in string");
      out += s[i]! + s[i + 1]!;
      i++;
      continue;
    }
    if (c >= 0xdc00 && c <= 0xdfff) throw new JcsError("lone surrogate in string");
    switch (c) {
      case 0x22:
        out += '\\"';
        break;
      case 0x5c:
        out += "\\\\";
        break;
      case 0x08:
        out += "\\b";
        break;
      case 0x09:
        out += "\\t";
        break;
      case 0x0a:
        out += "\\n";
        break;
      case 0x0c:
        out += "\\f";
        break;
      case 0x0d:
        out += "\\r";
        break;
      default:
        out += c < 0x20 ? "\\u" + c.toString(16).padStart(4, "0") : s[i]!;
    }
  }
  return out + '"';
}

function serializeNumber(n: number): string {
  if (!Number.isFinite(n)) throw new JcsError("non-finite number");
  if (!Number.isInteger(n)) throw new JcsError("non-integer number");
  if (!Number.isSafeInteger(n)) throw new JcsError("integer outside the safe range");
  // Integers in the safe range: ECMAScript Number-to-String equals the RFC 8785 form; -0 -> "0".
  return Object.is(n, -0) ? "0" : String(n);
}

function serialize(value: unknown, depth: number): string {
  if (depth > 64) throw new JcsError("nesting too deep");
  if (value === null) return "null";
  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";
    case "number":
      return serializeNumber(value);
    case "string":
      return serializeString(value);
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => serialize(v, depth + 1)).join(",") + "]";
      }
      const proto = Object.getPrototypeOf(value) as unknown;
      if (proto !== Object.prototype && proto !== null) throw new JcsError("not a plain object");
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort(compareUtf16);
      return "{" + keys.map((k) => serializeString(k) + ":" + serialize(obj[k], depth + 1)).join(",") + "}";
    }
    default:
      throw new JcsError(`unsupported value of type ${typeof value}`);
  }
}

/** Serialise a JSON value with RFC 8785 (integers only). Throws JcsError for anything else. */
export function canonicalize(value: unknown): string {
  return serialize(value, 0);
}

export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}

export type ParseResult =
  | { ok: true; value: JsonValue }
  | { ok: false; code: "E_NONCANONICAL" | "E_SCHEMA"; detail: string };

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Parse bytes as JSON and accept them only if they are exactly their own JCS serialisation
 * (spec section 2: re-serialise and reject if the bytes differ).
 *
 * - invalid UTF-8, invalid JSON, or bytes differing from the re-serialisation: E_NONCANONICAL
 * - a value JCS-for-this-format cannot represent (float, unsafe integer): E_SCHEMA
 */
export function parseCanonicalJson(bytes: Uint8Array): ParseResult {
  let text: string;
  try {
    text = utf8.decode(bytes);
  } catch {
    return { ok: false, code: "E_NONCANONICAL", detail: "invalid UTF-8" };
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, code: "E_NONCANONICAL", detail: "invalid JSON" };
  }
  let again: Uint8Array;
  try {
    again = canonicalBytes(value);
  } catch (e) {
    return { ok: false, code: "E_SCHEMA", detail: e instanceof Error ? e.message : "not representable" };
  }
  if (!bytesEqual(again, bytes)) {
    return { ok: false, code: "E_NONCANONICAL", detail: "bytes differ from the JCS serialisation" };
  }
  return { ok: true, value: value as JsonValue };
}
