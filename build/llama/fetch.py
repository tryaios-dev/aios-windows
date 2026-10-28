"""Download pinned llama-server CPU/Vulkan builds and verify SHA-256 against manifest.json into build/out/llama.

    uv run python build/llama/fetch.py            # -> build/out/llama/cpu, build/out/llama/vulkan

A download whose size or SHA-256 differs from the manifest is deleted and the script fails (B-02).
Already-verified zips are reused, so repeated runs do not download again.
"""

import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "build" / "out" / "llama"


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(name: str, build: dict[str, object]) -> None:
    url, want = str(build["url"]), str(build["sha256"])
    if not url.startswith("https://github.com/ggml-org/llama.cpp/releases/download/"):
        raise SystemExit(f"{name}: url is not a llama.cpp release asset: {url}")
    zip_path = OUT / f"{name}.zip"
    if not (zip_path.exists() and sha256(zip_path) == want):
        print(f"download {name}: {url}")
        with urllib.request.urlopen(url) as resp, zip_path.open("wb") as f:  # noqa: S310 - fixed https host
            shutil.copyfileobj(resp, f)
    got = sha256(zip_path)
    if got != want or zip_path.stat().st_size != build["size"]:
        zip_path.unlink()
        raise SystemExit(f"{name}: SHA-256 mismatch (want {want}, got {got})")
    target = OUT / name
    shutil.rmtree(target, ignore_errors=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(target)
    if not any(target.rglob("llama-server.exe")):
        raise SystemExit(f"{name}: llama-server.exe not found in the zip")
    print(f"{name}: verified {want[:12]}..., extracted to {target.relative_to(ROOT)}")


def main() -> int:
    manifest = json.loads((HERE / "manifest.json").read_text("utf-8"))
    OUT.mkdir(parents=True, exist_ok=True)
    for name, build in manifest["builds"].items():
        fetch(name, build)
    (OUT / "release.txt").write_text(f"{manifest['llama_cpp_release']} {manifest['commit']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
