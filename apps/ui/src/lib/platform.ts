/**
 * Every operating-system word the screens show, in one place. AIOS ships for Windows only; another
 * OS gets its own entry here (same ids as the desktop and Python platform layers) and the screens
 * stay unchanged. A UI test fails if Windows wording appears anywhere else.
 */

export interface PlatformText {
  /** Same id as `apps/desktop/src/main/platform` and `aios_common.platforms`. */
  id: string;
  /** "Windows" */
  os: string;
  /** Shown next to the version in Settings > About. */
  osVersions: string;
  /** Where keys are kept. */
  keyStore: string;
  /** The user's account on this computer. */
  account: string;
  /** What protects the key store. */
  signIn: string;
  /** Data folders as the user would type them. */
  folders: { root: string; data: string; logs: string; models: string; recoveryPackage: string };
  /** Full-disk encryption, and where to turn it on. */
  diskEncryption: string;
  diskEncryptionSettings: string;
  /** The installer file (the offline model package sits next to it). */
  installer: string;
  /** Path separator for showing file paths. */
  sep: string;
}

const WINDOWS: PlatformText = {
  id: "windows",
  os: "Windows",
  osVersions: "Windows 10 and 11",
  keyStore: "Windows Credential Manager",
  account: "Windows account",
  signIn: "Windows sign-in",
  folders: {
    root: "%LOCALAPPDATA%\\AIOS\\",
    data: "%LOCALAPPDATA%\\AIOS\\data\\",
    logs: "%LOCALAPPDATA%\\AIOS\\logs\\",
    models: "%LOCALAPPDATA%\\AIOS\\models\\",
    recoveryPackage: "%LOCALAPPDATA%\\AIOS\\recovery.pkg",
  },
  diskEncryption: "BitLocker",
  diskEncryptionSettings: "Windows settings",
  installer: "Setup.exe",
  sep: "\\",
};

/** Platforms AIOS ships for, by id. Add an entry when another OS is ported. */
export const PLATFORM_TEXT: Record<string, PlatformText> = { windows: WINDOWS };

/** The wording for this installation. Windows is the only shipped platform. */
export const platform: PlatformText = WINDOWS;
