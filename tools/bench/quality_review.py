"""Deviation quality review of a third-party model file (procedure: docs/models/quality-review.md).

    uv run python tools/bench/quality_review.py --entry <catalogue id> --model <file.gguf> \\
        --reference <publisher's Q8_0.gguf> --text <wiki.test.raw> \\
        [--perplexity-bin <llama-perplexity>] [--engine-dir build/out/llama/cpu]

Stage 1  the file is the one the catalogue names, and its metadata fits the entry.
Stage 2  quantisation damage: KL divergence from the publisher's Q8_0 file on a fixed text.
Stage 3  behaviour in the app's conditions: the prompt set with the app's system prompt, run
         through the backend's own engine launcher; also without it, for comparison.
Stage 4  the reviewer reads the answers and scores the open-writing items (in the report).

Writes docs/models/quality-review/<entry>.json (everything) and <entry>.md (for the reviewer).
--recheck re-scores the saved answers with the current checks without running anything.
The prompts are synthetic; this is a development tool, not part of the app.
"""

import argparse
import datetime as dt
import hashlib
import json
import platform
import re
import secrets
import struct
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path
from typing import BinaryIO

from aios_backend.engine.job import kill_on_close_job
from aios_backend.engine.launcher import start
from aios_common.handshake import set_token_for_tests

ROOT = Path(__file__).resolve().parents[2]
PROMPTS = Path(__file__).with_name("quality_prompts.json")
REFERENCES = Path(__file__).with_name("quality_references.json")
CATALOGUE = ROOT / "services/backend/aios_backend/apps/models/catalogue_dev.json"
OUT_DIR = ROOT / "docs/models/quality-review"
PERPLEXITY = ROOT / "build/out/llama-work/cuda/bin/llama-perplexity"

SETTINGS = {"temperature": 0.0, "seed": 42, "max_tokens": 512, "thinking": False}
APP_SYSTEM_PROMPT = "draft-v3"  # the variant stage 3 is judged on
KLD_SETTINGS = {"ctx": 512, "chunks": 100}

# Pass threshold, fixed before any result is read (docs/models/quality-review.md).
KLD_MEAN_MAX = 0.10
SAME_TOP_MIN = 0.85
AUTO_OVERALL_MIN = 0.80
AUTO_GROUP_MIN = 0.50
INFORMATIONAL_GROUPS = {"honesty"}  # reported, not part of the pass threshold
MANUAL_MEAN_MIN = 1.5

GGUF_FILE_TYPE = {"Q4_K_M": 15, "Q8_0": 7}  # llama_ftype values

STOPWORDS = {
    "en": "the and is are of to in that it for with on this you be".split(),
    "it": "il la di che è per un una non sono con del della le gli si".split(),
    "de": "der die das und ist nicht ein eine zu mit von sie es für den".split(),
    "fr": "le la les de des et est que un une pour pas dans sera vous".split(),
    "es": "el la los las de que y es en un una por para con se".split(),
}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


# --- stage 1: file identity and metadata -----------------------------------------------------

_SCALARS = {
    0: "B",
    1: "b",
    2: "H",
    3: "h",
    4: "I",
    5: "i",
    6: "f",
    7: "?",
    10: "Q",
    11: "q",
    12: "d",
}


def _read(f: BinaryIO, fmt: str) -> int | float | bool:
    size = struct.calcsize("<" + fmt)
    return struct.unpack("<" + fmt, f.read(size))[0]


def _string(f: BinaryIO) -> str:
    n = int(_read(f, "Q"))
    return f.read(n).decode("utf-8", errors="replace")


def _value(f: BinaryIO, kind: int) -> object:
    if kind in _SCALARS:
        return _read(f, _SCALARS[kind])
    if kind == 8:
        return _string(f)
    if kind == 9:
        inner, n = int(_read(f, "I")), int(_read(f, "Q"))
        if inner in _SCALARS:  # skip numeric arrays without decoding them
            f.seek(n * struct.calcsize("<" + _SCALARS[inner]), 1)
        else:
            for _ in range(n):
                _value(f, inner)
        return f"<array of {n}>"
    raise ValueError(f"unknown GGUF value type {kind}")


def gguf_metadata(path: Path) -> dict[str, object]:
    """The key/value header of a GGUF file (arrays are summarised, not returned)."""
    with path.open("rb") as f:
        if f.read(4) != b"GGUF":
            raise ValueError("not a GGUF file")
        _read(f, "I")  # version
        _read(f, "Q")  # tensor count
        meta = {}
        for _ in range(int(_read(f, "Q"))):
            key = _string(f)
            meta[key] = _value(f, int(_read(f, "I")))
    return meta


def stage1(entry: dict, model: Path) -> dict:
    size, digest = model.stat().st_size, sha256(model)
    meta = gguf_metadata(model)
    arch = str(meta.get("general.architecture", ""))
    ctx = meta.get(f"{arch}.context_length")
    template = meta.get("tokenizer.chat_template")
    want_type = GGUF_FILE_TYPE.get(entry["quantisation"]["method"])
    checks = {
        "size matches the catalogue": size == entry["artefact"]["size_bytes"],
        "SHA-256 matches the catalogue": digest == entry["artefact"]["sha256"],
        f"quantisation is {entry['quantisation']['method']}": meta.get("general.file_type")
        == want_type,
        f"trained context >= {entry['context_length']}": isinstance(ctx, int)
        and ctx >= entry["context_length"],
        "chat template present": isinstance(template, str) and len(template) > 0,
    }
    return {
        "size_bytes": size,
        "sha256": digest,
        "architecture": arch,
        "name": meta.get("general.name"),
        "file_type": meta.get("general.file_type"),
        "context_length": ctx,
        "chat_template_sha256": hashlib.sha256(str(template).encode()).hexdigest()
        if template
        else None,
        "checks": checks,
        "pass": all(checks.values()),
    }


# --- stage 2: quantisation damage ------------------------------------------------------------


def _metric(log: str, label: str) -> float:
    m = re.search(rf"^{label}\s*:\s*([0-9.]+)", log, flags=re.M)
    if not m:
        raise RuntimeError(f"llama-perplexity printed no '{label}'")
    return float(m.group(1))


def stage2(binary: Path, model: Path, reference: Path, text: Path) -> dict:
    common = ["-c", str(KLD_SETTINGS["ctx"]), "--chunks", str(KLD_SETTINGS["chunks"])]
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp) / "base.kld"
        print("stage 2: reference logits...")
        subprocess.run(  # noqa: S603 - local tool, fixed arguments
            [
                str(binary),
                "-m",
                str(reference),
                "-f",
                str(text),
                "--kl-divergence-base",
                str(base),
                *common,
            ],
            check=True,
            capture_output=True,
        )
        print("stage 2: comparing the shipped file...")
        out = subprocess.run(  # noqa: S603 - local tool, fixed arguments
            [
                str(binary),
                "-m",
                str(model),
                "--kl-divergence-base",
                str(base),
                "--kl-divergence",
                *common,
            ],
            check=True,
            capture_output=True,
            text=True,
        )
    log = out.stdout + out.stderr
    kld = _metric(log, r"Mean\s+KLD")
    same_top = _metric(log, r"Same top p") / 100
    result = {
        "mean_kld": kld,
        "median_kld": _metric(log, r"Median\s+KLD"),
        "max_kld": _metric(log, r"Maximum KLD"),
        "same_top": round(same_top, 4),
        "ppl": _metric(log, r"Mean PPL\(Q\)"),
        "ppl_reference": _metric(log, r"Mean PPL\(base\)"),
        "settings": KLD_SETTINGS,
    }
    result["checks"] = {
        f"mean KL divergence <= {KLD_MEAN_MAX}": kld <= KLD_MEAN_MAX,
        f"same top token >= {SAME_TOP_MIN:.0%}": same_top >= SAME_TOP_MIN,
    }
    result["pass"] = all(result["checks"].values())
    return result


# --- stage 3: behaviour ----------------------------------------------------------------------


def ask(base: str, key: str, system: str | None, content: str) -> tuple[str, dict[str, float]]:
    messages = ([{"role": "system", "content": system}] if system else []) + [
        {"role": "user", "content": content}
    ]
    body = json.dumps(
        {
            "messages": messages,
            "max_tokens": SETTINGS["max_tokens"],
            "temperature": SETTINGS["temperature"],
            "seed": SETTINGS["seed"],
            "stream": False,
            "chat_template_kwargs": {"enable_thinking": SETTINGS["thinking"]},
        }
    ).encode()
    req = urllib.request.Request(  # noqa: S310 - loopback engine
        f"{base}/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=900) as resp:  # noqa: S310 - loopback engine
        data = json.load(resp)
    text = data["choices"][0]["message"].get("content") or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()
    t = data.get("timings") or {}
    return text, {
        "tokens": t.get("predicted_n", 0),
        "tokens_per_s": t.get("predicted_per_second", 0),
    }


def _words(text: str) -> int:
    return len(re.findall(r"[^\s*_#`>-]+", text))


def _bullets(text: str) -> int:
    return len(re.findall(r"^\s*(?:[-*•]|\d+[.)])\s+\S", text, flags=re.M))


def _json_keys(text: str, keys: list[str]) -> bool:
    m = re.search(r"\{.*\}", text, flags=re.S)
    try:
        obj = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        return False
    return isinstance(obj, dict) and all(k in obj for k in keys)


def _final_number(text: str) -> float | None:
    nums = re.findall(r"\d+(?:[.,]\d+)?", text)
    return float(nums[-1].replace(",", ".")) if nums else None


def _language(text: str) -> str:
    words = re.findall(r"[a-zàâäçéèêëîïôöùûüßñáíóú']+", text.lower())
    scores = {lang: sum(w in sw for w in words) for lang, sw in STOPWORDS.items()}
    return max(scores, key=lambda k: scores[k])


def run_checks(text: str, checks: dict) -> dict[str, bool]:
    low = text.lower()
    out: dict[str, bool] = {}
    for name, want in checks.items():
        if name == "contains_all":
            ok = all(w.lower() in low for w in want)
        elif name == "contains_any":
            ok = any(w.lower() in low for w in want)
        elif name == "not_contains":
            ok = not any(w.lower() in low for w in want)
        elif name == "max_words":
            ok = _words(text) <= want
        elif name == "bullets":
            ok = _bullets(text) == want
        elif name == "json_keys":
            ok = _json_keys(text, want)
        elif name == "final_number":
            ok = _final_number(text) == float(want)
        elif name == "starts_with_any":
            first = re.sub(r"^[\s*_#\"'>-]+", "", low)
            ok = any(first.startswith(w) for w in want)
        elif name == "language":
            ok = _language(text) == want
        else:
            raise ValueError(f"unknown check {name}")
        out[name] = ok
    return out


def score(items: list[dict]) -> dict:
    groups: dict[str, list[bool]] = {}
    for it in items:
        groups.setdefault(it["category"], []).append(it["auto_pass"])
    gated = [it for it in items if it["category"] not in INFORMATIONAL_GROUPS]
    overall = sum(it["auto_pass"] for it in gated) / len(gated)
    per_group = {g: [sum(v), len(v)] for g, v in groups.items()}
    ok = overall >= AUTO_OVERALL_MIN and all(
        p / n >= AUTO_GROUP_MIN for g, (p, n) in per_group.items() if g not in INFORMATIONAL_GROUPS
    )
    return {"overall": round(overall, 3), "groups": per_group, "pass": ok}


def stage3_score(runs: dict[str, list[dict]], prompts: dict) -> dict:
    by_id = {it["id"]: it for it in prompts["items"]}
    for items in runs.values():
        for it in items:
            it["checks"] = run_checks(it["answer"], by_id[it["id"]]["checks"])
            it["auto_pass"] = all(it["checks"].values())
    scores = {variant: score(items) for variant, items in runs.items()}
    return {
        "judged_on": APP_SYSTEM_PROMPT,
        "scores": scores,
        "pass": scores[APP_SYSTEM_PROMPT]["pass"],
        "manual_items": [i["id"] for i in prompts["items"] if i.get("manual")],
    }


def stage3_run(engine_dir: Path, build: str, model: Path, prompts: dict) -> dict[str, list[dict]]:
    set_token_for_tests(secrets.token_urlsafe(32))  # the engine key is derived from it
    job = kill_on_close_job()
    runs: dict[str, list[dict]] = {}
    with tempfile.TemporaryDirectory() as tmp:
        engine = start(engine_dir, model, Path(tmp), job, build=build)
        try:
            for variant, system in prompts["system_prompts"].items():
                runs[variant] = []
                for n, item in enumerate(prompts["items"], 1):
                    content = item["prompt"]
                    if item.get("doc"):
                        content = f"{prompts['documents'][item['doc']]}\n\n{item['prompt']}"
                    began = time.perf_counter()
                    answer, timing = ask(engine.base_url, engine.key, system, content)
                    print(f"stage 3 [{variant}] {n:2}/{len(prompts['items'])} {item['id']}")
                    runs[variant].append(
                        {
                            "id": item["id"],
                            "category": item["category"],
                            "manual": bool(item.get("manual")),
                            "answer": answer,
                            "seconds": round(time.perf_counter() - began, 1),
                            **timing,
                        }
                    )
        finally:
            engine.stop()
            job.close()
    return runs


# --- report ----------------------------------------------------------------------------------


def _mark(ok: bool) -> str:
    return "pass" if ok else "**FAIL**"


def markdown(r: dict, prompts: dict) -> str:
    s1, s2, s3 = r["stage1"], r["stage2"], r["stage3"]
    app = s3["scores"][APP_SYSTEM_PROMPT]
    none = s3["scores"]["none"]
    by_id = {it["id"]: it for it in prompts["items"]}
    runs = r["runs"]
    hon = [g for g in app["groups"] if g in INFORMATIONAL_GROUPS]
    auto = "pass" if (s1["pass"] and s2["pass"] and s3["pass"]) else "**FAIL**"
    s4 = r.get("stage4")
    s4_cell = "to score"
    if s4 and s4["complete"]:
        s4_cell = f"{_mark(s4['pass'])} (mean {s4['mean']:.2f}; {s4['status']})"
    elif s4:
        s4_cell = f"{s4['scored']} / {len(s3['manual_items'])} scored"
    lines = [
        f"# Quality review: {r['model']['display_name']}",
        "",
        f"- Catalogue entry: `{r['model']['entry']}`",
        f"- File: `{r['model']['filename']}`",
        f"- Reference: `{r['reference']['filename']}` from `{r['reference']['repo']}` @ "
        f"`{r['reference']['revision'][:12]}`, SHA-256 checked",
        f"- Engine: llama.cpp {r['engine']['release']}; stage 3 on the shipped {r['engine']['build']} build",
        f"- Run: {r['run_at']} on {r['machine']}; prompt set v{r['prompt_set_version']}",
        "",
        "## Result",
        "",
        "| Stage | Question | Result |",
        "| --- | --- | --- |",
        f"| 1 | Is it the file the catalogue names, with the right metadata? | {_mark(s1['pass'])} |",
        f"| 2 | Is the quantisation sound? Mean KL divergence {s2['mean_kld']:.4f} "
        f"(max {KLD_MEAN_MAX}), same top token {s2['same_top']:.1%} (min {SAME_TOP_MIN:.0%}) "
        f"| {_mark(s2['pass'])} |",
        f"| 3 | Does it behave in the app's conditions? {app['overall']:.0%} of items pass "
        f"(min {AUTO_OVERALL_MIN:.0%}), every group >= {AUTO_GROUP_MIN:.0%} | {_mark(s3['pass'])} |",
        f"| 4 | Reviewer scores: mean >= {MANUAL_MEAN_MIN}, no item scored 0 | {s4_cell} |",
        "",
        f"Automatic stages: {auto}. Final result: the reviewer's decision after stage 4.",
        "",
        "## Stage 1: file",
        "",
        f"Architecture `{s1['architecture']}`, name `{s1['name']}`, file type {s1['file_type']}, "
        f"trained context {s1['context_length']}, SHA-256 `{s1['sha256']}`.",
        "",
        *[f"- {k}: {_mark(v)}" for k, v in s1["checks"].items()],
        "",
        "## Stage 2: quantisation",
        "",
        f"Text: {r['text']['name']} (SHA-256 checked), first {s2['settings']['chunks']} chunks of "
        f"{s2['settings']['ctx']} tokens. Perplexity {s2['ppl']:.3f} (reference "
        f"{s2['ppl_reference']:.3f}). KL divergence mean {s2['mean_kld']:.4f}, median "
        f"{s2['median_kld']:.4f}, max {s2['max_kld']:.3f}.",
        "",
        "## Stage 3: behaviour",
        "",
        f"System prompt `{APP_SYSTEM_PROMPT}` (judged):",
        "",
        f"> {prompts['system_prompts'][APP_SYSTEM_PROMPT]}",
        "",
        "| Group | With system prompt | Without |",
        "| --- | --- | --- |",
    ]
    for g, (p, n) in app["groups"].items():
        p0, _ = none["groups"][g]
        note = " (informational)" if g in INFORMATIONAL_GROUPS else ""
        lines.append(f"| {g}{note} | {p} / {n} | {p0} / {n} |")
    lines += [
        f"| **counted groups** | **{app['overall']:.0%}** | {none['overall']:.0%} |",
        "",
        "## Stage 4: reviewer scores",
        "",
        "0 = unusable, 1 = usable after edits, 2 = good. Score the answers with the system prompt.",
        "",
        *([f"Scored by {s4['scorer']}, {s4['date']} ({s4['status']}).", ""] if s4 else []),
        "| Item | Score | Note |",
        "| --- | --- | --- |",
        *[
            f"| {i} | {(s4 or {}).get('items', {}).get(i, {}).get('score', '')} | "
            f"{(s4 or {}).get('items', {}).get(i, {}).get('note', '')} |"
            for i in s3["manual_items"]
        ],
        "",
        "## Answers (with the system prompt)",
        "",
        "Where the answer without the system prompt passed differently, or for the "
        f"{', '.join(hon)} group, it is shown too.",
    ]
    without = {it["id"]: it for it in runs["none"]}
    for it in runs[APP_SYSTEM_PROMPT]:
        spec = by_id[it["id"]]
        checks = ", ".join(f"{k} {'✓' if ok else '✗'}" for k, ok in it["checks"].items())
        lines += [
            "",
            f"### {it['id']} · {it['category']}{' · manual' if it['manual'] else ''} · "
            f"{'pass' if it['auto_pass'] else 'FAIL'}",
            "",
            *([f"*Document:* `{spec['doc']}` (end of this report)", ""] if spec.get("doc") else []),
            f"**Prompt:** {spec['prompt']}",
            "",
            "~~~text",
            it["answer"],
            "~~~",
            "",
            f"Checks: {checks}",
        ]
        other = without[it["id"]]
        if other["auto_pass"] != it["auto_pass"] or it["category"] in INFORMATIONAL_GROUPS:
            lines += [
                "",
                f"Without the system prompt ({'pass' if other['auto_pass'] else 'FAIL'}):",
                "",
                "~~~text",
                other["answer"],
                "~~~",
            ]
    lines += ["", "## Documents used", ""]
    for name, text in prompts["documents"].items():
        lines += [f"### `{name}`", "", "~~~text", text, "~~~", ""]
    return "\n".join(lines).rstrip() + "\n"


def stage4(path: Path, manual: list[str]) -> dict | None:
    """Reviewer scores from <entry>.scores.json, if the file exists."""
    if not path.is_file():
        return None
    data = json.loads(path.read_text("utf-8"))
    vals = [data["items"][i]["score"] for i in manual if i in data["items"]]
    mean = sum(vals) / len(vals) if vals else 0.0
    complete = len(vals) == len(manual)
    return {
        **data,
        "scored": len(vals),
        "complete": complete,
        "mean": round(mean, 3),
        "pass": complete and mean >= MANUAL_MEAN_MIN and 0 not in vals,
    }


def write(r: dict, prompts: dict, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    entry = r["model"]["entry"]
    r["stage4"] = stage4(out_dir / f"{entry}.scores.json", r["stage3"]["manual_items"])
    (out_dir / f"{entry}.json").write_text(
        json.dumps(r, indent=2, ensure_ascii=False) + "\n", "utf-8"
    )
    (out_dir / f"{entry}.md").write_text(markdown(r, prompts), "utf-8")
    s3 = r["stage3"]["scores"]
    print(
        f"{r['model']['entry']}: stage 1 {_mark(r['stage1']['pass'])}, stage 2 "
        f"{_mark(r['stage2']['pass'])} (KLD {r['stage2']['mean_kld']:.4f}), stage 3 "
        f"{_mark(r['stage3']['pass'])} ({s3[APP_SYSTEM_PROMPT]['overall']:.0%}; without system "
        f"prompt {s3['none']['overall']:.0%})"
    )
    print(f"report: {(out_dir / f'{entry}.md')}")


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--entry", required=True, help="catalogue entry id")
    p.add_argument("--model", type=Path)
    p.add_argument("--reference", type=Path, help="the publisher's Q8_0 file (stage 2)")
    p.add_argument("--text", type=Path, help="wiki.test.raw (stage 2)")
    p.add_argument("--perplexity-bin", type=Path, default=PERPLEXITY)
    p.add_argument("--engine-dir", type=Path, default=ROOT / "build" / "out" / "llama" / "cpu")
    p.add_argument("--build", default="cpu", help="engine build name passed to the launcher")
    p.add_argument("--out-dir", type=Path, default=OUT_DIR)
    p.add_argument("--recheck", action="store_true", help="re-score saved answers only")
    p.add_argument(
        "--stage3-only",
        action="store_true",
        help="run stage 3 again and keep the saved stage 1 and 2 results",
    )
    args = p.parse_args()

    prompts = json.loads(PROMPTS.read_text("utf-8"))
    if args.recheck:
        path = args.out_dir / f"{args.entry}.json"
        r = json.loads(path.read_text("utf-8"))
        r["stage3"] = stage3_score(r["runs"], prompts)
        r["prompt_set_version"] = prompts["version"]
        write(r, prompts, args.out_dir)
        return 0
    if args.stage3_only:
        if not args.model:
            p.error("--model is required")
        path = args.out_dir / f"{args.entry}.json"
        r = json.loads(path.read_text("utf-8"))
        if sha256(args.model.expanduser()) != r["stage1"]["sha256"]:
            sys.exit("the model file is not the one stage 1 checked")
        r["runs"] = stage3_run(args.engine_dir, args.build, args.model.expanduser(), prompts)
        r["stage3"] = stage3_score(r["runs"], prompts)
        r["prompt_set_version"] = prompts["version"]
        r["stage3_run_at"] = dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC")
        write(r, prompts, args.out_dir)
        return 0
    if not (args.model and args.reference and args.text):
        p.error("--model, --reference and --text are required (unless --recheck)")

    catalogue = json.loads(CATALOGUE.read_text("utf-8"))
    entry = next((e for e in catalogue["entries"] if e["id"] == args.entry), None)
    refs = json.loads(REFERENCES.read_text("utf-8"))
    ref = refs["references"].get(args.entry)
    if entry is None or ref is None:
        sys.exit(f"no catalogue entry or reference for {args.entry}")
    model, reference, text = (x.expanduser() for x in (args.model, args.reference, args.text))

    print("stage 1: checking the file...")
    s1 = stage1(entry, model)
    if not s1["checks"]["SHA-256 matches the catalogue"]:
        sys.exit("the model file is not the one the catalogue names")
    if sha256(reference) != ref["sha256"] or sha256(text) != refs["text"]["sha256"]:
        sys.exit("the reference file or the text does not match quality_references.json")
    s2 = stage2(args.perplexity_bin, model, reference, text)
    runs = stage3_run(args.engine_dir, args.build, model, prompts)

    release_file = args.engine_dir.parent / "release.txt"
    r = {
        "model": {
            "entry": entry["id"],
            "display_name": entry["display_name"],
            "filename": entry["artefact"]["filename"],
        },
        "reference": ref,
        "text": refs["text"],
        "engine": {
            "release": release_file.read_text().split()[0] if release_file.is_file() else "unknown",
            "build": args.build,
        },
        "settings": SETTINGS,
        "prompt_set_version": prompts["version"],
        "run_at": dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "machine": f"{platform.system()} {platform.machine()}",
        "stage1": s1,
        "stage2": s2,
        "runs": runs,
    }
    r["stage3"] = stage3_score(runs, prompts)
    write(r, prompts, args.out_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
