import { describe, expect, it } from "vitest";
import { verifyBundles } from "../src/verify.js";
import { listCases, loadCase } from "./helpers/vectors.js";

const KNOWN_EXPECTED_FIELDS = new Set(["verdict", "error", "to_seq", "scope", "epochs", "key_ids", "branch_after_seq"]);

describe("golden vectors (contracts/evidence-wire-format/v1)", () => {
  it("ac-13: the vector set contains every documented case", () => {
    expect(listCases()).toEqual([
      "altered",
      "branched",
      "intact",
      "project-scope",
      "restore-two-signers",
      "truncated",
      "unknown-signer",
    ]);
  });

  for (const name of listCases()) {
    const tag = name === "branched" ? "ac-13 ac-18" : "ac-13";
    it(`${tag}: golden vector "${name}" gives exactly its expected verdict and fields`, () => {
      const c = loadCase(name);
      const report = verifyBundles(c.bundles);
      for (const key of Object.keys(c.expected)) {
        expect(KNOWN_EXPECTED_FIELDS.has(key), `unhandled expected.json field "${key}"`).toBe(true);
      }
      expect(report.verdict).toBe(c.expected["verdict"]);
      expect(report.errors).toEqual([]);
      expect(report.streams).toHaveLength(1);
      const stream = report.streams[0]!;
      expect(stream.verdict).toBe(c.expected["verdict"]);
      expect(stream.bundles).toHaveLength(c.bundles.length);
      const codes = stream.errors.map((e) => e.code);
      if ("error" in c.expected) {
        expect(codes).toContain(c.expected["error"]);
      }
      if ("to_seq" in c.expected) {
        expect(stream.bundles.map((b) => b.to_seq)).toContain(c.expected["to_seq"]);
      }
      if ("scope" in c.expected) {
        expect(stream.bundles[0]!.scope).toMatchObject(c.expected["scope"] as object);
      }
      if ("epochs" in c.expected) {
        expect(stream.epochs).toEqual(c.expected["epochs"]);
      }
      if ("key_ids" in c.expected) {
        expect(stream.keys.map((k) => k.key_id)).toEqual(c.expected["key_ids"]);
      }
      if ("branch_after_seq" in c.expected) {
        expect(stream.branches.map((b) => b.after_seq)).toEqual([c.expected["branch_after_seq"]]);
      }
      if (c.expected["verdict"] === "intact") {
        expect(stream.errors).toEqual([]);
        expect(stream.branches).toEqual([]);
      }
    });
  }

  it("ac-13: the altered vector reports a broken hash link, not truncation", () => {
    const stream = verifyBundles(loadCase("altered").bundles).streams[0]!;
    const codes = stream.errors.map((e) => e.code);
    expect(codes).toContain("E_PREV_MISMATCH");
    expect(codes).not.toContain("E_TRUNCATED");
  });

  it("ac-13: the truncated vector reports only truncation (the digest mismatch is explained)", () => {
    const stream = verifyBundles(loadCase("truncated").bundles).streams[0]!;
    expect([...new Set(stream.errors.map((e) => e.code))]).toEqual(["E_TRUNCATED"]);
  });

  it("ac-13: the unknown-signer vector reports only the unknown manifest signer", () => {
    const stream = verifyBundles(loadCase("unknown-signer").bundles).streams[0]!;
    expect([...new Set(stream.errors.map((e) => e.code))]).toEqual(["E_UNKNOWN_SIGNER"]);
  });

  it("ac-13 ac-18: each branched bundle alone is intact; together they are branched", () => {
    const c = loadCase("branched");
    for (const b of c.bundles) {
      expect(verifyBundles([b]).verdict).toBe("intact");
    }
    const stream = verifyBundles(c.bundles).streams[0]!;
    expect(stream.errors).toEqual([]);
    expect(stream.branches[0]!.heads).toHaveLength(2);
    expect(stream.epochs).toEqual([1, 2]);
  });

  it("ac-13: the epoch-1 trust anchor is reported and a different --expect-key gives unknown_signer", () => {
    const c = loadCase("intact");
    const anchor = verifyBundles(c.bundles).streams[0]!.keys[0]!;
    expect(anchor.epoch).toBe(1);
    expect(verifyBundles(c.bundles, { expectKey: anchor.key_id }).verdict).toBe("intact");
    const wrong = verifyBundles(c.bundles, { expectKey: "0".repeat(64) });
    expect(wrong.verdict).toBe("unknown_signer");
    expect(wrong.streams[0]!.errors.map((e) => e.code)).toContain("E_UNKNOWN_SIGNER");
  });

  it("ac-13: the restore vector accepts the handover checkpoint signed by the previous epoch's key", () => {
    const stream = verifyBundles(loadCase("restore-two-signers").bundles).streams[0]!;
    expect(stream.verdict).toBe("intact");
    expect(stream.bundles[0]!.checkpoint_count).toBe(5);
    expect(stream.bundles[0]!.event_count).toBe(8);
  });

  it("ac-13: the intact vector has no unsigned tail warning (last checkpoint covers to_seq)", () => {
    const stream = verifyBundles(loadCase("intact").bundles).streams[0]!;
    expect(stream.warnings.map((w) => w.code)).not.toContain("W_UNSIGNED_TAIL");
    expect(stream.bundles[0]!.custody).toBe("self-custodied Local, no anchor");
  });
});
