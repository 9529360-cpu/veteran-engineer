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
    assert plugin["author"]["name"] == interface["developerName"]
    assert "End-to-end full-stack engineering" in interface["shortDescription"]
    assert "primary owner" in interface["longDescription"]
    assert "bounded UI/frontend specialist" in interface["longDescription"]
    assert {"Read", "Write"}.issubset(set(interface["capabilities"]))

    skill_dirs = {
        child.name
        for child in SKILL_ROOT.parent.iterdir()
        if child.is_dir() and (child / "SKILL.md").is_file()
    }
    assert skill_dirs == {"runtime-regression-debugger", "frontend-design-builder"}

    runtime_text = (SKILL_ROOT / "SKILL.md").read_text()
    frontend_text = (FRONTEND_ROOT / "SKILL.md").read_text()
    runtime_fields = _frontmatter(runtime_text)
    frontend_fields = _frontmatter(frontend_text)
    assert "primary full-stack owner" in runtime_fields["description"]
    assert "whole-product or cross-layer outcomes" in runtime_fields["description"]
    assert "delegate a bounded UI/frontend phase" in runtime_fields["description"]
    assert "UI/frontend specialist for Veteran Engineering Studio" in frontend_fields["description"]
    assert "Do not take sole ownership of whole-repository outcomes" in frontend_fields["description"]

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
    assert 'display_name: "Veteran Frontend Design Builder"' in frontend_agent
    for agent_text in (runtime_agent, frontend_agent):
        for unsupported_product in ("chatgpt", "codex", "api", "atlas"):
            assert f"- {unsupported_product}" not in agent_text
    assert "policy:" not in runtime_agent
    assert "allow_implicit_invocation" not in runtime_agent
    assert "policy:" not in frontend_agent
    assert "allow_implicit_invocation" not in frontend_agent

    routing = json.loads((SKILL_ROOT / "evals" / "studio_routing_scenarios.json").read_text())
    assert routing["schema"] == "veteran-studio-routing-v1"
    routing_rows = routing["scenarios"]
    routing_ids = [row["id"] for row in routing_rows]
    assert len(routing_ids) == len(set(routing_ids)) >= 12
    assert {row["primary"] for row in routing_rows} == {
        None,
        "runtime-regression-debugger",
        "frontend-design-builder",
    }
    assert any(
        row["primary"] == "runtime-regression-debugger" and row["specialist"] == ["frontend-design-builder"]
        for row in routing_rows
    )
    for row in routing_rows:
        assert row["request"] and row["rationale"]
        assert row["specialist"] in ([], ["frontend-design-builder"])
        if row["primary"] == "frontend-design-builder":
            assert row["specialist"] == []

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
    assert (FRONTEND_ROOT / "scripts" / "design_action_router.py").is_file()
    assert (FRONTEND_ROOT / "tests" / "test_design_action_router.py").is_file()
    assert (FRONTEND_ROOT / "references" / "design-action-fabric.md").is_file()
    assert (FRONTEND_ROOT / "references" / "visual-design-authority.md").is_file()
    assert (FRONTEND_ROOT / "references" / "product-ui-pattern-library.md").is_file()
    assert "Deep implementation is blocked" in frontend_text
    assert "anti-generic" in frontend_text.lower()
    assert "generated images, Figma concepts, and standalone surrogate HTML" in frontend_text
    visual_authority = (FRONTEND_ROOT / "references" / "visual-design-authority.md").read_text()
    assert "First-render kill switch" in visual_authority
    assert "Skin-vs-redesign test" in visual_authority
    assert "operating model" in visual_authority
    assert "product-ui-pattern-library.md" in frontend_text
    testing_quality = (SKILL_ROOT / "references" / "testing-quality-patterns.md").read_text()
    assert "Test-code semantic self-check" in testing_quality
    assert r'`"\\n"` means a backslash followed by `n`' in testing_quality
    assert r'`"\n"` represents an actual newline at runtime' in testing_quality

    autonomous = (SKILL_ROOT / "references" / "autonomous-repository-engineering.md").read_text()
    assert "### Keep one mutation authority across hosts" in autonomous
    assert "active write authority" in autonomous
    assert "host-local uncommitted or unpushed work as provisional" in runtime_text
    assert "Do not publish a plugin, package, release, deployment, or completion claim from an unpushed/unreconciled machine tree" in autonomous
    assert "A state change alone does not identify the actor." in runtime_text
    attribution = (SKILL_ROOT / "references" / "action-attribution-and-state-change.md").read_text()
    assert "A changed state proves only that the state changed." in attribution
    assert "Never use \"I do not remember doing this\" as evidence that another actor did it." in attribution
    release_patterns = (SKILL_ROOT / "references" / "release-promotion-patterns.md").read_text()
    assert "PR-head artifact is a validation candidate, not a publishable release artifact" in release_patterns
    cross_host = (SKILL_ROOT / "references" / "cross-host-plugin-distribution.md").read_text()
    assert "Plugin updates overlay files and omission does not delete previously installed paths" in cross_host
    assert "scripts/workspace_overlay_deletion_gate.py" in cross_host
    assert "Do not rename or remove a published `skills/<name>/SKILL.md` in place" in cross_host
    benchmark_text = (SKILL_ROOT / "references" / "veteran-engineer-benchmark.md").read_text()
    assert "88. **Web and remote machine both mutate one repository**" in benchmark_text
    assert "89. **Self-initiated release is misattributed as another developer**" in benchmark_text

    skill_workflow_path = REPO_ROOT / ".github" / "workflows" / "skill-engineering-tools.yml"
    package_workflow_path = REPO_ROOT / ".github" / "workflows" / "package-plugin-artifact.yml"
    if skill_workflow_path.is_file() and package_workflow_path.is_file():
        workflow = skill_workflow_path.read_text()
        assert 'skills/runtime-regression-debugger/**' in workflow
        assert 'skills/frontend-design-builder/**' in workflow
        assert 'plugin.json' in workflow
        assert 'README.md' in workflow
        assert 'NEXT_CHAT_HANDOFF.md' in workflow

        package_workflow = package_workflow_path.read_text()
        main_install_guard = "matrix.profile == 'workspace' && github.ref == 'refs/heads/main' && github.event_name != 'pull_request'"
        assert package_workflow.count(main_install_guard) == 2
        assert "Stage workspace install artifact\n        if: matrix.profile == 'workspace'" in package_workflow
        assert "veteran-engineering-studio-workspace-install-${{ github.event.pull_request.head.sha || github.sha }}" in package_workflow
        assert "statuses: write" in package_workflow
        assert "veteran/workspace-install" in package_workflow
        assert 'description="artifact_id=$ARTIFACT_ID"' in package_workflow
        assert "references/action-attribution-and-state-change.md" in package_workflow
        assert "references/design-action-recovery.md" in package_workflow
        assert "references/design-session-ledger.md" in package_workflow

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


def test_studio_docs_do_not_reintroduce_retired_invocation_policy_or_tool_count():
    readme_path = REPO_ROOT / "README.md"
    starter_readme_path = SKILL_ROOT / "assets" / "plugin-runtime-starter" / "README.md"
    handoff_path = REPO_ROOT / "NEXT_CHAT_HANDOFF.md"
    starter_handoff_path = SKILL_ROOT / "assets" / "plugin-runtime-starter" / "NEXT_CHAT_HANDOFF.md"
    if not all(path.is_file() for path in (readme_path, starter_readme_path, handoff_path, starter_handoff_path)):
        pytest.skip("repository-only documentation parity gate is unavailable in exported Skill packages")

    readme = readme_path.read_text()
    starter_readme = starter_readme_path.read_text()
    handoff = handoff_path.read_text()
    starter_handoff = starter_handoff_path.read_text()

    assert readme == starter_readme
    assert handoff == starter_handoff
    for text in (readme, handoff):
        assert "34-tool" not in text
        assert "remains 34 tools" not in text
        assert "implicit-invocation policy" not in text
    assert "exact **36-tool** surface" in readme
    assert "exactly **36 tools**" in handoff
    assert "Do not reintroduce unsupported ChatGPT/Codex/API/Atlas product-policy values" in readme
