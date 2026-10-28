import { randomBytes } from "node:crypto";

/** Per-launch token: generated in memory, never logged, written or put in argv/env (SR-08). */
let token: string | undefined;

export function launchToken(): string {
  token ??= randomBytes(32).toString("base64url");
  return token;
}
