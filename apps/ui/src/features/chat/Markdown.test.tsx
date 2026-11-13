import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Markdown } from "./Markdown";

/**
 * AC-11, M-20, SR-06: model output is data, not code. A prompt injection in an answer cannot run
 * script, load remote content, or open a link without the user's confirmation.
 */
afterEach(() => {
  cleanup();
  delete (window as unknown as { aios?: object }).aios;
  vi.restoreAllMocks();
});

const HOSTILE = [
  "Here you go.",
  '<script>window.stolen = "token"</script>',
  '<img src="https://evil.test/pixel.gif" onerror="window.stolen = 1">',
  "![tracker](https://evil.test/track.png)",
  "[click me](javascript:alert(1))",
  '<iframe src="https://evil.test/"></iframe>',
  "[data](data:text/html;base64,PHNjcmlwdD4=)",
].join("\n\n");

describe("ac-11 markdown renders model output inert", () => {
  it("runs no script and loads no remote content", () => {
    const { container } = render(<Markdown content={HOSTILE} />);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    expect(container.querySelector("img")).toBeNull(); // every image is replaced by a label
    expect(container.textContent).toContain("Image not shown");
    expect((window as unknown as { stolen?: unknown }).stolen).toBeUndefined();
    for (const a of Array.from(container.querySelectorAll("a"))) {
      const href = a.getAttribute("href") ?? "";
      expect(href === "" || /^https?:\/\//.test(href) || href.startsWith("#")).toBe(true);
    }
  });

  it("ac-11 desktop app: a link goes to Electron main's confirmation, never straight to a window", () => {
    const openLink = vi.fn().mockResolvedValue(true);
    (window as unknown as { aios: object }).aios = { system: { openLink } };
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<Markdown content="See [the docs](https://example.org/guide)." />);
    fireEvent.click(screen.getByText("the docs"));
    expect(openLink).toHaveBeenCalledWith("https://example.org/guide");
    expect(opened).not.toHaveBeenCalled();
  });

  it("ac-11 browser preview: a link asks first and opens nothing until confirmed", () => {
    const opened = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<Markdown content="See [the docs](https://example.org/guide)." />);
    fireEvent.click(screen.getByText("the docs"));
    expect(opened).not.toHaveBeenCalled();
    expect(screen.getByText("Open this link in your browser?")).toBeTruthy();
  });
});
