import hashlib
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "scripts" / "workspace_release_gate.py"
REVISION = "a" * 40
OTHER_REVISION = "b" * 40


def write_json(archive: zipfile.ZipFile, path: str, value: dict) -> None:
    archive.writestr(path, json.dumps(value))


def build_candidate(path: Path, *, version: str = "1.14.10", revision: str = REVISION, leak_runtime: bool = False):
    interface = {
        "displayName": "Veteran Engineering Studio",
        "shortDescription": "test",
    }
    plugin = {
        "name": "veteran-engineering-studio",
        "version": version,
        "extensions": {"com.openai": {"interface": interface}},
    }
    legacy = {
        "name": "veteran-engineering-studio",
        "version": version,
        "skills": "./skills",
        "interface": interface,
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
        archive.writestr(
            "skills/runtime-regression-debugger/agents/openai.yaml",
            'interface:\n  display_name: "Veteran Full Stack Engineer"\n',
        )
        archive.writestr("skills/frontend-design-builder/SKILL.md", "---\nname: frontend-design-builder\ndescription: test\n---\n")
        archive.writestr(
            "skills/frontend-design-builder/agents/openai.yaml",
            'interface:\n  display_name: "Veteran Frontend Design Builder"\n',
        )
        if leak_runtime:
            archive.writestr(".mcp.json", "{}")


def run_gate(archive: Path, *args: str, check: bool = True):
    return subprocess.run(
        [sys.executable, str(GATE), str(archive), *args],
        text=True,
        capture_output=True,
        check=check,
    )


def write_installed_state(
    path: Path,
    paths: list[str],
    *,
    version: str = "1.14.8",
    release_id: str = "pluginrel_current",
    inventory_complete: bool = True,
    page_size: int = 3,
    final_next_offset=None,
    mutate_pages=None,
):
    pages = []
    for offset in range(0, len(paths), page_size):
        page_paths = paths[offset : offset + page_size]
        is_last = offset + len(page_paths) >= len(paths)
        pages.append(
            {
                "offset": offset,
                "count": len(page_paths),
                "next_offset": final_next_offset if is_last else offset + len(page_paths),
                "paths": page_paths,
            }
        )
    if mutate_pages is not None:
        mutate_pages(pages)
    path.write_text(
        json.dumps(
            {
                "schema": "veteran-workspace-installed-state-v2",
                "plugin_id": "Plugin_8d9c7648269081918d366e3d9e9a43e2",
                "release_id": release_id,
                "version": version,
                "inventory_complete": inventory_complete,
                "path_count": len(paths),
                "pages": pages,
            }
        ),
        encoding="utf-8",
    )


def test_workspace_release_gate_accepts_exact_main_candidate(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--expected-version",
        "1.14.10",
        "--installed-version",
        "1.14.8",
        "--expected-sha256",
        digest,
        "--json",
    )
    report = json.loads(proc.stdout)

    assert report["safe_for_publication"] is True
    assert report["version"] == "1.14.10"
    assert report["source_revision"] == REVISION
    assert report["sha256"] == digest


def test_workspace_release_gate_rejects_wrong_source_revision(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive, revision=OTHER_REVISION)

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
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
        REVISION,
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
        REVISION,
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
        REVISION,
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
        REVISION,
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
        REVISION,
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
        REVISION,
        check=False,
    )

    assert proc.returncode != 0
    assert "unexpected top-level surfaces" in proc.stderr


def test_publication_mode_requires_fresh_installed_state_and_artifact_digest(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--publication",
        check=False,
    )

    assert proc.returncode != 0
    assert "--expected-sha256" in proc.stderr
    assert "--installed-state" in proc.stderr


def test_publication_mode_rejects_undeletable_overlay_omission(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    inventory = tmp_path / "installed.json"
    write_installed_state(
        inventory,
        [
            "plugin.json",
            ".codex-plugin/plugin.json",
            "veteran-distribution.json",
            "skills/runtime-regression-debugger/SKILL.md",
            "skills/runtime-regression-debugger/agents/openai.yaml",
            "skills/frontend-design-builder/SKILL.md",
            "skills/frontend-design-builder/agents/openai.yaml",
            "skills/runtime-regression-debugger/references/legacy-online-only.md",
        ],
        
    )
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--expected-version",
        "1.14.10",
        "--installed-version",
        "1.14.8",
        "--expected-sha256",
        digest,
        "--installed-state",
        str(inventory),
        "--publication",
        check=False,
    )

    assert proc.returncode != 0
    assert "overlay publication cannot delete" in proc.stderr
    assert "legacy-online-only.md" in proc.stderr


def test_publication_mode_accepts_inventory_preserved_by_candidate(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "r") as handle:
        paths = [item.filename for item in handle.infolist() if not item.is_dir()]
    inventory = tmp_path / "installed.json"
    write_installed_state(inventory, paths)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--expected-version",
        "1.14.10",
        "--installed-version",
        "1.14.8",
        "--expected-sha256",
        digest,
        "--installed-state",
        str(inventory),
        "--publication",
        "--json",
    )
    report = json.loads(proc.stdout)

    assert report["safe_for_publication"] is True
    assert report["publication_mode"] is True
    assert report["installed_inventory_checked"] is True
    assert report["expected_release_id"] == "pluginrel_current"
    assert report["installed_page_offsets"] == [0, 3, 6]


def test_publication_mode_rejects_incomplete_pagination_snapshot(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "r") as handle:
        paths = [item.filename for item in handle.infolist() if not item.is_dir()]
    state = tmp_path / "installed.json"
    write_installed_state(
        state,
        paths,
        inventory_complete=False,
        final_next_offset=None,
    )
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--expected-sha256",
        digest,
        "--installed-state",
        str(state),
        "--publication",
        check=False,
    )

    assert proc.returncode != 0
    assert "inventory_complete must be true" in proc.stderr


def test_publication_mode_rejects_nonterminal_next_offset(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "r") as handle:
        paths = [item.filename for item in handle.infolist() if not item.is_dir()]
    state = tmp_path / "installed.json"
    write_installed_state(
        state,
        paths,
        final_next_offset=999,
    )
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--expected-sha256",
        digest,
        "--installed-state",
        str(state),
        "--publication",
        check=False,
    )

    assert proc.returncode != 0
    assert "final page must have next_offset=null" in proc.stderr


def test_publication_mode_binds_version_to_same_installed_snapshot(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "r") as handle:
        paths = [item.filename for item in handle.infolist() if not item.is_dir()]
    state = tmp_path / "installed.json"
    write_installed_state(state, paths, version="1.14.7")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        "--installed-version",
        "1.14.8",
        "--expected-sha256",
        digest,
        "--installed-state",
        str(state),
        "--publication",
        check=False,
    )

    assert proc.returncode != 0
    assert "disagrees with installed-state snapshot" in proc.stderr


def test_workspace_release_gate_rejects_nested_mcp_manifest(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr("skills/runtime-regression-debugger/.mcp.json", "{}")

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        check=False,
    )

    assert proc.returncode != 0
    assert "leaks local runtime/MCP surfaces" in proc.stderr


def test_workspace_release_gate_rejects_runtime_starter_subtree(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr(
            "skills/runtime-regression-debugger/assets/plugin-runtime-starter/src/mcp-server.mjs",
            "export {}\n",
        )

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        check=False,
    )

    assert proc.returncode != 0
    assert "leaks local runtime/MCP surfaces" in proc.stderr


def test_workspace_release_gate_rejects_extra_codex_plugin_surface(tmp_path: Path):
    archive = tmp_path / "candidate.zip"
    build_candidate(archive)
    with zipfile.ZipFile(archive, "a") as handle:
        handle.writestr(".codex-plugin/extra.json", "{}")

    proc = run_gate(
        archive,
        "--expected-revision",
        REVISION,
        check=False,
    )

    assert proc.returncode != 0
    assert "unexpected .codex-plugin surfaces" in proc.stderr
