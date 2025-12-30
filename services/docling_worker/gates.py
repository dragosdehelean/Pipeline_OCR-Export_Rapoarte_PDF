"""Quality gate evaluation for docling worker metrics."""
import json
from typing import Any, Dict, List, Tuple


def load_config(path: str) -> Dict[str, Any]:
    """Loads the gate config JSON from disk."""
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def evaluate_gates(
    metrics: Dict[str, float], config: Dict[str, Any]
) -> Tuple[bool, List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Evaluates metrics against gate rules and returns pass/fail info."""
    evaluated = []
    failed = []

    for gate in config.get("gates", []):
        if not gate.get("enabled", False):
            continue
        code = gate.get("code")
        metric_name = gate.get("metric")
        actual = float(metrics.get(metric_name, 0))
        op = gate.get("op")
        threshold = float(gate.get("threshold", 0))
        passed = _compare(actual, op, threshold)
        evaluated.append(
            {
                "code": code,
                "severity": gate.get("severity"),
                "metric": metric_name,
                "op": op,
                "threshold": threshold,
                "actual": actual,
                "passed": passed,
                "message": gate.get("message", ""),
            }
        )
        if not passed and gate.get("severity") == "FAIL":
            failed.append(
                {
                    "code": code,
                    "message": gate.get("message", ""),
                    "actual": actual,
                    "expectedOp": op,
                    "expected": threshold,
                }
            )

    return len(failed) == 0, failed, evaluated


def _compare(actual: float, op: str, expected: float) -> bool:
    if op == ">":
        return actual > expected
    if op == ">=":
        return actual >= expected
    if op == "<":
        return actual < expected
    if op == "<=":
        return actual <= expected
    if op == "==":
        return actual == expected
    if op == "!=":
        return actual != expected
    raise ValueError(f"Unsupported gate op: {op}")
