import { z } from "zod";

/**
 * Process and IPC Contract v1, section 4: the frame Electron main writes to the backend's stdin
 * and the READY line it reads back. Checked against contracts/process-ipc/v1/golden-vectors/.
 */

export const READY_PREFIX = "READY ";

/** One JSON object + LF. api_port 0 lets the backend bind a free port itself (no race). */
export function handshakeFrame(token: string, apiPort = 0): string {
  return JSON.stringify({ token, api_port: apiPort }) + "\n";
}

const Port = z.number().int().min(1).max(65535);
/** Unknown fields are ignored: later versions only add optional fields. */
const ReadyPayload = z.object({ api_port: Port, gateway_port: Port.optional() });
export type Ready = z.infer<typeof ReadyPayload>;

/** The READY payload, or null for any other stdout line (main ignores those). */
export function parseReadyLine(line: string): Ready | null {
  if (!line.startsWith(READY_PREFIX)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(line.slice(READY_PREFIX.length));
  } catch {
    return null;
  }
  const parsed = ReadyPayload.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
