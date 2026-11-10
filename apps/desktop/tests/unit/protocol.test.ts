import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handshakeFrame, parseReadyLine } from "../../src/main/backend/protocol.js";

const vectors = (name: string) =>
  JSON.parse(
    readFileSync(
      path.join(import.meta.dirname, "../../../../contracts/process-ipc/v1/golden-vectors", name),
      "utf-8",
    ),
  ).vectors as Array<Record<string, unknown>>;

describe("process-ipc v1 golden vectors (Electron main side)", () => {
  const frames = vectors("handshake-frames.json").filter((v) => v.valid && typeof v.token === "string");

  it.each(frames.map((v) => [v.name, v] as const))("frame: %s", (_name, v) => {
    const frame = handshakeFrame(v.token as string, v.api_port as number);
    expect(frame.endsWith("\n")).toBe(true);
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(4096);
    // Main always sends api_port; a vector may omit it (schema default 0).
    expect(JSON.parse(frame)).toEqual({ api_port: 0, ...JSON.parse(v.frame as string) });
  });

  it.each(vectors("ready-lines.json").map((v) => [v.name, v] as const))("READY: %s", (_name, v) => {
    const parsed = parseReadyLine(v.line as string);
    if (v.valid) {
      expect(parsed?.api_port).toBe(v.api_port);
      expect(parsed?.gateway_port).toBe(v.gateway_port);
    } else {
      expect(parsed).toBeNull();
    }
  });
});
