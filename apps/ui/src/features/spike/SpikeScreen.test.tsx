import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render as rtlRender, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiosBridge } from "@aios/bridge-contract";
import type { Health } from "@aios/bridge-contract";
import { SpikeScreen, engineLine } from "./SpikeScreen";

const render = (ui: React.ReactElement) =>
  rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);

const HEALTH: Health = {
  backend: "ok",
  database: "ok",
  engine: "not_started",
  engine_build: null,
  engine_model: null,
  engine_cpu_fallback: false,
  engine_idle_unloaded: false,
  evidence_writer: "not_started",
  version: "0.1.0",
};

afterEach(() => {
  cleanup();
  delete (window as { aios?: AiosBridge }).aios;
});

describe("SPIKE-D04 screen", () => {
  it("sends the prompt and shows the answer with its timings", async () => {
    const ask = vi.fn().mockResolvedValue({
      text: "A model that runs on this computer.",
      error: null,
      firstTokenMs: 1500,
      totalMs: 4000,
      tokens: 9,
      tokensPerSecond: 12.3,
    });
    (window as { aios?: Partial<AiosBridge> }).aios = { spike: { ask } };
    render(<SpikeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Ask the local model/ }));
    expect(await screen.findByText("A model that runs on this computer.")).toBeTruthy();
    expect(screen.getByText("1.50 s")).toBeTruthy();
    expect(screen.getByText("12.3")).toBeTruthy();
    expect(ask).toHaveBeenCalledWith("In one sentence, what is a local AI model?");
  });

  it("explains a missing model", async () => {
    const ask = vi.fn().mockResolvedValue({ text: "", error: "no_model", firstTokenMs: null, totalMs: 1, tokens: null, tokensPerSecond: null });
    (window as { aios?: Partial<AiosBridge> }).aios = { spike: { ask } };
    render(<SpikeScreen />);
    fireEvent.click(screen.getByRole("button", { name: /Ask the local model/ }));
    expect(await screen.findByText(/Copy a .gguf file/)).toBeTruthy();
  });

  it("tells the user when the GPU build failed and the CPU build took over", async () => {
    const health = vi.fn().mockResolvedValue({ ...HEALTH, engine: "ok", engine_build: "cpu", engine_model: "m.gguf", engine_cpu_fallback: true });
    (window as { aios?: Partial<AiosBridge> }).aios = { system: { health }, spike: { ask: vi.fn() } };
    render(<SpikeScreen />);
    expect(await screen.findByText("Running on the CPU")).toBeTruthy();
    expect(screen.getByText("Running on the CPU build · m.gguf")).toBeTruthy();
  });

  it("describes each engine state", () => {
    expect(engineLine(HEALTH)).toMatch(/starts on the first question/);
    expect(engineLine({ ...HEALTH, engine_idle_unloaded: true })).toMatch(/Unloaded after idle time/);
    expect(engineLine({ ...HEALTH, engine: "starting", engine_build: "vulkan", engine_model: "m.gguf" })).toBe("Loading on the GPU build · m.gguf");
    expect(engineLine({ ...HEALTH, engine: "failed" })).toMatch(/restarts on the next question/);
  });
});
