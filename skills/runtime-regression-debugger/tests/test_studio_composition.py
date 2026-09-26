import json
import re
import subprocess
import sys
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
    assert (FRONTEND_ROOT / "references" / "design-action-recovery.md").is_file()
    assert (FRONTEND_ROOT / "references" / "design-session-ledger.md").is_file()
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

    distribution_contract = (SKILL_ROOT / "references" / "cross-host-plugin-distribution.md").read_text()
    assert "Publish only the `workspace-install` artifact generated by a `push` on `refs/heads/main`" in distribution_contract
    assert "trusted exact-head workflow identities for CI, Skill Engineering, and Cross-platform host smoke" in distribution_contract
    assert "do not retry by merely substituting the newer release ID" in distribution_contract
    assert "Workspace updates are overlays" in distribution_contract
    assert "scripts/workspace_release_gate.py --publication" in distribution_contract
    assert "installed plugin version/release and full source inventory" in distribution_contract
    assert "immutable GitHub artifact SHA-256 digest" in distribution_contract
    assert "overlay updates cannot delete it" in distribution_contract
    assert (SKILL_ROOT / "scripts" / "workspace_release_gate.py").is_file()
    assert (SKILL_ROOT / "tests" / "test_workspace_release_gate.py").is_file()
    workspace_gate = (SKILL_ROOT / "scripts" / "workspace_release_gate.py").read_text()
    assert "--publication" in workspace_gate
    assert "--installed-inventory" in workspace_gate
    assert "overlay publication cannot delete" in workspace_gate

    autonomous = (SKILL_ROOT / "references" / "autonomous-repository-engineering.md").read_text()
    assert "### Keep one mutation authority across hosts" in autonomous
    assert "### Separate mutation provenance from executor attribution" in autonomous
    assert "active write authority" in autonomous
    assert "State change proves that state changed" in runtime_text
    assert "does **not** prove which human, model, chat session, or host caused it" in runtime_text
    assert "GitHub actor, commit author/committer, workflow triggering actor" in runtime_text
    assert "host-local uncommitted or unpushed work as provisional" in runtime_text
    assert "Do not publish a plugin, package, release, deployment, or completion claim from an unpushed/unreconciled machine tree" in autonomous
    assert "Live current-execution tool return" in autonomous
    assert "Platform-bound causal descendant" in autonomous
    assert "Historical mission receipt" in autonomous
    assert "Account/principal evidence" in autonomous
    assert "replayable claim, not session identity proof" in autonomous
    assert "mutation-receipt" in autonomous

    batch = (SKILL_ROOT / "references" / "batch-mission-orchestration.md").read_text()
    assert "If another actor entered the planned write set" not in batch
    assert "Attribute that change to another actor only when positive executor provenance supports the claim" in batch

    distribution_contract = (SKILL_ROOT / "references" / "cross-host-plugin-distribution.md").read_text()
    assert "A conflict proves only that the release state changed since the bound read" in distribution_contract
    assert "it does not prove a different human, model, session, or host performed the change" in distribution_contract

    release_patterns = (SKILL_ROOT / "references" / "release-promotion-patterns.md").read_text()
    assert "Treat the initiator as unknown until a live current-execution tool return" in release_patterns
    assert "persisted journal receipt is only a historical mission claim" in release_patterns
    assert "journal entry alone does not prove another actor/session caused it" in release_patterns

    journal = (SKILL_ROOT / "scripts" / "engineering_journal.py").read_text()
    assert 'sub.add_parser("mutation-receipt")' in journal
    assert '"mutation_receipts"' in journal
    assert '"tool-return", "platform-binding", "manual-observation"' in journal
    assert "mutation receipt result identity already recorded" in journal
    assert "historical-mission-record" in journal
    assert "requires_live_revalidation_for_session_attribution" in journal

    eval_rows = json.loads((SKILL_ROOT / "evals" / "evals.json").read_text())
    eval_names = {row["name"] for row in eval_rows}
    assert {
        "same-execution-delayed-release-is-not-another-ai",
        "release-conflict-does-not-prove-foreign-executor",
        "account-identity-is-not-session-identity",
        "positive-session-provenance-allows-attribution",
    }.issubset(eval_names)

    benchmark_text = (SKILL_ROOT / "references" / "veteran-engineer-benchmark.md").read_text()
    assert "88. **Web and remote machine both mutate one repository**" in benchmark_text
    assert "89. **Own delayed side effect looks foreign**" in benchmark_text
    assert "90. **Release conflict with ambiguous initiator**" in benchmark_text
    assert "91. **Explicit executor provenance resolves attribution**" in benchmark_text

    assert "refs/heads/main" in exporter
    assert "never publish pull-request artifacts" in exporter

    # Repository-only release/CI documentation is intentionally excluded from
    # Workspace Skill bundles. Validate those contracts when running from the
    # source repository, but keep the packaged Skill test suite self-contained.
    workflow_path = REPO_ROOT / ".github" / "workflows" / "skill-engineering-tools.yml"
    if workflow_path.is_file():
        workflow = workflow_path.read_text()
        assert 'skills/runtime-regression-debugger/**' in workflow
        assert 'skills/frontend-design-builder/**' in workflow
        assert 'plugin.json' in workflow
        assert "Require Studio version bump for packaged Skill changes" in workflow
        assert "Studio package changed without a strict version increase" in workflow
        assert "github.event.pull_request.base.sha || github.event.before" in workflow

        package_workflow = (REPO_ROOT / ".github" / "workflows" / "package-plugin-artifact.yml").read_text()
        publishable_install = (
            "matrix.profile == 'workspace' && github.event_name == 'push' "
            "&& github.ref == 'refs/heads/main' && steps.studio-delta.outputs.changed == 'true'"
        )
        assert package_workflow.count(publishable_install) == 4
        assert "github.event_name != 'pull_request'" not in package_workflow
        assert "Detect publishable Studio delta" in package_workflow
        assert "Require exact-main validation workflows" in package_workflow
        assert "356929464: \"CI\"" in package_workflow
        assert "358643055: \"Skill Engineering Tools\"" in package_workflow
        assert "358628814: \"Cross-platform host smoke\"" in package_workflow
        assert "actions: read" in package_workflow
        assert "Gate staged Workspace publication candidate" in package_workflow
        assert "workspace_release_gate.py" in package_workflow
        assert '--expected-revision "$GITHUB_SHA"' in package_workflow
        assert '--expected-revision "$SOURCE_REVISION"' not in package_workflow.split("Gate staged Workspace publication candidate", 1)[1]
        assert "Run packaged Workspace Skill regressions" in package_workflow
        assert "workspace-package-test/veteran-engineer/skills/frontend-design-builder/tests" in package_workflow
        assert "workflow_dispatch" in package_workflow
        assert "github.event_name == 'push'" in package_workflow
        assert "ref: ${{ github.event.pull_request.head.sha || github.sha }}" in package_workflow
        assert 'declares unsupported invocation policy metadata' in package_workflow
        assert "design-action-recovery.md" in package_workflow
        assert "design-session-ledger.md" in package_workflow
        for tombstone_path in (
            "evals/benchmark_scenarios.json",
            "references/host-capability-adaptation.md",
            "references/long-running-engineering-execution.md",
            "references/repository-engineering-execution.md",
            "tests/test_skill_workflow.py",
        ):
            assert tombstone_path in package_workflow

        release_workflow = (REPO_ROOT / ".github" / "workflows" / "release.yml").read_text()
        assert '- "plugin.json"' in release_workflow
        assert '- "skills/frontend-design-builder/**"' in release_workflow

        cross_platform_workflow = (REPO_ROOT / ".github" / "workflows" / "cross-platform-host-smoke.yml").read_text()
        assert "push:\n    branches:\n      - main" in cross_platform_workflow

        workflow_texts = {
            name: (REPO_ROOT / ".github" / "workflows" / name).read_text()
            for name in (
                "ci.yml",
                "release.yml",
                "skill-engineering-tools.yml",
                "cross-platform-host-smoke.yml",
                "package-plugin-artifact.yml",
            )
        }
        immutable_action_pattern = re.compile(r"uses:\s+actions/[A-Za-z0-9_.-]+@[0-9a-f]{40}(?:\s+#\s+v\d+)?")
        floating_action_pattern = re.compile(r"uses:\s+actions/[A-Za-z0-9_.-]+@v\d+\b")
        trusted_action_pins = {
            "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
            "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
            "actions/setup-python": "ece7cb06caefa5fff74198d8649806c4678c61a1",
            "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
        }
        for name, workflow_text in workflow_texts.items():
            assert not floating_action_pattern.search(workflow_text), f"{name} uses a floating GitHub Action tag"
            for line in workflow_text.splitlines():
                if "uses: actions/" not in line:
                    continue
                assert immutable_action_pattern.search(line), f"{name} action is not commit-pinned: {line}"
                action_ref = line.strip().split()[1]
                action_name, action_sha = action_ref.split("@", 1)
                assert trusted_action_pins.get(action_name) == action_sha, (
                    f"{name} action pin is outside the trusted set: {action_ref}"
                )
        assert "pytest==9.1.1" in workflow_texts["skill-engineering-tools.yml"]
        assert "pytest==9.1.1" in workflow_texts["package-plugin-artifact.yml"]
        assert "node@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293" in workflow_texts["ci.yml"]
        assert "postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea" in workflow_texts["ci.yml"]
        assert "docker pull node:20-alpine" not in workflow_texts["ci.yml"]
        assert "docker pull postgres:16-alpine" not in workflow_texts["ci.yml"]
        assert "pip install --disable-pip-version-check pytest\n" not in workflow_texts["skill-engineering-tools.yml"]
        assert "pip install --disable-pip-version-check pytest\n" not in workflow_texts["package-plugin-artifact.yml"]

        readme = (REPO_ROOT / "README.md").read_text()
        assert "implicit-invocation policy" not in readme
        assert "exact **34-tool** surface" not in readme
        assert "public MCP surface remains 34 tools" not in readme
        assert "exact **36-tool** surface" in readme

    tombstone_marker = "<!-- veteran-overlay-tombstone -->"
    tombstone_refs = {
        "host-capability-adaptation.md",
        "long-running-engineering-execution.md",
        "repository-engineering-execution.md",
    }
    for name in tombstone_refs:
        text = (SKILL_ROOT / "references" / name).read_text()
        assert tombstone_marker in text
        assert "Do not route to or load" in text

    retired_eval = json.loads((SKILL_ROOT / "evals" / "benchmark_scenarios.json").read_text())
    assert retired_eval["retired"] is True
    assert retired_eval["scenarios"] == []

    retired_test = (SKILL_ROOT / "tests" / "test_skill_workflow.py").read_text()
    assert "contains no tests" in retired_test
    assert "def test_" not in retired_test

    owner_audit = subprocess.run(
        [sys.executable, str(SKILL_ROOT / "scripts" / "reference_owner_audit.py"), str(SKILL_ROOT), "--json", "--strict"],
        text=True,
        capture_output=True,
        check=True,
    )
    owner_payload = json.loads(owner_audit.stdout)
    assert set(owner_payload["overlay_tombstones"]) == tombstone_refs
    assert owner_payload["active_reference_count"] + len(tombstone_refs) == owner_payload["reference_count"]

    orphan_audit = subprocess.run(
        [sys.executable, str(SKILL_ROOT / "scripts" / "orphan_reference_gate.py"), str(SKILL_ROOT), "--json"],
        text=True,
        capture_output=True,
        check=True,
    )
    orphan_payload = json.loads(orphan_audit.stdout)
    assert set(orphan_payload["overlay_tombstones"]) == tombstone_refs
    assert orphan_payload["orphaned"] == []

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
