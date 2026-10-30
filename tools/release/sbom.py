"""B-05: CycloneDX 1.5 SBOM for the desktop build -> build/out/sbom/aios-sbom.cdx.json

Covers what ships in the installer:
* Python runtime packages in backend.exe (from uv.lock, no dev tools)
* Node production packages of the Electron app and UI (from pnpm-lock.yaml)
* bundled binaries: Electron, SQLCipher (build/sqlcipher/pin.json), and llama.cpp once pinned
  in build/llama/manifest.json
"""

import datetime
import json
import re
import subprocess
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "build" / "out" / "sbom"


def python_components() -> list[dict[str, object]]:
    text = subprocess.check_output(
        [
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--all-packages",
            "--no-emit-workspace",
            "--no-hashes",
            "--no-header",
        ],
        cwd=ROOT,
        text=True,
    )
    comps = []
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z0-9_.\-]+)==([^\s;]+)", line.strip())
        if m:
            name, ver = m.group(1).lower(), m.group(2)
            comps.append(
                {"type": "library", "name": name, "version": ver, "purl": f"pkg:pypi/{name}@{ver}"}
            )
    return comps


def node_components() -> list[dict[str, object]]:
    raw = subprocess.check_output(  # noqa: S602 - fixed command; pnpm is a .cmd on Windows
        "pnpm list --prod --depth Infinity --json --filter @aios/desktop --filter @aios/ui",
        cwd=ROOT,
        text=True,
        shell=True,
    )
    seen: dict[str, dict[str, object]] = {}

    def walk(deps: dict[str, dict[str, object]]) -> None:
        for name, info in (deps or {}).items():
            ver = str(info.get("version", ""))
            if ver.startswith("link:") or name.startswith("@aios/"):
                walk(info.get("dependencies", {}))  # type: ignore[arg-type]
                continue
            purl_name = name.replace("@", "%40", 1) if name.startswith("@") else name
            seen.setdefault(
                f"{name}@{ver}",
                {
                    "type": "library",
                    "name": name,
                    "version": ver,
                    "purl": f"pkg:npm/{purl_name}@{ver}",
                },
            )
            walk(info.get("dependencies", {}))  # type: ignore[arg-type]

    for project in json.loads(raw):
        walk(project.get("dependencies", {}))
    return sorted(seen.values(), key=lambda c: str(c["purl"]))


def binary_components() -> list[dict[str, object]]:
    electron = json.loads(
        (ROOT / "apps/desktop/node_modules/electron/package.json").read_text("utf-8")
    )["version"]
    comps: list[dict[str, object]] = [
        {
            "type": "application",
            "name": "electron",
            "version": electron,
            "purl": f"pkg:github/electron/electron@v{electron}",
        },
    ]
    pin = json.loads((ROOT / "build/sqlcipher/pin.json").read_text("utf-8"))["win32"]
    cipher = str(pin["cipher_version"]).split()[0]  # "4.19.0 community" -> "4.19.0"
    comps.append(
        {
            "type": "library",
            "name": "sqlcipher",
            "version": cipher,
            "description": f"SQLCipher Community Edition, bundled in {pin['package']} {pin['version']}",
            "licenses": [{"license": {"id": "BSD-3-Clause"}}],
            "purl": f"pkg:github/sqlcipher/sqlcipher@v{cipher}",
        }
    )
    llama = json.loads((ROOT / "build/llama/manifest.json").read_text("utf-8"))
    rel = str(llama.get("llama_cpp_release", ""))
    if re.fullmatch(r"b\d+", rel):
        comps.append(
            {
                "type": "application",
                "name": "llama.cpp",
                "version": rel,
                "purl": f"pkg:github/ggml-org/llama.cpp@{rel}",
            }
        )
    return comps


def main() -> None:
    version = json.loads((ROOT / "apps/desktop/package.json").read_text("utf-8"))["version"]
    bom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.datetime.now(datetime.UTC).isoformat(timespec="seconds"),
            "component": {"type": "application", "name": "AIOS", "version": version},
        },
        "components": binary_components() + python_components() + node_components(),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    target = OUT / "aios-sbom.cdx.json"
    target.write_text(json.dumps(bom, indent=2) + "\n", "utf-8")
    print(f"wrote {target.relative_to(ROOT)} ({len(bom['components'])} components)")


if __name__ == "__main__":
    main()
