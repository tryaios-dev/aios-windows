// Starts Electron for development. Extra arguments are passed on to Electron.
// Clears ELECTRON_RUN_AS_NODE, which VS Code and some tools set: with it, Electron runs as
// plain Node and `import "electron"` fails.
import { spawn } from "node:child_process";

let electronPath;
try {
  electronPath = (await import("electron")).default;
} catch {
  console.error(
    "Electron is not installed correctly (its binary was not unpacked).\n" +
      "Use Node 22 (see .nvmrc), then: delete node_modules and run `pnpm install` again.\n" +
      "Node 23+ breaks Electron's unpack step during install.",
  );
  process.exit(1);
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronPath, [".", ...process.argv.slice(2)], { stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 0));
