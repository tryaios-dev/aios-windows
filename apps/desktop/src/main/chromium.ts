/**
 * Chromium's own background traffic, switched off before the app is ready (C-01, AC-21).
 *
 * Electron embeds Chromium, which on its own may contact Google services: component updates,
 * domain reliability reports, DNS prefetching, hyperlink auditing pings, field trials. AIOS may
 * contact only the hosts on the allowlist (M-22), so these are all disabled here. Spellcheck
 * (which can download dictionaries) is off per window in window.ts. Whatever an idle network
 * capture still shows after this is recorded under question 15, not accepted quietly.
 */
export const CHROMIUM_SWITCHES: ReadonlyArray<readonly [string, string?]> = [
  ["disable-background-networking"],
  ["disable-component-update"],
  ["disable-domain-reliability"],
  ["disable-client-side-phishing-detection"],
  ["disable-sync"],
  ["disable-default-apps"],
  ["no-pings"],
  ["dns-prefetch-disable"],
  ["disable-breakpad"], // no crash reporter (question 19)
  ["metrics-recording-only"],
  ["disable-features", "AutofillServerCommunication,MediaRouter,OptimizationHints,Translate,NetworkTimeServiceQuerying"],
];

export interface CommandLine {
  appendSwitch(name: string, value?: string): void;
}

export function disableBackgroundNetworking(commandLine: CommandLine): void {
  for (const [name, value] of CHROMIUM_SWITCHES) {
    if (value === undefined) commandLine.appendSwitch(name);
    else commandLine.appendSwitch(name, value);
  }
}
