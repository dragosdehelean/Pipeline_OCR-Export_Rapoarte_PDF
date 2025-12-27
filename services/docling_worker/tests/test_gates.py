import json
from pathlib import Path

from services.docling_worker.gates import evaluate_gates


ROOT_DIR = Path(__file__).resolve().parents[3]
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
