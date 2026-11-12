import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** The contract folder: the verifier reads nothing else in the repo. */
export const contractDir = resolve(here, "../../../../contracts/evidence-wire-format/v1");
export const vectorsDir = join(contractDir, "golden-vectors");

export interface VectorCase {
  name: string;
  dir: string;
  bundles: { name: string; bytes: Uint8Array }[];
  expected: Record<string, unknown>;
}

export function listCases(): string[] {
  return readdirSync(vectorsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

export function loadCase(name: string): VectorCase {
  const dir = join(vectorsDir, name);
  const bundles = readdirSync(dir)
    .filter((f) => f.endsWith(".zip"))
    .sort()
    .map((f) => ({ name: f, bytes: new Uint8Array(readFileSync(join(dir, f))) }));
  const expected = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Record<string, unknown>;
  return { name, dir, bundles, expected };
}
