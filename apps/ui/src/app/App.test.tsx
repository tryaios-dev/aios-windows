import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "./App";
import { useSession } from "./session";

afterEach(() => {
  window.location.hash = "";
  useSession.setState({ firstRunComplete: false });
});

describe("app shell", () => {
  it("opens the first-run wizard on a fresh install", async () => {
    render(<App />);
    expect(await screen.findByText("Private AI on this computer.")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Set up AIOS/ })).toBeTruthy();
  });

  it("opens the default project once first run is complete", async () => {
    act(() => useSession.getState().completeFirstRun({ installedModel: { id: "qwen3-8b-q4km", name: "Qwen3 8B" } }));
    render(<App />);
    expect(await screen.findByText("Start your first conversation")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "My workspace" })).toBeTruthy();
    expect(screen.getByText("Engine idle")).toBeTruthy();
  });
});
