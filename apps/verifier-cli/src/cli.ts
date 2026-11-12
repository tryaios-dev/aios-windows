#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyBundles, type BundleInput, type StreamReport, type VerificationReport } from "./verify.js";

export const EXIT_USAGE = 3;
const MAX_BUNDLE_BYTES = 2 * 1024 * 1024 * 1024 - 1;

const USAGE = `usage: aios-verify <bundle.zip> [<bundle.zip> ...] [--json] [--expect-key <key_id>]

Verifies AIOS evidence export bundles (evidence-wire-format v1) and prints one verdict:
intact, altered, truncated, branched or unknown_signer.

  --json                 print a machine-readable result
  --expect-key <key_id>  the epoch-1 key_id you obtained out of band (trust anchor)

exit codes: 0 intact, 1 branched, 2 altered/truncated/unknown_signer, 3 usage or IO error`;

interface Args {
  files: string[];
  json: boolean;
  expectKey?: string;
}

class UsageError extends Error {}

function parseArgs(argv: string[]): Args {
  const args: Args = { files: [], json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--json") args.json = true;
    else if (a === "--expect-key") {
      const v = argv[++i];
      if (v === undefined || !/^[0-9a-f]{64}$/.test(v)) throw new UsageError("--expect-key needs a 64-character lowercase hex key_id");
      args.expectKey = v;
    } else if (a === "--help" || a === "-h") throw new UsageError("");
    else if (a.startsWith("-")) throw new UsageError(`unknown option ${a}`);
    else args.files.push(a);
  }
  if (args.files.length === 0) throw new UsageError("no bundle given");
  return args;
}

function formatStream(s: StreamReport): string[] {
  const lines: string[] = [];
  lines.push(`stream    ${s.stream_id}  verdict ${s.verdict}`);
  if (s.epochs.length > 0) lines.push(`epochs    ${s.epochs[0]}..${s.epochs[s.epochs.length - 1]}`);
  for (const k of s.keys) lines.push(`key       epoch ${k.epoch}  key_id ${k.key_id}${k.epoch === 1 ? "  (trust anchor: compare out of band)" : ""}`);
  for (const b of s.bundles) {
    const scope = [`kind ${b.scope.kind}`, `seq ${b.scope.first_seq}..${b.scope.last_seq}`];
    if (b.scope.project_id) scope.push(`project_id ${b.scope.project_id}`);
    if (b.scope.from !== undefined || b.scope.to !== undefined) scope.push(`dates ${b.scope.from ?? ""}..${b.scope.to ?? ""}`);
    lines.push(`bundle    ${b.file}  export_id ${b.export_id}  created_at ${b.created_at}`);
    lines.push(`  range   seq ${b.from_seq}..${b.to_seq}  tip ${b.tip_hash}`);
    lines.push(`  counts  ${b.event_count} events, ${b.checkpoint_count} checkpoints`);
    lines.push(`  scope   ${scope.join("  ")}`);
    lines.push(`  custody ${b.custody}`);
    lines.push(`  signer  ${b.manifest_key_id ?? "(none)"}`);
  }
  for (const br of s.branches) {
    lines.push(`branch    after seq ${br.after_seq}  prev_hash ${br.prev_hash}`);
    for (const h of br.heads) lines.push(`  head    ${h}`);
  }
  for (const e of s.errors) lines.push(`error     ${e.code}${e.seq !== undefined ? ` seq ${e.seq}` : ""}${e.bundle ? ` [${e.bundle}]` : ""}  ${e.detail}`);
  for (const w of s.warnings) lines.push(`warning   ${w.code}${w.seq !== undefined ? ` seq ${w.seq}` : ""}${w.bundle ? ` [${w.bundle}]` : ""}  ${w.detail}`);
  return lines;
}

export function formatReport(r: VerificationReport): string {
  const lines: string[] = [r.verdict];
  for (const e of r.errors) lines.push(`error     ${e.code}${e.bundle ? ` [${e.bundle}]` : ""}  ${e.detail}`);
  for (const s of r.streams) lines.push(...formatStream(s));
  return lines.join("\n") + "\n";
}

export function main(argv: string[], out: (s: string) => void, err: (s: string) => void): number {
  let args: Args;
  try {
    args = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      if (e.message) err(`aios-verify: ${e.message}\n`);
      err(USAGE + "\n");
      return EXIT_USAGE;
    }
    throw e;
  }
  const inputs: BundleInput[] = [];
  for (const f of args.files) {
    try {
      const bytes = readFileSync(f);
      if (bytes.length > MAX_BUNDLE_BYTES) throw new Error("too large");
      inputs.push({ name: basename(f), bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
    } catch {
      err(`aios-verify: cannot read ${f}\n`);
      return EXIT_USAGE;
    }
  }
  const report = verifyBundles(inputs, args.expectKey === undefined ? {} : { expectKey: args.expectKey });
  out(args.json ? JSON.stringify(report, null, 2) + "\n" : formatReport(report));
  return report.exit_code;
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(script)).href;
  } catch {
    return false;
  }
}

const invokedDirectly = isEntryPoint();
if (invokedDirectly) {
  process.exitCode = main(
    process.argv.slice(2),
    (s) => process.stdout.write(s),
    (s) => process.stderr.write(s),
  );
}
