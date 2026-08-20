"""Convert RD-Agent trace logs (pickled Message objects) to JSON for the DSH
rdagent-bridge plugin.

Usage:
    python parse_trace.py <log_dir> <trace_id> [--limit N] [--tag TAG]

The trace layout is the one FileStorage writes: <log_dir>/<trace_id>/
**/<pid>/<timestamp>.pkl. Tag derivation reuses rdagent's FileStorage.iter_msg
so the DSH panel sees exactly what the Streamlit UI would. Domain objects get
structured extraction (experiment results, feedback records, workspace code)
so the browser can render cards instead of raw text.
"""
import argparse
import json
import math
import sys
from pathlib import Path
from typing import Any

MAX_DEPTH = 5


def serialize_content(content: Any, depth: int = 0) -> Any:
    """Best-effort JSON conversion of an arbitrary pickled object."""
    if content is None or isinstance(content, bool):
        return content
    if isinstance(content, (int, float)):
        # JSON has no NaN/Infinity literals; Python's json.dumps would emit
        # them bare and the browser's JSON.parse would reject the document.
        return content if math.isfinite(float(content)) else None
    if isinstance(content, str):
        return content
    if depth > MAX_DEPTH:
        return str(content)[:2000]
    try:
        import pandas as pd

        if isinstance(content, pd.DataFrame):
            base: dict[str, Any] = {
                "type": "DataFrame",
                "shape": list(content.shape),
                "columns": [str(c) for c in content.columns][:50],
            }
            columns = {str(c) for c in content.columns}
            # Account-curve frames (qlib backtest output: account/cash/bench)
            # render as full series in the panel; other frames keep the compact
            # head summary. Non-finite numbers become null for JSON safety.
            if content.shape[0] <= 5000 and {"account", "cash", "bench"}.issubset(columns):

                def json_number(value: Any) -> Any:
                    try:
                        number = float(value)
                    except (TypeError, ValueError):
                        return value
                    return number if math.isfinite(number) else None

                base["rows"] = [
                    {str(k): json_number(v) for k, v in record.items()}
                    for record in content.to_dict(orient="records")
                ]
                return base
            base["head"] = content.head(5).astype(str).to_dict(orient="records")
            return base
        if isinstance(content, pd.Series):
            return {
                "type": "Series",
                "values": {str(k): serialize_content(v, depth + 1) for k, v in content.to_dict().items()},
            }
    except Exception:  # pragma: no cover - pandas optional
        pass
    if isinstance(content, (list, tuple)):
        return [serialize_content(v, depth + 1) for v in content[:200]]
    if isinstance(content, dict):
        return {str(k): serialize_content(v, depth + 1) for k, v in list(content.items())[:200]}

    # ── RD-Agent domain objects ──────────────────────────────────────────────

    # QlibFactorExperiment / QlibModelExperiment: backtest result + baselines.
    if hasattr(content, "result") and hasattr(content, "based_experiments"):
        out: dict[str, Any] = {"type": type(content).__name__}
        try:
            if content.result is not None:
                out["result"] = serialize_content(content.result, depth + 1)
        except Exception:
            pass
        try:
            # Flatten each baseline's result Series to a top-level `values`
            # dict so consumers can compare against it without navigating the
            # nested result object.
            baselines: list[Any] = []
            for baseline in (content.based_experiments or [])[:10]:
                try:
                    result = serialize_content(baseline.result, depth + 1)
                    if isinstance(result, dict) and isinstance(result.get("values"), dict):
                        baselines.append({"type": type(baseline).__name__, "values": result["values"]})
                        continue
                except Exception:
                    pass
                baselines.append(serialize_content(baseline, depth + 1))
            out["based_experiments"] = baselines
        except Exception:
            out["based_experiments"] = []
        for attr in ("hypothesis",):
            try:
                value = getattr(content, attr)
                if value is not None:
                    out[attr] = serialize_content(value, depth + 1)
            except Exception:
                continue
        return out

    # CoSTEERMultiFeedback: a round's per-task feedback list.
    feedback_list = getattr(content, "feedback_list", None)
    if isinstance(feedback_list, list):
        return {
            "type": type(content).__name__,
            "feedback_list": [serialize_content(f, depth + 1) for f in feedback_list[:50]],
        }

    # CoSTEERSingleFeedbackDeprecated: one task's execution/code/value verdict.
    if hasattr(content, "final_decision"):
        out = {"type": type(content).__name__}
        for attr in (
            "execution_feedback",
            "code_feedback",
            "value_feedback",
            "final_feedback",
            "final_decision",
            "value_generated_flag",
        ):
            try:
                value = getattr(content, attr)
                if value is not None:
                    out[attr] = serialize_content(value, depth + 1)
            except Exception:
                continue
        return out

    # Workspace with injected code files (factor.py / model.py ...).
    file_dict = getattr(content, "file_dict", None)
    if isinstance(file_dict, dict):
        out = {"type": type(content).__name__, "files": {str(k): str(v)[:20000] for k, v in file_dict.items()}}
        try:
            if content.raise_exception is not None:
                out["raise_exception"] = str(content.raise_exception)[:2000]
        except Exception:
            pass
        return out

    # Fallback: pick friendly attributes from domain objects before str().
    for attr in ("rich_style_description", "hypothesis", "final_feedback", "reason", "decision", "stdout"):
        try:
            value = getattr(content, attr)
            if value is not None:
                return {attr: serialize_content(value, depth + 1)}
        except Exception:
            continue
    return str(content)[:20000]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("log_dir", type=Path)
    parser.add_argument("trace_id", type=str)
    parser.add_argument("--limit", type=int, default=2000)
    parser.add_argument("--tag", type=str, default="")
    args = parser.parse_args()

    trace_path = (args.log_dir / args.trace_id).resolve()
    log_root = args.log_dir.resolve()
    if not str(trace_path).startswith(str(log_root)) or not trace_path.is_dir():
        print(json.dumps({"error": "trace outside log dir or missing"}), flush=True)
        return 2

    try:
        from rdagent.log.storage import FileStorage
    except ImportError:
        print(json.dumps({"error": "rdagent package not importable in pythonBin"}), flush=True)
        return 3

    messages = []
    for msg in FileStorage(trace_path).iter_msg():
        if args.tag and args.tag not in msg.tag:
            continue
        messages.append(
            {
                "tag": msg.tag,
                "timestamp": msg.timestamp.isoformat(),
                "pid": msg.pid_trace,
                "content": serialize_content(msg.content),
            }
        )
        if len(messages) >= args.limit:
            break

    print(json.dumps({"trace": args.trace_id, "count": len(messages), "messages": messages}, allow_nan=False), flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
