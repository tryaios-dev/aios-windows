"""B-05: scan the locked Python runtime dependencies with pip-audit.

Passes when there are no findings, or every finding is in the exceptions record.
Report: build/out/scan/pip-audit.json
"""

import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from exceptions import ROOT, accepted_ids  # noqa: E402

OUT = ROOT / "build" / "out" / "scan"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    reqs = OUT / "requirements.txt"
    reqs.write_text(
        subprocess.check_output(
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
        ),
        "utf-8",
    )
    report = OUT / "pip-audit.json"
    subprocess.call(
        [
            sys.executable,
            "-m",
            "pip_audit",
            "-r",
            str(reqs),
            "--no-deps",
            "--disable-pip",
            "-f",
            "json",
            "-o",
            str(report),
        ],
        cwd=ROOT,
    )
    data = json.loads(report.read_text("utf-8"))
    accepted = accepted_ids()
    open_findings = [
        f"{dep['name']} {dep['version']}: {v['id']}"
        for dep in data.get("dependencies", [])
        for v in dep.get("vulns", [])
        if v["id"] not in accepted and not set(v.get("aliases", [])) & accepted
    ]
    for line in open_findings:
        print("FINDING", line)
    print(f"python dependency scan: {len(open_findings)} open finding(s)")
    return 1 if open_findings else 0


if __name__ == "__main__":
    sys.exit(main())
