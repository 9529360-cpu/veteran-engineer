import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "scripts" / "workspace_release_gate.py"


def write_json(archive: zipfile.ZipFile, path: str, value: dict) -> None:
    archive.writestr(path, json.dumps(value))


def build_candidate(path: Path, *, version: str = "1.14.9", revision: str = "abc1234", leak_runtime: bool = False):
    plugin = {
        "name": "veteran-engineering-studio",
        "version": version,
    }
    legacy = {
        "name": "veteran-engineering-studio",
        "version": version,
        "skills": "./skills",
    }
    distribution = {
        "schemaVersion": 1,
        "product": "veteran-engineering-studio",
        "profile": "workspace",
        "surfaceProfile": "workspace-skill",
        "includes": {
            "skill": True,
            "runtime": False,
            "mcpManifest": False,
            "appReference": False,
        },
        "releaseProvenance": {
            "sourceOfTruth": "https://github.com/9529360-cpu/veteran-engineer",
            "sourceRevision": revision,
        },
    }
    with zipfile.ZipFile(path, "w") as archive:
        write_json(archive, "plugin.json", plugin)
        write_json(archive, ".codex-plugin/plugin.json", legacy)
        write_json(archive, "veteran-distribution.json", distribution)
        archive.writestr("skills/runtime-regression-debugger/SKILL.md", "---\nname: runtime-regression-debugger\ndescription: test\n---\n")
        archive.writestr("skills/runtime-regression-debugger/agents/openai.yaml", "interface:\n  display_name: Test\n")
        archive.writestr("skills/frontend-design-builder/SKILL.md", "---\nname: frontend-design-builder\ndescription: test\n---\n")
        archive.writestr("skills/frontend-design-builder/agents/openai.yaml", "interface:\n  display_name: Test\n")
        if leak_runtime:
            archive.writestr(".mcp.json", "{}")


def run_gate(archive: Path, *args: str, check: bool = True):
    return subprocess.run(
        [sys.executable, str(GATE), str(archive), *args],
        text=True,
        capture_output=True,
        check=check,
    )


def test_workspace_release_gate_accepts_exact_main_candidate(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        "--expected-version",
        "1.14.9",
        "--installed-version",
        "1.14.8",
        "--expected-sha256",
        digest,
        "--json",
    )
    report = json.loads(proc.stdout)

    assert report["safe_for_publication"] is True
    assert report["version"] == "1.14.9"
    assert report["source_revision"] == "abc1234"
    assert report["sha256"] == digest


def test_workspace_release_gate_rejects_wrong_source_revision(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive, revision="deadbee")

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        check=False,
    )

    assert proc.returncode != 0
    assert "source revision mismatch" in proc.stderr


def test_workspace_release_gate_rejects_local_runtime_leak(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive, leak_runtime=True)

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        check=False,
    )

    assert proc.returncode != 0
    assert "leaks local runtime/MCP surfaces" in proc.stderr


def test_workspace_release_gate_requires_version_progress(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive, version="1.14.8")

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        "--installed-version",
        "1.14.8",
        check=False,
    )

    assert proc.returncode != 0
    assert "candidate version must be newer" in proc.stderr


def test_workspace_release_gate_rejects_wrong_artifact_digest(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        "--expected-sha256",
        "0" * 64,
        check=False,
    )

    assert proc.returncode != 0
    assert "archive SHA-256 mismatch" in proc.stderr


def test_workspace_release_gate_rejects_extra_skill(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr(
            "skills/unexpected-skill/SKILL.md",
            "---\nname: unexpected-skill\ndescription: test\n---\n",
        )

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        check=False,
    )

    assert proc.returncode != 0
    assert "Skill entrypoints mismatch" in proc.stderr


def test_workspace_release_gate_rejects_case_colliding_path(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr("Plugin.json", "{}")

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        check=False,
    )

    assert proc.returncode != 0
    assert "case-colliding file paths" in proc.stderr


def test_workspace_release_gate_rejects_unexpected_top_level_surface(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr("src/hidden-runtime.mjs", "export {}\n")

    proc = run_gate(
        archive,
        "--expected-revision",
        "abc1234",
        check=False,
    )

    assert proc.returncode != 0
    assert "unexpected top-level surfaces" in proc.stderr
