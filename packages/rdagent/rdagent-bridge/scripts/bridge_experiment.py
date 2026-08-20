"""Bridge one RD-Agent trace into the quant-experiment layout (dry-run by default).

Reads the runner result of a finished RD-Agent trace (factors + metrics) and
prepares an experiment skeleton under a quant-experiment-style target:

    <target>/<exp-name>/manifest.json   (JSONL header: generated/design/source)
    <target>/<exp-name>/metrics/<exp-name>_bridge_metrics.json

The manifest follows the exp1s layout (header line + one JSON run row per
line). Dry-run prints the exact files that would be written; --write performs
the write and refuses to touch an existing experiment directory.

Usage:
    python bridge_experiment.py <log_dir> <trace_id> --exp-name <name> [--target <dir>] [--write]
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log_dir", type=Path)
    parser.add_argument("trace_id", type=str)
    parser.add_argument("--exp-name", required=True, type=str)
    parser.add_argument("--target", type=Path, default=Path("experiments"))
    parser.add_argument("--write", action="store_true", help="write files instead of dry-run")
    args = parser.parse_args()

    trace_path = (args.log_dir / args.trace_id).resolve()
    if not trace_path.is_dir():
        print(f"trace not found: {trace_path}", file=sys.stderr)
        return 2

    try:
        from rdagent.log.storage import FileStorage
    except ImportError:
        print("rdagent package not importable; run with the RD-Agent python", file=sys.stderr)
        return 3

    # Collect the runner result (experiment metrics + factor tasks).
    metrics: dict | None = None
    factors: list[str] = []
    hypotheses: list[str] = []
    for msg in FileStorage(trace_path).iter_msg():
        tag = msg.tag or ""
        if "runner result" in tag and hasattr(msg.content, "result"):
            try:
                values = msg.content.result.to_dict() if hasattr(msg.content.result, "to_dict") else dict(msg.content.result)
                metrics = {str(k): float(v) for k, v in values.items() if isinstance(v, (int, float))}
            except Exception:
                pass
        if "experiment generation" in tag and isinstance(msg.content, list):
            import re

            for item in msg.content:
                m = re.search(r"FactorTask\[([^\]]+)\]", str(item))
                if m:
                    factors.append(m.group(1))
        if "hypothesis generation" in tag and isinstance(msg.content, dict):
            h = msg.content.get("hypothesis")
            if isinstance(h, str) and h:
                hypotheses.append(h)

    exp_dir = args.target / args.exp_name
    if exp_dir.exists():
        print(f"refusing to touch existing experiment: {exp_dir}", file=sys.stderr)
        return 4

    now = datetime.now(timezone.utc).isoformat()
    header = {
        "generated": now,
        "design": f"RD-Agent bridge: {args.trace_id}",
        "source": "rdagent-bridge",
        "runs": [],
    }
    metric_file = exp_dir / "metrics" / f"{args.exp_name}_bridge_metrics.json"
    metric_doc = {
        "generated": now,
        "trace": args.trace_id,
        "factors": factors,
        "hypotheses": hypotheses,
        "metrics": metrics,
    }

    plan = [
        exp_dir / "manifest.json",
        metric_file,
    ]
    print("== bridge plan (dry-run)" if not args.write else "== bridge write")
    for file in plan:
        print(f"  {file}")
    print(f"  factors: {factors}")
    print(f"  metric keys: {sorted((metrics or {}).keys())}")

    if not args.write:
        print("(use --write to create the experiment)")
        return 0

    exp_dir.mkdir(parents=True, exist_ok=True)
    (exp_dir / "metrics").mkdir(exist_ok=True)
    (exp_dir / "manifest.json").write_text(
        json.dumps(header, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    metric_file.write_text(json.dumps(metric_doc, ensure_ascii=False, indent=1), encoding="utf-8")
    print("written.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
