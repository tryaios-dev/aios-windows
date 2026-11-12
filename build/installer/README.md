NSIS includes, icons and the offline-package layout (MVP 8.4).

| File | What it does |
| --- | --- |
| `installer.nsh` | Uninstall asks "Also remove your AIOS data?" (default No, never during an update, No when silent): AC-22 |
| `aios-verify.cmd` | Runs the independent evidence verifier on AIOS.exe's own Node.js runtime (`ELECTRON_RUN_AS_NODE`), so an auditor needs nothing else: `resourceserifierios-verify.cmd export.zip` |
