// B-06: prepare the update feed electron-updater reads (generic provider, see
// apps/desktop/electron-builder.yml `publish.url`).
//   node tools/release/publish-update-feed.mjs apps/desktop/release
//
// 1. Checks latest.yml points at an installer that exists and whose sha512 matches.
// 2. Copies installer + blockmap + latest.yml to build/out/update-feed/.
// 3. Uploads them when AIOS_FEED_UPLOAD_CMD is set (masked CI variable; the command for the
//    hosting chosen in A-05, e.g. an rclone or scp line). The files are passed as arguments.
//
// "Signed" means: the installer is Authenticode-signed (checked by verify-signatures.ps1), and
// electron-updater refuses an update whose publisher differs from win.signtoolOptions.publisherName.
// The feed never depends on licence or commercial state.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const dir = process.argv[2] ?? "apps/desktop/release";
const yml = readFileSync(path.join(dir, "latest.yml"), "utf8");
const file = /^path:\s*(.+)$/m.exec(yml)?.[1]?.trim();
const sha512 = /^sha512:\s*(.+)$/m.exec(yml)?.[1]?.trim();
if (!file || !sha512) throw new Error("latest.yml has no path/sha512");

const installer = path.join(dir, file);
const actual = createHash("sha512").update(readFileSync(installer)).digest("base64");
if (actual !== sha512) throw new Error(`sha512 mismatch for ${file}`);

const out = "build/out/update-feed";
mkdirSync(out, { recursive: true });
const files = [file, `${file}.blockmap`, "latest.yml"].filter((f) => existsSync(path.join(dir, f)));
for (const f of files) copyFileSync(path.join(dir, f), path.join(out, f));
console.log(`update feed staged in ${out}: ${files.join(", ")}`);

if (process.env.AIOS_FEED_UPLOAD_CMD) {
  execSync(`${process.env.AIOS_FEED_UPLOAD_CMD} ${files.map((f) => `"${path.join(out, f)}"`).join(" ")}`, { stdio: "inherit" });
  console.log("uploaded");
} else {
  console.log("AIOS_FEED_UPLOAD_CMD not set: staged only");
}
