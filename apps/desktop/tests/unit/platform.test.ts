import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({}));

const SRC = path.join(import.meta.dirname, "../../src");
const PLATFORM_DIR = path.join(SRC, "main", "platform");
// Reading the OS or naming Windows-only programs and variables belongs in src/main/platform/.
const OS_SPECIFIC = /process\.platform|\.exe\b|SystemRoot|LOCALAPPDATA|taskkill|Scripts["/\\]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : [full];
  });
}

describe("platform layer", () => {
  it("ships for Windows only; any other OS gets the development fallback", async () => {
    const { platformFor } = await import("../../src/main/platform/index.js");
    expect(platformFor("win32")).toMatchObject({ id: "windows", shipped: true });
    for (const os of ["darwin", "linux"] as const) expect(platformFor(os)).toMatchObject({ shipped: false });
  });

  it("starts backend.exe with a minimal environment in the installed Windows app", async () => {
    const { platformFor } = await import("../../src/main/platform/index.js");
    const cmd = platformFor("win32").backendCommand({ packaged: true, resourcesPath: "R", repoRoot: "X" });
    expect(cmd.cmd).toBe(path.join("R", "backend", "backend.exe"));
    expect(Object.keys(cmd.env).sort()).toEqual(["LOCALAPPDATA", "SystemRoot"]);
  });

  it("keeps OS-specific code inside src/main/platform", () => {
    const offenders = files(SRC)
      .filter((f) => !f.startsWith(PLATFORM_DIR))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => [line, i + 1] as const)
          .filter(([line]) => OS_SPECIFIC.test(line))
          .map(([, n]) => `${path.relative(SRC, f)}:${n}`),
      );
    expect(offenders).toEqual([]);
  });
});
