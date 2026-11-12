import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { commitment, decodeBase64Url, domainHash, keyIdFromPublicKey } from "../src/crypto.js";
import { vectorsDir } from "./helpers/vectors.js";

interface CommitmentExample {
  tag: string;
  nonce_b64url: string;
  bytes_utf8: string;
  commitment: string;
}

const examples = JSON.parse(readFileSync(join(vectorsDir, "commitments.json"), "utf8")) as Record<
  string,
  unknown
>;

describe("commitments and hashing (spec sections 2 and 8)", () => {
  for (const which of ["input", "output"] as const) {
    it(`ac-13: reproduces the ${which} commitment example`, () => {
      const ex = examples[which] as CommitmentExample;
      const nonce = decodeBase64Url(ex.nonce_b64url);
      expect(nonce).toHaveLength(32);
      expect(commitment(ex.tag, nonce, new TextEncoder().encode(ex.bytes_utf8))).toBe(ex.commitment);
    });
  }

  it("ac-13: H(tag, bytes) is SHA-256(tag || 0x00 || bytes) in lowercase hex", () => {
    const expected = createHash("sha256").update(Buffer.from([0x61, 0x00, 0x62])).digest("hex");
    expect(domainHash("a", new Uint8Array([0x62]))).toBe(expected);
  });

  it("ac-13: key_id of the vectors' epoch-1 key is H(aios/key/v1/ed25519, raw key)", () => {
    const raw = decodeBase64Url("ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ");
    expect(keyIdFromPublicKey(raw)).toBe("27bae617870a907c45fe37e0beef3b7dd1499bdeeb64051e0658310f3d585093");
  });

  it("ac-13: base64url decoding is strict (no padding, no standard alphabet, zero tail bits)", () => {
    expect(() => decodeBase64Url("YQ==")).toThrow();
    expect(() => decodeBase64Url("a+b/")).toThrow();
    expect(() => decodeBase64Url("YR")).toThrow();
    expect(() => decodeBase64Url("Y")).toThrow();
    expect(Buffer.from(decodeBase64Url("YQ")).toString("utf8")).toBe("a");
  });
});
