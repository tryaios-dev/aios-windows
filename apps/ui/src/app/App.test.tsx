import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "./App";

describe("app shell", () => {
  it("renders in a plain browser without window.aios", async () => {
    render(<App />);
    expect(await screen.findByText("Browser preview (no backend)")).toBeTruthy();
  });
});
