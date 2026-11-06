import { describe, expect, it } from "vitest";
import { PLATFORM_TEXT, platform } from "./platform";

describe("platform wording", () => {
  it("ships for Windows only", () => {
    expect(Object.keys(PLATFORM_TEXT)).toEqual(["windows"]);
    expect(platform.id).toBe("windows");
  });

  it("every folder sits under the data root", () => {
    for (const folder of Object.values(platform.folders)) expect(folder.startsWith(platform.folders.root)).toBe(true);
  });
});
