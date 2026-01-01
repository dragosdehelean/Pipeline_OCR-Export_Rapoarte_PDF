"""Tests for quality gate evaluation logic."""
import json
from pathlib import Path

from services.docling_worker.gates import evaluate_gates


ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = ROOT_DIR / "config" / "quality-gates.json"


def load_repo_config() -> dict:
    with CONFIG_PATH.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def value_to_pass(op: str, threshold: float) -> float:
    if op == ">":
        return threshold + 1
    if op == ">=":
        return threshold
    if op == "<":
        return threshold - 1
    if op == "<=":
        return threshold
    if op == "==":
        return threshold
    if op == "!=":
        return threshold + 1
    raise ValueError(f"Unsupported op: {op}")


def value_to_fail(op: str, threshold: float) -> float:
    if op == ">":
        return threshold
    if op == ">=":
        return threshold - 1
    if op == "<":
        return threshold
    if op == "<=":
        return threshold + 1
    if op == "==":
        return threshold + 1
    if op == "!=":
        return threshold
    raise ValueError(f"Unsupported op: {op}")


def test_evaluate_gates_passes():
    config = load_repo_config()
    gate = next(gate for gate in config["gates"] if gate.get("enabled") and gate.get("severity") == "FAIL")
    metrics = {
        gate["metric"]: value_to_pass(gate["op"], float(gate["threshold"])),
    }
    passed, failed, evaluated = evaluate_gates(metrics, {"gates": [gate]})
    assert passed is True
    assert failed == []
    assert evaluated[0]["passed"] is True


def test_evaluate_gates_fails():
    config = load_repo_config()
    gate = next(gate for gate in config["gates"] if gate.get("enabled") and gate.get("severity") == "FAIL")
    metrics = {
        gate["metric"]: value_to_fail(gate["op"], float(gate["threshold"])),
    }
    passed, failed, evaluated = evaluate_gates(metrics, {"gates": [gate]})
    assert passed is False
    assert failed[0]["code"] == gate["code"]
    assert evaluated[0]["passed"] is False


def test_evaluate_gates_rejects_invalid_op():
    gate = {
        "code": "BAD_OP",
        "enabled": True,
        "severity": "FAIL",
        "metric": "pages",
        "op": "??",
        "threshold": 1,
        "message": "invalid",
    }
    try:
        evaluate_gates({"pages": 1}, {"gates": [gate]})
    except ValueError as exc:
        assert "Unsupported gate op" in str(exc)
    else:
        raise AssertionError("Expected ValueError for invalid gate op")


def test_evaluate_gates_supports_equal_ops():
    gate_eq = {
        "code": "PAGES_EQ",
        "enabled": True,
        "severity": "FAIL",
        "metric": "pages",
        "op": "==",
        "threshold": 2,
        "message": "must equal",
    }
    gate_neq = {
        "code": "PAGES_NEQ",
        "enabled": True,
        "severity": "FAIL",
        "metric": "pages",
        "op": "!=",
        "threshold": 2,
        "message": "must not equal",
    }
    passed, failed, evaluated = evaluate_gates({"pages": 2}, {"gates": [gate_eq, gate_neq]})
    assert passed is False
    assert any(item["code"] == "PAGES_EQ" and item["passed"] is True for item in evaluated)
    assert any(item["code"] == "PAGES_NEQ" and item["passed"] is False for item in evaluated)
    assert failed[0]["code"] == "PAGES_NEQ"
