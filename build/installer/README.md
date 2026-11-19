NSIS includes, icons and the offline-package layout (MVP 8.4).

| File | What it does |
| --- | --- |
| `installer.nsh` | Install: copies an offline package's model files into `<install folder>\models\offline` (below). Uninstall asks "Also remove your AIOS data?" (default No, never during an update, No when silent): AC-22 |
| `aios-verify.cmd` | Runs the independent evidence verifier on AIOS.exe's own Node.js runtime (`ELECTRON_RUN_AS_NODE`), so an auditor needs nothing else: `resources\verifier\aios-verify.cmd export.zip` |

## Offline package (MVP 10.1, N-02)

A ZIP or USB folder that installs and works with no network:

```text
AIOS Setup 0.1.0.exe
models\
  MiniCPM5-2B-Q4_K_M.gguf      a file from the catalogue (matched by size and SHA-256; any name)
```

1. The installer finds `models\*.gguf` next to Setup.exe and copies the files into
   `<install folder>\models\offline`. An update runs from the updater's folder, so it copies nothing.
2. On first start the setup wizard checks each file like an import: size, SHA-256 and the entry's
   review against the catalogue (`POST /models/offline-package/install`). A file that passes is moved
   into the models folder and installed; one that fails is deleted and the reason shown. The wizard
   picks the package's model size and does not download.

To be proven on a network-disabled clean Windows 11 VM (AC-08).
