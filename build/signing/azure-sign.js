// electron-builder custom sign hook (B-04). Signs each file electron-builder hands over
// (Electron app, its DLLs, the NSIS installer) by calling sign.ps1 on that one file.
// Only signs when AIOS_SIGN=1 (the release job); merge-request builds stay unsigned.
// Credentials come from masked CI variables only and are never logged.
"use strict";
const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function sign(config) {
  if (process.env.AIOS_SIGN !== "1") return;
  const script = path.join(__dirname, "sign.ps1");
  execFileSync("powershell", ["-NoProfile", "-File", script, config.path], { stdio: "inherit" });
};
