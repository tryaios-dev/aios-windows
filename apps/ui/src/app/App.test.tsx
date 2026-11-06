import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { useStore } from "@/bridge/sim/store";
import { App } from "./App";

afterEach(() => {
  window.location.hash = "";
  act(() => useStore.getState().resetFirstRun("fresh"));
  globalThis.localStorage?.clear();
});

describe("app shell", () => {
  it("opens the first-run wizard on a fresh install", async () => {
    render(<App />);
    expect(await screen.findByText("Private AI on this computer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Set up AIOS/ })).toBeTruthy();
  });

  it("opens the default project once first run is complete", async () => {
    act(() => useStore.getState().completeFirstRun({ installedModelId: "qwen3-8b-q4km" }));
    render(<App />);
    expect(await screen.findByText("Start your first conversation")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My workspace" })).toBeTruthy();
    expect(screen.getByText("Evidence recording")).toBeTruthy();
  });

  it("records the first-run events in the evidence log", () => {
    act(() => useStore.getState().completeFirstRun({ installedModelId: "qwen3-8b-q4km" }));
    const types = useStore.getState().events.map((e) => e.event_type);
    expect(types).toEqual([
      "install",
      "store_created",
      "recovery_package_written",
      "recovery_key_issued",
      "model_installed",
      "project_created",
    ]);
  });
});
