/** Content-free logging: only whitelisted keys reach the log (SR-07). */
const ALLOWED = new Set(["port", "durationMs", "status", "errorCode", "component"]);

export function log(event: string, fields: Record<string, unknown> = {}): void {
  const safe = Object.fromEntries(Object.entries(fields).filter(([k]) => ALLOWED.has(k)));
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), event, ...safe }) + "\n");
}
