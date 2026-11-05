/**
 * The one place in Electron main that looks at the operating system. Everything else asks
 * `currentPlatform()`; a desktop test fails if `process.platform` is read anywhere else.
 */
import { generic } from "./generic.js";
import type { DesktopPlatform } from "./types.js";
import { windows } from "./windows.js";

export type { BackendCommand, BackendLocation, DesktopPlatform } from "./types.js";

/** process.platform -> implementation. Add "darwin" / "linux" here when those ports exist. */
const BY_NODE_PLATFORM: Partial<Record<NodeJS.Platform, DesktopPlatform>> = { win32: windows };

export function platformFor(nodePlatform: NodeJS.Platform): DesktopPlatform {
  return BY_NODE_PLATFORM[nodePlatform] ?? generic;
}

export function currentPlatform(): DesktopPlatform {
  return platformFor(process.platform);
}
