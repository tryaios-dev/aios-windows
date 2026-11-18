"""Build the patched whisper-server (ADR 0016) from the source pinned in manifest.json.

    uv run python build/whisper/build.py [cpu] [vulkan]    # -> build/out/whisper/<variant>/

Same toolchain as build/llama/build.py. Windows (shipped): run from a Visual Studio x64 developer
shell with clang, ninja and git on PATH; the vulkan variant also needs the Vulkan SDK. Linux: CI
voice engine tests only, nothing is shipped.

Fails if the tag does not point at the pinned commit or a patch differs from its pinned
SHA-256. Writes build/out/whisper/manifest-<variant>.json with the digest of every shipped file.
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
OUT = ROOT / "build" / "out" / "whisper"
WORK = ROOT / "build" / "out" / "whisper-work"
LICENCE = ROOT / "licenses" / "third-party" / "whisper.cpp-LICENSE.txt"
WINDOWS = sys.platform == "win32"

# Only the server: no tests, no other examples, no SDL2 (microphone), no curl (model downloads),
# no ffmpeg. OpenMP off: ggml's own thread pool, no extra runtime DLL to ship.
COMMON_FLAGS = [
    "-DCMAKE_BUILD_TYPE=Release",
    "-DGGML_NATIVE=OFF",
    "-DGGML_OPENMP=OFF",
    "-DWHISPER_BUILD_TESTS=OFF",
    "-DWHISPER_BUILD_EXAMPLES=ON",
    "-DWHISPER_BUILD_SERVER=ON",
    "-DWHISPER_SDL2=OFF",
    "-DWHISPER_CURL=OFF",
    "-DWHISPER_COMMON_FFMPEG=OFF",
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
    remove_tree(src)
    tag, commit = str(manifest["whisper_cpp_release"]), str(manifest["commit"])
    # No CRLF conversion (Windows default): the patches must apply to the exact upstream bytes.
    run(
        "git",
        "-c",
        "core.autocrlf=false",
        "-c",
        "advice.detachedHead=false",
        "clone",
        "--quiet",
        "--depth",
        "1",
        "--branch",
        tag,
        str(manifest["repo"]),
        src,
    )
    actual = run("git", "-C", src, "rev-parse", "HEAD", capture=True)
    if actual != commit:
        raise SystemExit(f"tag {tag} points at {actual}, manifest.json pins {commit}")
    for patch in patches:
        run("git", "-C", src, "apply", HERE / "patches" / patch["name"])
    return src


def remove_tree(path: Path) -> None:
    """Delete an earlier checkout. Git marks its object files read-only, which Windows refuses to
    delete; clear the flag and retry instead of silently leaving the folder behind."""

    def writable_then_retry(func: object, target: str, _exc: BaseException) -> None:
        os.chmod(target, 0o700)
        func(target)  # type: ignore[operator]

    if path.exists():
        shutil.rmtree(path, onexc=writable_then_retry)


def use_visual_studio_clang() -> None:
    """Windows: put Visual Studio's own Clang first on PATH. Some runner images also carry a
    standalone LLVM (C:\\Program Files\\LLVM) that is older than the Visual Studio C++ library
    accepts (STL1000: "expected Clang 22 or newer"); the toolchain file picks whichever
    ``clang`` comes first."""
    vc = os.environ.get("VCINSTALLDIR")
    if not vc:
        return
    llvm = Path(vc) / "Tools" / "Llvm" / "x64" / "bin"
    if (llvm / "clang.exe").is_file():
        os.environ["PATH"] = f"{llvm}{os.pathsep}{os.environ.get('PATH', '')}"
        print(f"using {llvm / 'clang.exe'}", flush=True)


def build(src: Path, variant: str) -> Path:
    flags = list(COMMON_FLAGS)
    if WINDOWS:
        use_visual_studio_clang()
        # As build/llama/build.py: Clang, backend DLLs and every x64 CPU variant picked at runtime.
        flags += [
            f"-DCMAKE_TOOLCHAIN_FILE={src / 'cmake' / 'x64-windows-llvm.cmake'}",
            "-DGGML_BACKEND_DL=ON",
            "-DGGML_CPU_ALL_VARIANTS=ON",
            "-DCMAKE_C_FLAGS=-Wno-error=incompatible-pointer-types",
        ]
    if variant == "vulkan":
        flags.append("-DGGML_VULKAN=ON")
    out = WORK / variant
    shutil.rmtree(out, ignore_errors=True)
    run("cmake", "-S", src, "-B", out, "-G", "Ninja", *flags)
    run("cmake", "--build", out, "--target", "whisper-server")
    return out / "bin"


def collect(bin_dir: Path, variant: str, manifest: dict[str, object]) -> None:
    dest = OUT / variant
    shutil.rmtree(dest, ignore_errors=True)
    dest.mkdir(parents=True)
    if WINDOWS:
        files = [bin_dir / "whisper-server.exe", *bin_dir.glob("*.dll")]
        # App-local Visual C++ runtime: the ready-made upstream build fails on a clean Windows
        # install without the redistributable (0xC0000135, found in the ADR 0016 spike).
        redist = Path(os.environ.get("VCToolsRedistDir", "")) / "x64"
        crt = sorted(redist.glob("Microsoft.VC*.CRT"))
        if not crt:
            raise SystemExit("Visual C++ runtime not found: run from a VS x64 developer shell")
        files += sorted(crt[0].glob("*.dll"))
    else:
        files = [bin_dir / "whisper-server", *bin_dir.glob("*.so*")]
    for f in files:
        shutil.copy2(f, dest / f.name, follow_symlinks=False)
    shutil.copy2(LICENCE, dest / LICENCE.name)

    entry = {
        "variant": variant,
        "whisper_cpp_release": manifest["whisper_cpp_release"],
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
    (OUT / "release.txt").write_text(f"{manifest['whisper_cpp_release']} {manifest['commit']}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
