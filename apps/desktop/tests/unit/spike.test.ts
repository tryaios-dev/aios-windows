import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

const { SseReader, collectAnswer } = await import("../../src/main/ipc/spike.js");

async function* from(items: string[]) {
  yield* items;
}

describe("SPIKE-D04 stream handling", () => {
  it("splits events across arbitrary chunk boundaries", () => {
    const r = new SseReader();
    expect(r.push('data: {"a":')).toEqual([]);
    expect(r.push('1}\n\ndata: [DO')).toEqual(['{"a":1}']);
    expect(r.push("NE]\r\n\r\n")).toEqual(["[DONE]"]);
  });

  it("joins content deltas and reads llama-server timings", async () => {
    let t = 0;
    const now = () => (t += 100);
    const answer = await collectAnswer(
      from([
        '{"choices":[{"delta":{"role":"assistant"}}]}',
        '{"choices":[{"delta":{"content":"Hel"}}]}',
        '{"choices":[{"delta":{"content":"lo"}}]}',
        '{"choices":[],"usage":{"completion_tokens":2},"timings":{"predicted_n":2,"predicted_per_second":12.5}}',
        "[DONE]",
      ]),
      0,
      now,
    );
    expect(answer).toEqual({ text: "Hello", error: null, firstTokenMs: 100, totalMs: 200, tokens: 2, tokensPerSecond: 12.5 });
  });

  it("reports an engine error as a code only", async () => {
    const answer = await collectAnswer(from(['{"error":"engine_error"}']), 0, () => 1);
    expect(answer.error).toBe("engine_error");
    expect(answer.text).toBe("");
  });
});
