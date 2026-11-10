/**
 * SPIKE-D04 (temporary): ask the backend's spike endpoint for one local answer.
 * Main reads the event stream itself and returns only the text, an error code and timings:
 * the renderer never sees the backend's port, token or error bodies (IPC-62).
 */
import { SpikeAnswer, SpikePrompt } from "@aios/bridge-contract";
import type { Handler } from "./index.js";

const KNOWN_ERRORS = new Set(["no_model", "engine_failed"]);

/** Splits a server-sent event stream into `data:` payloads; tolerates any chunk boundary. */
export class SseReader {
  #buffer = "";

  push(text: string): string[] {
    this.#buffer += text.replace(/\r\n/g, "\n");
    const events: string[] = [];
    let end: number;
    while ((end = this.#buffer.indexOf("\n\n")) !== -1) {
      const block = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 2);
      const data = block
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trimStart())
        .join("\n");
      if (data) events.push(data);
    }
    return events;
  }
}

interface Chunk {
  error?: unknown;
  choices?: Array<{ delta?: { content?: string | null } }>;
  usage?: { completion_tokens?: number };
  timings?: { predicted_n?: number; predicted_per_second?: number };
}

/** Folds OpenAI chat-completion chunks into one answer. `now` is injectable for tests. */
export async function collectAnswer(
  events: AsyncIterable<string>,
  started: number,
  now: () => number = () => performance.now(),
): Promise<SpikeAnswer> {
  let text = "";
  let firstTokenMs: number | null = null;
  let tokens: number | null = null;
  let tokensPerSecond: number | null = null;
  let error: string | null = null;
  for await (const data of events) {
    if (data === "[DONE]") break;
    let chunk: Chunk;
    try {
      chunk = JSON.parse(data) as Chunk;
    } catch {
      continue;
    }
    if (chunk.error) error = "engine_error";
    for (const choice of chunk.choices ?? []) {
      const piece = choice.delta?.content;
      if (piece) {
        if (firstTokenMs === null) firstTokenMs = now() - started;
        text += piece;
      }
    }
    if (chunk.timings?.predicted_n) tokens = chunk.timings.predicted_n;
    if (chunk.timings?.predicted_per_second) tokensPerSecond = chunk.timings.predicted_per_second;
    if (chunk.usage?.completion_tokens) tokens = chunk.usage.completion_tokens;
  }
  return SpikeAnswer.parse({ text, error, firstTokenMs, totalMs: now() - started, tokens, tokensPerSecond });
}

async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = new SseReader();
  const decoder = new TextDecoder();
  for await (const bytes of body as unknown as AsyncIterable<Uint8Array>) {
    yield* reader.push(decoder.decode(bytes, { stream: true }));
  }
}

export const spikeHandlers: Record<string, Handler> = {
  "spike.ask": async (b, prompt) => {
    const content = SpikePrompt.parse(prompt);
    const started = performance.now();
    const failed = (code: string) =>
      SpikeAnswer.parse({ text: "", error: code, firstTokenMs: null, totalMs: performance.now() - started, tokens: null, tokensPerSecond: null });
    let res: Response;
    try {
      res = await b.client.stream("/spike/v1/chat/completions", { messages: [{ role: "user", content }], max_tokens: 512 });
    } catch {
      return failed("backend_unavailable");
    }
    if (!res.ok || !res.body) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return failed(typeof body.error === "string" && KNOWN_ERRORS.has(body.error) ? body.error : `backend_${res.status}`);
    }
    return collectAnswer(sseEvents(res.body), started);
  },
};
