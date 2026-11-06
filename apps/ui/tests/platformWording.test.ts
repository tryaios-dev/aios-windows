import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "../src");
// Sample data of the browser simulation describes a sample Windows machine; that is fine.
const ALLOWED = [path.join(SRC, "lib", "platform.ts"), path.join(SRC, "bridge", "sim")];
const OS_WORDING =
  /Credential Manager|LOCALAPPDATA|BitLocker|Setup\.exe|["`]Windows|Windows (user|account|sign-in|settings|build)\b/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** Runs outside src/: the renderer may not import Node modules (eslint), this test must. */
describe("platform wording", () => {
  it("keeps OS wording in src/lib/platform.ts", () => {
    const offenders = files(SRC)
      .filter((f) => !ALLOWED.some((a) => f.startsWith(a)))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split(/\r?\n/)
          .flatMap((line, i) => (OS_WORDING.test(line) ? [`${path.relative(SRC, f)}:${i + 1}`] : [])),
      );
    expect(offenders).toEqual([]);
  });
});
