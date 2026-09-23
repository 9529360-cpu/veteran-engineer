import json
import re
from pathlib import Path

import pytest

SKILL_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = SKILL_ROOT.parent.parent
FRONTEND_ROOT = SKILL_ROOT.parent / "frontend-design-builder"


def _frontmatter(text: str) -> dict[str, str]:
    match = re.match(r"^---\n([\s\S]*?)\n---\n", text)
    assert match, "SKILL.md must start with YAML frontmatter"
    fields = {}
    for raw in match.group(1).splitlines():
        if not raw.strip():
            continue
        key, sep, value = raw.partition(":")
        assert sep, f"invalid frontmatter line: {raw}"
        fields[key.strip()] = value.strip().strip('"')
    return fields


def _referenced_paths(text: str) -> set[str]:
    paths = set()
    for code_span in re.findall(r"`([^`]+)`", text):
        match = re.match(r"((?:references|scripts|assets)/[A-Za-z0-9._/-]+)", code_span)
        if match:
            paths.add(match.group(1))
    return paths


def test_studio_composition_contract():
    plugin_path = REPO_ROOT / "plugin.json"
    if not plugin_path.is_file() or not FRONTEND_ROOT.is_dir():
        pytest.skip("standalone Veteran Skill package has no Studio sibling/plugin manifest")

    plugin = json.loads(plugin_path.read_text())
    assert plugin["name"] == "veteran-engineering-studio"
    assert re.fullmatch(r"\d+\.\d+\.\d+", plugin["version"])
    interface = plugin["extensions"]["com.openai"]["interface"]
    assert interface["displayName"] == "Veteran Engineering Studio"
    assert interface["developerName"] == "Veteran Engineer Project"
    assert {"Read", "Write"}.issubset(set(interface["capabilities"]))

    runtime_text = (SKILL_ROOT / "SKILL.md").read_text()
    frontend_text = (FRONTEND_ROOT / "SKILL.md").read_text()
    assert "sibling `frontend-design-builder` Skill" in runtime_text
    assert "retains end-to-end engineering ownership" in runtime_text
    assert "Do not bounce the task between sibling Skills" in runtime_text
    assert "sibling `runtime-regression-debugger` Skill" in frontend_text
    assert "## Studio collaboration contract" in frontend_text
    assert "Do not ping-pong ownership" in frontend_text
    assert "Keep the active reference set small" in frontend_text
    assert "scripts/frontend_context_router.py" in frontend_text
    assert "scripts/design_system_probe.py" in frontend_text

    for root, expected_name in [
        (SKILL_ROOT, "runtime-regression-debugger"),
        (FRONTEND_ROOT, "frontend-design-builder"),
    ]:
        skill_text = (root / "SKILL.md").read_text()
        fields = _frontmatter(skill_text)
        assert set(fields) == {"name", "description"}
        assert fields["name"] == expected_name
        assert fields["description"]
        assert len(skill_text.splitlines()) <= 500
        agent = (root / "agents" / "openai.yaml").read_text()
        assert "display_name:" in agent and "short_description:" in agent
        for rel in _referenced_paths(skill_text):
            target = root / rel
            assert target.exists(), f"{expected_name} references missing resource: {rel}"
            if rel.startswith(("references/", "scripts/")):
                assert target.is_file(), f"{expected_name} executable/reference resource must be a file: {rel}"
            if rel.startswith("references/"):
                assert len(Path(rel).parts) == 2, f"deep reference path is not allowed: {rel}"

    runtime_agent = (SKILL_ROOT / "agents" / "openai.yaml").read_text()
    frontend_agent = (FRONTEND_ROOT / "agents" / "openai.yaml").read_text()
    assert "allow_implicit_invocation: true" in runtime_agent
    for product in ("chatgpt", "codex", "api", "atlas"):
        assert f"- {product}" in runtime_agent
    assert "policy:" not in frontend_agent
    assert "allow_implicit_invocation" not in frontend_agent

    benchmark = json.loads((FRONTEND_ROOT / "evals" / "benchmark_scenarios.json").read_text())
    scenarios = benchmark["scenarios"]
    ids = [row["id"] for row in scenarios]
    assert len(ids) == len(set(ids)) >= 10
    modes = {row["expected_mode"] for row in scenarios}
    assert {"existing-system", "reference-led", "concept-first", "production", "prototype", "graceful-degradation", "handoff"}.issubset(modes)
    for row in scenarios:
        assert row["request"] and row["must_do"] and row["must_not"]
        for rel in row["must_load"]:
            assert (FRONTEND_ROOT / rel).is_file(), f"benchmark references missing resource: {rel}"

    exporter = (SKILL_ROOT / "scripts" / "export_plugin_bundle.py").read_text()
    assert "frontend-design-builder" in exporter
    assert "copy_portable_manifest" in exporter

    workflow = (REPO_ROOT / ".github" / "workflows" / "skill-engineering-tools.yml").read_text()
    assert 'skills/runtime-regression-debugger/**' in workflow
    assert 'skills/frontend-design-builder/**' in workflow
    assert 'plugin.json' in workflow

    router = FRONTEND_ROOT / "scripts" / "frontend_context_router.py"
    router_tests = FRONTEND_ROOT / "tests" / "test_frontend_context_router.py"
    assert router.is_file()
    assert router_tests.is_file()
    probe = FRONTEND_ROOT / "scripts" / "design_system_probe.py"
    probe_tests = FRONTEND_ROOT / "tests" / "test_design_system_probe.py"
    assert probe.is_file()
    assert probe_tests.is_file()


def test_studio_version_domains_are_separate():
    plugin_path = REPO_ROOT / "plugin.json"
    package_path = REPO_ROOT / "package.json"
    codex_path = REPO_ROOT / ".codex-plugin" / "plugin.json"
    if not plugin_path.is_file() or not package_path.is_file() or not codex_path.is_file():
        pytest.skip("version-domain test requires the source repository")

    portable = json.loads(plugin_path.read_text())
    package = json.loads(package_path.read_text())
    codex = json.loads(codex_path.read_text())

    assert portable["name"] == "veteran-engineering-studio"
    assert codex["name"] == "veteran-engineer"
    assert package["name"] == "veteran-engineer"
    assert codex["version"] == package["version"]
    assert re.fullmatch(r"\d+\.\d+\.\d+", portable["version"])
