import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCase } from "./helpers/vectors.js";

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let outDir = "";

/** Compile the CLI into a temporary folder so the test never depends on a previous build. */
beforeAll(() => {
  outDir = mkdtempSync(join(tmpdir(), "aios-verify-test-"));
  const tsc = createRequire(join(pkgDir, "package.json")).resolve("typescript/bin/tsc");
  const r = spawnSync(process.execPath, [tsc, "-p", join(pkgDir, "tsconfig.json"), "--outDir", outDir, "--declaration", "false", "--sourceMap", "false"], {
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`tsc failed: ${r.stdout}${r.stderr}`);
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

function cli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [join(outDir, "cli.js"), ...args], { encoding: "utf8" });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const bundlePaths = (name: string): string[] => {
  const c = loadCase(name);
  return c.bundles.map((b) => join(c.dir, b.name));
};

describe("aios-verify CLI", () => {
  it("ac-13: prints intact and exits 0 on the intact vector", () => {
    const r = cli(...bundlePaths("intact"));
    expect(r.status).toBe(0);
    expect(r.stdout.split(/\r?\n/)[0]).toBe("intact");
    expect(r.stdout).toContain("3f2a9c1e-7b4d-4e8f-9a01-0c1d2e3f4a5b");
    expect(r.stdout).toContain("27bae617870a907c45fe37e0beef3b7dd1499bdeeb64051e0658310f3d585093");
    expect(r.stdout).toContain("self-custodied Local, no anchor");
  });

  it("ac-13: never prints event body content", () => {
    const r = cli(...bundlePaths("intact"), "--json");
    for (const s of ["minicpm5", "restricted", "a1a1a1a1-0000-4000-8000-000000000001", "0.1.0"]) {
      expect(r.stdout).not.toContain(s);
    }
  });

  it("ac-13 ac-18: prints branched and exits 1 on the branched vector", () => {
    const r = cli(...bundlePaths("branched"));
    expect(r.status).toBe(1);
    expect(r.stdout.split(/\r?\n/)[0]).toBe("branched");
  });

  it("ac-13: exits 2 for altered, truncated and unknown_signer", () => {
    for (const [name, verdict] of [
      ["altered", "altered"],
      ["truncated", "truncated"],
      ["unknown-signer", "unknown_signer"],
    ] as const) {
      const r = cli(...bundlePaths(name));
      expect(r.status, name).toBe(2);
      expect(r.stdout.split(/\r?\n/)[0], name).toBe(verdict);
    }
  });

  it("ac-13: --json prints a machine-readable result", () => {
    const r = cli(...bundlePaths("restore-two-signers"), "--json");
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout) as {
      verdict: string;
      exit_code: number;
      streams: { epochs: number[]; keys: { key_id: string }[] }[];
    };
    expect(out.verdict).toBe("intact");
    expect(out.exit_code).toBe(0);
    expect(out.streams[0]!.epochs).toEqual([1, 2]);
  });

  it("ac-13: --expect-key checks the epoch-1 trust anchor", () => {
    const good = cli(...bundlePaths("intact"), "--expect-key", "27bae617870a907c45fe37e0beef3b7dd1499bdeeb64051e0658310f3d585093");
    expect(good.status).toBe(0);
    const bad = cli(...bundlePaths("intact"), "--expect-key", "f".repeat(64));
    expect(bad.status).toBe(2);
    expect(bad.stdout.split(/\r?\n/)[0]).toBe("unknown_signer");
  });

  it("ac-13: usage and IO errors exit 3", () => {
    expect(cli().status).toBe(3);
    expect(cli("--bogus", ...bundlePaths("intact")).status).toBe(3);
    expect(cli("--expect-key", "nothex", ...bundlePaths("intact")).status).toBe(3);
    expect(cli(join(outDir, "does-not-exist.zip")).status).toBe(3);
  });
});
