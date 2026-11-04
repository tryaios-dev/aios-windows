"""Build the patched llama-server (D-03) from the source pinned in manifest.json.

    uv run python build/llama/build.py [cpu] [vulkan]    # -> build/out/llama/<variant>/

Windows (shipped): run from a Visual Studio x64 developer shell (CI: ilammy/msvc-dev-cmd) with
clang, ninja and git on PATH; the vulkan variant also needs the Vulkan SDK (VULKAN_SDK set).
Linux: CI engine tests only, nothing is shipped.

Fails if the tag does not point at the pinned commit or a patch differs from its pinned
SHA-256. Writes build/out/llama/manifest-<variant>.json with the digest of every shipped file.
"""

import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = ROOT / "build" / "out" / "llama"
WORK = ROOT / "build" / "out" / "llama-work"
LICENCE = ROOT / "licenses" / "third-party" / "llama.cpp-LICENSE.txt"
WINDOWS = sys.platform == "win32"

# Upstream turns on the embedded web UI and HTTPS model downloads; the engine needs neither.
# OpenMP off: ggml's own thread pool, no extra runtime DLL to ship.
COMMON_FLAGS = [
    "-DCMAKE_BUILD_TYPE=Release",
    "-DGGML_NATIVE=OFF",
    "-DGGML_OPENMP=OFF",
    "-DLLAMA_BUILD_UI=OFF",
    "-DLLAMA_USE_PREBUILT_UI=OFF",
    "-DLLAMA_OPENSSL=OFF",
    "-DLLAMA_BUILD_TESTS=OFF",
    "-DLLAMA_BUILD_EXAMPLES=OFF",
]


def run(*cmd: str | Path, capture: bool = False) -> str:
    print("+", " ".join(str(c) for c in cmd), flush=True)
    out = subprocess.run(
        [str(c) for c in cmd], check=True, stdout=subprocess.PIPE if capture else None, text=True
    ).stdout
    return (out or "").strip()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def checkout(manifest: dict[str, object]) -> Path:
    patches = manifest["patches"]
    assert isinstance(patches, list)
    for patch in patches:
        got = sha256(HERE / "patches" / patch["name"])
        if got != patch["sha256"]:
            raise SystemExit(f"{patch['name']}: SHA-256 {got} differs from manifest.json")

    src = WORK / "src"
    shutil.rmtree(src, ignore_errors=True)
    tag, commit = str(manifest["llama_cpp_release"]), str(manifest["commit"])
    run("git", "clone", "--quiet", "--depth", "1", "--branch", tag, str(manifest["repo"]), src)
    actual = run("git", "-C", src, "rev-parse", "HEAD", capture=True)
    if actual != commit:
        raise SystemExit(f"tag {tag} points at {actual}, manifest.json pins {commit}")
    for patch in patches:
        run("git", "-C", src, "apply", HERE / "patches" / patch["name"])
    return src


def build(src: Path, variant: str) -> Path:
    flags = list(COMMON_FLAGS)
    if WINDOWS:
        # Clang as upstream's Windows release (MSVC builds of the CPU kernels are slower).
        # Backend DLLs plus every x64 CPU variant, picked at runtime: one build for any CPU.
        flags += [
            f"-DCMAKE_TOOLCHAIN_FILE={src / 'cmake' / 'x64-windows-llvm.cmake'}",
            "-DGGML_BACKEND_DL=ON",
            "-DGGML_CPU_ALL_VARIANTS=ON",
        ]
    if variant == "vulkan":
        flags.append("-DGGML_VULKAN=ON")
    out = WORK / variant
    shutil.rmtree(out, ignore_errors=True)
    run("cmake", "-S", src, "-B", out, "-G", "Ninja", *flags)
    # ggml depends on every backend library, so this also builds the CPU variants and Vulkan.
    run("cmake", "--build", out, "--target", "llama-server")
    return out / "bin"


def collect(bin_dir: Path, variant: str, manifest: dict[str, object]) -> None:
    dest = OUT / variant
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    if WINDOWS:
        files = [bin_dir / "llama-server.exe", *bin_dir.glob("*.dll")]
        # App-local Visual C++ runtime, so a clean Windows install needs no redistributable.
        redist = Path(os.environ.get("VCToolsRedistDir", "")) / "x64"
        crt = sorted(redist.glob("Microsoft.VC*.CRT"))
        if not crt:
            raise SystemExit("Visual C++ runtime not found: run from a VS x64 developer shell")
        files += sorted(crt[0].glob("*.dll"))
    else:
        files = [bin_dir / "llama-server", *bin_dir.glob("*.so*")]
    for f in files:
        shutil.copy2(f, dest / f.name, follow_symlinks=False)
    shutil.copy2(LICENCE, dest / LICENCE.name)

    entry = {
        "variant": variant,
        "llama_cpp_release": manifest["llama_cpp_release"],
        "commit": manifest["commit"],
        "patches": manifest["patches"],
        "files": [
            {"name": f.name, "sha256": sha256(f)}
            for f in sorted(dest.iterdir())
            if f.is_file() and not f.is_symlink()
        ],
    }
    if variant == "vulkan":
        entry["vulkan_sdk"] = manifest["vulkan_sdk"]
    (OUT / f"manifest-{variant}.json").write_text(json.dumps(entry, indent=2) + "\n", "utf-8")
    print(f"{variant}: {len(entry['files'])} files in {dest.relative_to(ROOT)}")


def main() -> int:
    variants = sys.argv[1:] or ["cpu", "vulkan"]
    if any(v not in ("cpu", "vulkan") for v in variants):
        raise SystemExit("usage: build.py [cpu] [vulkan]")
    manifest = json.loads((HERE / "manifest.json").read_text("utf-8"))
    src = checkout(manifest)
    for variant in variants:
        collect(build(src, variant), variant, manifest)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "release.txt").write_text(f"{manifest['llama_cpp_release']} {manifest['commit']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
