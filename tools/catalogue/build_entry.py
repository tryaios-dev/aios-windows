"""Build one own-pipeline model-catalogue entry (task A-04).

Pipeline, for a single entry of catalogue/catalogue.draft.json:

1. List the upstream Hugging Face repo at the *pinned* revision recorded in the entry.
2. Download every file at that revision (weights, config, tokenizer) over plain HTTPS.
3. Verify each *.safetensors file against the committed source-weight manifest
   (catalogue/manifests/<name>.safetensors.sha256) and every other LFS file against the
   sha256 the Hub reports; recompute source_weights_digest and compare with the entry.
4. Run llama.cpp ``convert_hf_to_gguf.py`` (to a BF16 GGUF) and ``llama-quantize``
   (to the entry's quantisation method, e.g. Q4_K_M) from the pinned llama.cpp release.
5. Compute the artefact sha256 and size and write them, plus the conversion version,
   back into the entry.

The script downloads many gigabytes; run it on a build machine, not in CI.

Example::

    uv run python tools/catalogue/build_entry.py --entry-id qwen3-4b-q4_k_m \\
        --llama-cpp-dir C:/build/llama.cpp-b11960 \\
        --quantize-bin C:/build/llama.cpp-b11960/bin/llama-quantize.exe \\
        --llama-cpp-release b11960 --work-dir D:/model-build

Set HF_TOKEN in the environment if the Hub rate-limits anonymous downloads.
Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

HF_BASE = "https://huggingface.co"
CHUNK = 8 * 1024 * 1024
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CATALOGUE = REPO_ROOT / "catalogue" / "catalogue.draft.json"
DEFAULT_MANIFEST_DIR = REPO_ROOT / "catalogue" / "manifests"
LLAMA_MANIFEST = REPO_ROOT / "build" / "llama" / "manifest.json"


class BuildError(RuntimeError):
    pass


def _request(url: str) -> urllib.request.Request:
    if not url.startswith(HF_BASE + "/"):
        raise BuildError(f"refusing non-Hub URL: {url}")
    headers = {"User-Agent": "aios-catalogue-build/1"}
    token = os.environ.get("HF_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return urllib.request.Request(url, headers=headers)  # noqa: S310 - https Hub URL only


def _get_json(url: str) -> Any:
    with urllib.request.urlopen(_request(url), timeout=60) as resp:  # noqa: S310
        return json.load(resp)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
    return h.hexdigest()


def list_tree(repo: str, revision: str) -> list[dict[str, Any]]:
    url = f"{HF_BASE}/api/models/{repo}/tree/{revision}?recursive=true"
    entries = _get_json(url)
    return [e for e in entries if e.get("type") == "file"]


def download(repo: str, revision: str, rel_path: str, dest: Path, expected_sha: str | None) -> None:
    """Download one file; skip if it already exists with the expected digest."""
    if dest.exists() and expected_sha and sha256_file(dest) == expected_sha:
        print(f"  ok (cached) {rel_path}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    quoted = urllib.parse.quote(rel_path)
    url = f"{HF_BASE}/{repo}/resolve/{revision}/{quoted}"
    tmp = dest.with_name(dest.name + ".part")
    h = hashlib.sha256()
    with urllib.request.urlopen(_request(url), timeout=120) as resp, tmp.open("wb") as out:  # noqa: S310
        while chunk := resp.read(CHUNK):
            h.update(chunk)
            out.write(chunk)
    if expected_sha and h.hexdigest() != expected_sha:
        tmp.unlink(missing_ok=True)
        raise BuildError(
            f"sha256 mismatch for {rel_path}: got {h.hexdigest()}, want {expected_sha}"
        )
    tmp.replace(dest)
    print(f"  downloaded {rel_path}")


def read_manifest(path: Path) -> dict[str, str]:
    """Parse '<sha256>  <filename>' lines into {filename: sha256}."""
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        digest, name = line.split("  ", 1)
        out[name] = digest
    return out


def manifest_digest(files: dict[str, str]) -> str:
    """source_weights_digest: sha256 over '<sha256>  <filename>\\n' lines sorted by filename."""
    body = "".join(f"{files[name]}  {name}\n" for name in sorted(files))
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def run(cmd: list[str]) -> None:
    print("  $ " + " ".join(cmd))
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        raise BuildError(f"command failed with exit code {result.returncode}: {cmd[0]}")


def build(args: argparse.Namespace) -> None:
    catalogue = json.loads(args.catalogue.read_text(encoding="utf-8"))
    matches = [e for e in catalogue["entries"] if e["id"] == args.entry_id]
    if len(matches) != 1:
        raise BuildError(f"expected exactly one entry with id {args.entry_id!r}")
    entry = matches[0]
    if entry["pipeline"] != "own":
        raise BuildError("build_entry.py only builds own-pipeline entries")

    pinned = json.loads(LLAMA_MANIFEST.read_text(encoding="utf-8")).get("llama_cpp_release", "")
    if not re.fullmatch(r"b\d+", pinned):
        raise BuildError(f"llama.cpp release is not pinned yet in {LLAMA_MANIFEST}: {pinned!r}")
    if args.llama_cpp_release != pinned:
        raise BuildError(f"--llama-cpp-release {args.llama_cpp_release} != pinned {pinned}")

    repo = entry["upstream"]["repo"]
    revision = entry["upstream"]["revision"]
    method = entry["quantisation"]["method"]
    model_name = repo.split("/")[-1]
    manifest_path = args.manifest_dir / f"{model_name}.safetensors.sha256"
    manifest = read_manifest(manifest_path)

    if manifest_digest(manifest) != entry["source_weights_digest"]:
        raise BuildError(f"{manifest_path} does not hash to the entry's source_weights_digest")

    src_dir = args.work_dir / "src" / model_name / revision
    out_dir = args.work_dir / "out"
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[1/4] listing {repo}@{revision}")
    tree = list_tree(repo, revision)
    tree_weights = {e["path"]: e["lfs"]["oid"] for e in tree if e["path"].endswith(".safetensors")}
    if tree_weights != manifest:
        raise BuildError("Hub safetensors listing at the pinned revision differs from the manifest")

    print("[2/4] downloading and verifying")
    for e in tree:
        path = e["path"]
        expected = manifest.get(path) or (e.get("lfs") or {}).get("oid")
        download(repo, revision, path, src_dir / path, expected)

    # Re-verify weights from disk so a cached directory can never bypass the manifest.
    on_disk = {name: sha256_file(src_dir / name) for name in manifest}
    if manifest_digest(on_disk) != entry["source_weights_digest"]:
        raise BuildError("downloaded weights do not match source_weights_digest")

    print("[3/4] converting and quantising")
    bf16 = out_dir / f"{model_name}-BF16.gguf"
    final = out_dir / entry["artefact"]["filename"]
    convert = args.llama_cpp_dir / "convert_hf_to_gguf.py"
    run([args.python, str(convert), str(src_dir), "--outtype", "bf16", "--outfile", str(bf16)])
    run([str(args.quantize_bin), str(bf16), str(final), method])
    if not args.keep_intermediate:
        bf16.unlink(missing_ok=True)

    print("[4/4] recording artefact digest")
    entry["artefact"]["sha256"] = sha256_file(final)
    entry["artefact"]["size_bytes"] = final.stat().st_size
    entry["conversion"]["version"] = args.llama_cpp_release
    args.catalogue.write_text(
        json.dumps(catalogue, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"  {final.name}: {entry['artefact']['size_bytes']} bytes")
    print(f"  sha256 {entry['artefact']['sha256']}")
    print(f"updated {args.catalogue}")


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    p.add_argument("--entry-id", required=True, help="catalogue entry id, e.g. qwen3-4b-q4_k_m")
    p.add_argument(
        "--llama-cpp-dir",
        type=Path,
        required=True,
        help="llama.cpp source checkout at the pinned release (contains convert_hf_to_gguf.py)",
    )
    p.add_argument(
        "--quantize-bin",
        type=Path,
        required=True,
        help="llama-quantize executable from the same release",
    )
    p.add_argument(
        "--llama-cpp-release",
        required=True,
        help="release tag, e.g. b11960 (must match build/llama/manifest.json)",
    )
    p.add_argument(
        "--work-dir",
        type=Path,
        required=True,
        help="scratch directory with room for weights + GGUFs",
    )
    p.add_argument(
        "--python",
        default=sys.executable,
        help="interpreter with llama.cpp's convert requirements installed",
    )
    p.add_argument("--catalogue", type=Path, default=DEFAULT_CATALOGUE)
    p.add_argument("--manifest-dir", type=Path, default=DEFAULT_MANIFEST_DIR)
    p.add_argument("--keep-intermediate", action="store_true", help="keep the BF16 GGUF")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        build(args)
    except BuildError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
