"""Week-1 engine benchmark (D-04): time to first words and generation speed per machine.

    uv run python tools/bench/engine_bench.py --model C:\\models\\Qwen3-4B-Q4_K_M.gguf
        [--engine-dir build/out/llama/cpu]   # or the installed app's resources\\llama\\cpu
        [--tier small] [--runs 3] [--out bench.json]

Starts llama-server through the backend's own launcher (key over stdin, minimal environment,
contract flags), sends a warm-up and then --runs short prompts, and compares the medians with
MVP 10.2 and AC-04. Prints no prompt or answer text, only figures.
"""

import argparse
import json
import platform
import secrets
import statistics
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

from aios_backend.engine.job import KillOnCloseJob
from aios_backend.engine.launcher import start
from aios_common.handshake import set_token_for_tests

ROOT = Path(__file__).resolve().parents[2]
WORDS_PER_TOKEN = 0.75  # English rule of thumb, to compare with the "words per second" in MVP 10.2
TIERS = {"small": (5.0, 15.0), "medium": (None, None)}  # words per second expected on CPU
FIRST_WORDS_TARGET_S = 10.0  # AC-04, 8 GB CPU-only machine
PROMPTS = [
    "In two sentences, explain what a firewall does.",
    "List three tips for writing a clear email.",
    "What is the capital of Italy? Answer in one sentence.",
]


def ask(base: str, key: str, prompt: str, max_tokens: int) -> dict[str, float]:
    body = json.dumps(
        {
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": max_tokens,
            "stream": True,
            "chat_template_kwargs": {"enable_thinking": False},
        }
    ).encode()
    req = urllib.request.Request(  # noqa: S310 - loopback engine
        f"{base}/v1/chat/completions",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    began = time.perf_counter()
    first = None
    timings: dict[str, float] = {}
    with urllib.request.urlopen(req, timeout=600) as resp:  # noqa: S310 - loopback engine
        for raw in resp:
            line = raw.decode().strip()
            if not line.startswith("data: ") or line == "data: [DONE]":
                continue
            chunk = json.loads(line[6:])
            for choice in chunk.get("choices", []):
                if first is None and (choice.get("delta") or {}).get("content"):
                    first = time.perf_counter() - began
            timings = chunk.get("timings") or timings
    return {
        "first_words_s": first if first is not None else float("nan"),
        "total_s": time.perf_counter() - began,
        "tokens": float(timings.get("predicted_n", 0)),
        "tokens_per_s": float(timings.get("predicted_per_second", 0.0)),
        "prompt_tokens_per_s": float(timings.get("prompt_per_second", 0.0)),
    }


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--model", type=Path, required=True)
    p.add_argument("--engine-dir", type=Path, default=ROOT / "build" / "out" / "llama" / "cpu")
    p.add_argument("--tier", choices=sorted(TIERS), default="small")
    p.add_argument("--runs", type=int, default=3)
    p.add_argument("--max-tokens", type=int, default=128)
    p.add_argument("--out", type=Path)
    args = p.parse_args()

    set_token_for_tests(secrets.token_urlsafe(32))  # the engine key is derived from it
    job = KillOnCloseJob()
    with tempfile.TemporaryDirectory() as tmp:
        load_began = time.perf_counter()
        engine = start(args.engine_dir, args.model, Path(tmp), job)
        load_s = time.perf_counter() - load_began
        try:
            ask(engine.base_url, engine.key, "Say hello.", 8)  # warm-up, not measured
            runs = [
                ask(engine.base_url, engine.key, PROMPTS[i % len(PROMPTS)], args.max_tokens)
                for i in range(args.runs)
            ]
        finally:
            engine.stop()
            job.close()

    med = {k: statistics.median(r[k] for r in runs) for k in runs[0]}
    words_per_s = med["tokens_per_s"] * WORDS_PER_TOKEN
    low, high = TIERS[args.tier]
    result = {
        "machine": {"os": platform.platform(), "cpu": platform.processor() or platform.machine()},
        "engine_dir": str(args.engine_dir),
        "model": args.model.name,
        "model_bytes": args.model.stat().st_size,
        "tier": args.tier,
        "model_load_s": round(load_s, 2),
        "median": {k: round(v, 2) for k, v in med.items()},
        "words_per_s_estimate": round(words_per_s, 1),
        "runs": runs,
        "checks": {
            "first_words_within_10_s": med["first_words_s"] <= FIRST_WORDS_TARGET_S,
            "speed_in_tier_range": None if low is None else low <= words_per_s,
        },
    }
    print(
        f"model           {args.model.name} ({args.model.stat().st_size / 1e9:.2f} GB), tier {args.tier}"
    )
    print(f"engine          {args.engine_dir}")
    print(f"model load      {load_s:.1f} s")
    print(
        f"first words     {med['first_words_s']:.2f} s   (target <= {FIRST_WORDS_TARGET_S:.0f} s, AC-04)"
    )
    print(
        f"generation      {med['tokens_per_s']:.1f} tokens/s  ~ {words_per_s:.1f} words/s"
        + (f"   (tier table: {low:.0f}-{high:.0f} words/s on CPU)" if low else "")
    )
    print(f"prompt reading  {med['prompt_tokens_per_s']:.1f} tokens/s")
    if args.out:
        args.out.write_text(json.dumps(result, indent=2) + "\n", "utf-8")
        print(f"saved {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
