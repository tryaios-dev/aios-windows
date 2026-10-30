// B-05: fail on any `pnpm audit` finding that is not in the exceptions record.
//   pnpm audit --prod --json > pnpm-audit.json; node tools/release/check-npm-audit.mjs pnpm-audit.json
import { readFileSync } from "node:fs";

const audit = JSON.parse(readFileSync(process.argv[2], "utf8"));
const record = JSON.parse(readFileSync(new URL("../../docs/security/dependency-exceptions.json", import.meta.url), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const accepted = new Set(record.exceptions.filter((e) => e.reason && (e.review_by ?? "9999") >= today).map((e) => e.id));

const open = Object.values(audit.advisories ?? {}).filter(
  (a) => !accepted.has(a.github_advisory_id) && !(a.cves ?? []).some((c) => accepted.has(c)),
);
for (const a of open) console.log(`FINDING ${a.module_name}: ${a.github_advisory_id} ${a.severity} ${a.title}`);
console.log(`node dependency scan: ${open.length} open finding(s)`);
process.exit(open.length ? 1 : 0);
