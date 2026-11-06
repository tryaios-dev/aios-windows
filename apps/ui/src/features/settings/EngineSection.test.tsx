import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/bridge/sim/store";
import { EngineSection } from "./EngineSection";

const show = () =>
  render(
    <MemoryRouter>
      <EngineSection />
    </MemoryRouter>,
  );

beforeEach(() => useStore.getState().resetFirstRun("fresh"));
afterEach(cleanup);

describe("Settings > Engine (D-06)", () => {
  it("shows the CPU build as Safe mode when Safe mode is on", () => {
    useStore.setState((s) => ({
      settings: { ...s.settings, safe_mode_cpu: true },
      health: { ...s.health, engine_build: "cpu" },
    }));
    show();
    expect(screen.getByText("CPU (Safe mode)")).toBeTruthy();
  });

  it("shows the GPU build when the engine runs on it", () => {
    useStore.setState((s) => ({ health: { ...s.health, engine_build: "vulkan" } }));
    show();
    expect(screen.getByText("GPU (Vulkan)")).toBeTruthy();
  });

  it("shows the shared fallback notice", () => {
    useStore.setState({ fallbackNotice: { at: new Date().toISOString(), dismissed: false } });
    show();
    expect(screen.getByText(/AIOS restarted the engine on the CPU build/)).toBeTruthy();
  });
});
