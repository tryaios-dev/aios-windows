import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AiosBridge } from "@aios/bridge-contract";
import { SpikeScreen } from "./SpikeScreen";

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
});
