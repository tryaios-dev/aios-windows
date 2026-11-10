// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./layout";

const setClipboard = (clipboard: unknown) =>
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });

describe("copyText", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses the Clipboard API when it works", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    expect(await copyText("T6RH-3XDV")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("T6RH-3XDV");
  });

  it("falls back to the older copy when the API is refused", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) });
    const exec = vi.fn().mockReturnValue(true);
    document.execCommand = exec;
    expect(await copyText("key")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // the helper field is removed
  });

  it("reports a failure instead of claiming it copied", async () => {
    setClipboard(undefined);
    document.execCommand = vi.fn().mockReturnValue(false);
    expect(await copyText("key")).toBe(false);
  });
});
