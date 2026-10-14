import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOURNAL = ROOT / "scripts" / "engineering_journal.py"
COMPACTOR = ROOT / "scripts" / "experience_compactor.py"


def run(*args, success=True):
    command = subprocess.run(
        [sys.executable, *map(str, args)],
        capture_output=True, text=True, check=False,
    )
    if success:
        assert command.returncode == 0, command.stderr
    return command


def mission(path, name, steps=("inspect-head", "run-focused-tests", "review-diff"), *,
            close=True, failed_step=None, residual_risk=None):
    run(JOURNAL, path, "init", "--contract", f"Mission {name}")
    for step in steps:
        outcome = "failed" if failed_step == step else "passed"
        run(JOURNAL, path, "workflow-step", "--workflow", "repo-validation", "--step", step,
            "--outcome", outcome, "--evidence-id", f"test:{step}-{name}")
    if close:
        args = [JOURNAL, path, "close", "--evidence-level", "focused-validated"]
        if residual_risk:
            args += ["--residual-risk", residual_risk]
        run(*args)
    return path


def mine(*journals, min_runs=3):
    result = run(COMPACTOR, *journals, "--scope-id", "repo:example/app",
                 "--include-workflows", "--min-workflow-runs", str(min_runs))
    return json.loads(result.stdout)


def workflows(payload):
    return [candidate for candidate in payload["candidates"]
            if candidate["kind"] == "repeated-workflow"]


def test_three_independent_closed_proven_runs_produce_ordered_candidate(tmp_path):
    runs = [mission(tmp_path / f"run{i}.json", str(i)) for i in range(3)]
    output = mine(*runs)
    found = workflows(output)
    assert len(found) == 1
    entry = found[0]
    assert entry["steps"] == ["inspect-head", "run-focused-tests", "review-diff"]
    assert entry["independent_successful_runs"] == 3
    assert len(entry["supporting_run_ids"]) == 3
    assert entry["counterexample_runs"] == 0
    assert entry["review_required"] and entry["regression_required"]
    assert entry["promotion_blocked"] is False
    assert entry["scope_type"] == "project"
    assert output["warning"].startswith("Candidate experiences")


def test_two_runs_or_copied_journal_never_count_as_three(tmp_path):
    first = mission(tmp_path / "a.json", "a")
    second = mission(tmp_path / "b.json", "b")
    copied = tmp_path / "copy.json"
    copied.write_bytes(first.read_bytes())
    assert workflows(mine(first, second)) == []
    assert workflows(mine(first, second, copied)) == []


def test_failed_open_and_risky_runs_block_promotion(tmp_path):
    trusted = [mission(tmp_path / f"good{i}.json", f"good{i}") for i in range(3)]
    failed = mission(tmp_path / "failed.json", "failed", failed_step="review-diff")
    open_journal = mission(tmp_path / "open.json", "open", close=False)
    risky = mission(tmp_path / "risky.json", "risky", residual_risk="unreviewed-policy")
    result = workflows(mine(*trusted, failed, open_journal, risky))
    assert len(result) == 1
    assert result[0]["independent_successful_runs"] == 3
    assert result[0]["counterexample_runs"] == 3
    assert result[0]["promotion_blocked"] is True


def test_changed_step_order_is_counterexample_not_silent_merge(tmp_path):
    good = [mission(tmp_path / f"good{i}.json", f"good{i}") for i in range(3)]
    alternate = mission(tmp_path / "alternative.json", "alt",
                        steps=("run-focused-tests", "inspect-head", "review-diff"))
    candidates = workflows(mine(*good, alternate))
    assert len(candidates) == 1
    assert candidates[0]["counterexample_runs"] == 1
    assert candidates[0]["promotion_blocked"]


def test_requires_actual_valid_proof_and_idempotent_replay(tmp_path):
    journal = tmp_path / "no-proof.json"
    run(JOURNAL, journal, "init", "--contract", "test evidence")
    fail = run(JOURNAL, journal, "workflow-step", "--workflow", "repo-validation",
               "--step", "inspect-head", "--outcome", "passed", success=False)
    assert fail.returncode == 2
    assert "evidence IDs" in fail.stderr
    for _ in range(2):
        run(JOURNAL, journal, "workflow-step", "--workflow", "repo-validation",
            "--step", "inspect-head", "--outcome", "passed", "--evidence-id", "commit:deadbeef")
    data = json.loads(journal.read_text())
    assert len(data["telemetry"]["workflow_steps"]) == 1
    conflict = run(JOURNAL, journal, "workflow-step", "--workflow", "repo-validation",
                   "--step", "inspect-head", "--outcome", "failed", success=False)
    assert conflict.returncode == 2
    assert "already recorded" in conflict.stderr
    injected = run(JOURNAL, journal, "workflow-step", "--workflow", "repo-validation",
                   "--step", "other-step", "--outcome", "passed",
                   "--evidence-id", "test:abc; rm -rf /", success=False)
    assert injected.returncode == 2


def test_legacy_journal_still_works_and_default_is_opt_in(tmp_path):
    path = tmp_path / "legacy.json"
    run(JOURNAL, path, "init", "--contract", "old mission")
    data = json.loads(path.read_text())
    del data["telemetry"]["workflow_steps"]
    path.write_text(json.dumps(data))
    stats = json.loads(run(JOURNAL, path, "stats").stdout)
    assert stats["counts"]["journaled_workflow_steps"] == 0
    without_opt_in = run(COMPACTOR, path, "--scope-id", "repo:example/app")
    assert workflows(json.loads(without_opt_in.stdout)) == []


def test_compactor_does_not_mutate_source_or_skill(tmp_path):
    runs = [mission(tmp_path / f"case{i}.json", f"case{i}") for i in range(3)]
    before = [(path, path.read_bytes()) for path in runs]
    skill_before = (ROOT / "SKILL.md").read_bytes()
    mine(*runs)
    assert all(path.read_bytes() == contents for path, contents in before)
    assert (ROOT / "SKILL.md").read_bytes() == skill_before


def test_minimum_workflow_threshold_cannot_be_one(tmp_path):
    one = mission(tmp_path / "one.json", "one")
    response = run(COMPACTOR, one, "--scope-id", "repo:example/app",
                   "--include-workflows", "--min-workflow-runs", "1", success=False)
    assert response.returncode == 2
    assert "must be >= 2" in response.stderr
