import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Content-free logging (SR-07, M-21): only allow-listed keys reach the log, and an event is a
 * short name, never a sentence. In the installed app the lines go to `main.log` in the shared
 * logs folder (the one the support bundle collects); the folder is kept within 14 days and 20 MB
 * together with the backend's and the evidence writer's files (same rules as
 * aios_common.logging). Electron's crash reporter is never started: no crash dumps are sent
 * anywhere (question 19).
 */
const ALLOWED = new Set(["port", "durationMs", "status", "errorCode", "component"]);
const EVENT_NAME = /^[a-z][a-z0-9_.]{0,63}$/;

export const MAIN_LOG_MAX_BYTES = 1024 * 1024; // main.log + main.log.1 = 2 MB of the 20 MB budget
const MAX_AGE_MS = 14 * 86_400_000;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

let logFile: string | null = null;
let written = 0;
let maxBytes = MAIN_LOG_MAX_BYTES;

function isLogFile(name: string): boolean {
  return name.endsWith(".log") || /\.log\.\d+$/.test(name);
}

/** Delete log files older than 14 days, then the oldest until the folder holds at most 20 MB. */
export function pruneLogs(dir: string, now = Date.now()): void {
  let entries: { full: string; mtime: number; size: number }[] = [];
  try {
    entries = readdirSync(dir)
      .filter(isLogFile)
      .map((name) => {
        const full = path.join(dir, name);
        const st = statSync(full);
        return { full, mtime: st.mtimeMs, size: st.size };
      });
  } catch {
    return;
  }
  const kept = entries.filter((e) => {
    if (now - e.mtime <= MAX_AGE_MS) return true;
    rmSync(e.full, { force: true });
    return false;
  });
  kept.sort((a, b) => a.mtime - b.mtime);
  let total = kept.reduce((sum, e) => sum + e.size, 0);
  for (const e of kept) {
    if (total <= MAX_TOTAL_BYTES) break;
    rmSync(e.full, { force: true });
    total -= e.size;
  }
}

/** Log to `<dir>/main.log` from now on (installed app). Without it, lines go to stdout only. */
export function configureLogFile(dir: string, limit = MAIN_LOG_MAX_BYTES): void {
  maxBytes = limit;
  mkdirSync(dir, { recursive: true });
  pruneLogs(dir);
  logFile = path.join(dir, "main.log");
  try {
    written = statSync(logFile).size;
  } catch {
    written = 0;
  }
}

function rotate(file: string): void {
  try {
    renameSync(file, `${file}.1`); // replaces the older file
  } catch {
    /* nothing to rotate */
  }
  written = 0;
}

export function log(event: string, fields: Record<string, unknown> = {}): void {
  const safe = Object.fromEntries(Object.entries(fields).filter(([k]) => ALLOWED.has(k)));
  const name = EVENT_NAME.test(event) ? event : "unnamed";
  const line = JSON.stringify({ ts: new Date().toISOString(), event: name, ...safe }) + "\n";
  if (logFile === null) {
    process.stdout.write(line);
    return;
  }
  try {
    if (written + line.length > maxBytes) rotate(logFile);
    appendFileSync(logFile, line, "utf8");
    written += Buffer.byteLength(line);
  } catch {
    /* a log that cannot be written never stops the app */
  }
}
