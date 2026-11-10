import { spawn, type ChildProcess } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import { createInterface } from "node:readline";
import { currentPlatform } from "../platform/index.js";
import { launchToken } from "./token.js";
import { BackendClient } from "./client.js";
import { handshakeFrame, parseReadyLine, type Ready } from "./protocol.js";

export interface BackendHandle {
  apiPort: number;
  client: BackendClient;
}

let child: ChildProcess | undefined;

const repoRoot = () => path.join(import.meta.dirname, "../../../../..");

/** Start the backend; the token goes over stdin, then stdin is closed (Process and IPC Contract v1).
 * Which program starts, and with which environment, comes from the platform layer (../platform). */
export async function startBackend(): Promise<BackendHandle> {
  const token = launchToken();
  const { cmd, args, env } = currentPlatform().backendCommand({
    packaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    repoRoot: repoRoot(),
  });
  const proc = spawn(cmd, args, { stdio: ["pipe", "pipe", "inherit"], windowsHide: true, env });
  child = proc;
  proc.stdin?.end(handshakeFrame(token));

  const ready = await new Promise<Ready>((resolve, reject) => {
    const rl = createInterface({ input: proc.stdout! });
    const timer = setTimeout(() => reject(new Error("backend_start_timeout")), 30_000);
    rl.on("line", (line) => {
      const payload = parseReadyLine(line);
      if (payload) {
        clearTimeout(timer);
        resolve(payload);
      }
    });
    proc.once("error", (err) => reject(err));
    proc.once("exit", (code) => reject(new Error(`backend_exit_${code}`)));
  });

  return { apiPort: ready.api_port, client: new BackendClient(ready.api_port, token) };
}

export async function stopBackend(): Promise<void> {
  if (child) currentPlatform().stopProcessTree(child);
  child = undefined;
}
