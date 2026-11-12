import { describe, expect, it } from "vitest";
import { canonicalize, JcsError, parseCanonicalJson } from "../src/jcs.js";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("JCS canonical JSON (RFC 8785, integers only)", () => {
  it("ac-13: sorts keys by UTF-16 code units, not by code points or locale", () => {
    // U+E000 (one unit 0xE000) sorts after U+1F600 (surrogates 0xD83D 0xDE00) in UTF-16 order,
    // although its code point is smaller.
    const value = { "": 1, "\u{1F600}": 2, b: 3, a: 4, B: 5, "": 6, aa: 7 };
    expect(canonicalize(value)).toBe('{"":6,"B":5,"a":4,"aa":7,"b":3,"\u{1F600}":2,"":1}');
  });

  it("ac-13: sorts nested objects and keeps array order, without whitespace", () => {
    expect(canonicalize({ z: [3, { y: 1, x: 2 }, []], a: {} })).toBe('{"a":{},"z":[3,{"x":2,"y":1},[]]}');
  });

  it("ac-13: escapes strings exactly as RFC 8785 requires", () => {
    expect(canonicalize("\u0000\u0001\u001f")).toBe('"\\u0000\\u0001\\u001f"');
    expect(canonicalize('"\\/')).toBe('"\\"\\\\/"');
    expect(canonicalize("\b\t\n\f\r")).toBe('"\\b\\t\\n\\f\\r"');
    expect(canonicalize("\u007fé€\u{1F600}")).toBe('"\u007fé€\u{1F600}"');
    expect(canonicalize("  ")).toBe('"  "');
  });

  it("ac-13: rejects lone surrogates", () => {
    expect(() => canonicalize("\uD800")).toThrow(JcsError);
    expect(() => canonicalize({ "\uDC00": 1 })).toThrow(JcsError);
  });

  it("ac-13: serialises integers, literals and rejects floats and non-safe integers", () => {
    expect(canonicalize([0, 7, 9007199254740991, true, false, null])).toBe("[0,7,9007199254740991,true,false,null]");
    expect(canonicalize(-0)).toBe("0");
    expect(() => canonicalize(1.5)).toThrow(JcsError);
    expect(() => canonicalize(9007199254740992)).toThrow(JcsError);
    expect(() => canonicalize(Number.NaN)).toThrow(JcsError);
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow(JcsError);
    expect(() => canonicalize(undefined)).toThrow(JcsError);
    expect(() => canonicalize({ a: () => 1 })).toThrow(JcsError);
    expect(() => canonicalize(10n)).toThrow(JcsError);
  });

  it("ac-13: accepts bytes that are exactly their JCS form", () => {
    const r = parseCanonicalJson(enc('{"a":[1,"x"],"b":{"c":null}}'));
    expect(r).toEqual({ ok: true, value: { a: [1, "x"], b: { c: null } } });
  });

  it("ac-13: rejects non-canonical bytes with E_NONCANONICAL", () => {
    const cases = [
      '{"b":1,"a":2}', // key order
      '{"a": 1}', // whitespace
      '{"a":1}\n', // trailing newline
      "﻿{}", // BOM
      '{"a":1.0}', // float spelling of an integer
      '{"a":1e2}', // exponent
      '{"a":"\\u0041"}', // unnecessary escape
      '{"a":1,"a":1}', // duplicate key
      '"\\u00e9"', // escaped non-ASCII
    ];
    for (const c of cases) {
      const r = parseCanonicalJson(enc(c));
      expect(r.ok, c).toBe(false);
      if (!r.ok) expect(r.code, c).toBe("E_NONCANONICAL");
    }
  });

  it("ac-13: rejects invalid UTF-8 and invalid JSON", () => {
    const bad = parseCanonicalJson(new Uint8Array([0x22, 0xc3, 0x28, 0x22]));
    expect(bad.ok).toBe(false);
    const junk = parseCanonicalJson(enc("{nope"));
    expect(junk.ok).toBe(false);
  });

  it("ac-13: rejects floats and integers beyond 2^53-1 even when written canonically", () => {
    for (const c of ['{"a":1.5}', '{"a":9007199254740993}', '{"a":12345678901234567890}']) {
      const r = parseCanonicalJson(enc(c));
      expect(r.ok, c).toBe(false);
    }
  });
});
