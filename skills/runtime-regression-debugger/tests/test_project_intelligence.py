import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SURFACE_MAP = ROOT / "scripts" / "repo_surface_map.py"


def test_repo_surface_map_json_is_privacy_safe_project_intelligence_seed(tmp_path):
    (tmp_path / "package.json").write_text(
        json.dumps(
            {
                "name": "fixture-app",
                "version": "1.0.0",
                "dependencies": {"react": "^19.0.0", "express": "^5.0.0", "pg": "^8.0.0"},
                "scripts": {"dev": "vite", "test": "vitest", "deploy": "echo deploy"},
            }
        ),
        encoding="utf-8",
    )
    (tmp_path / "AGENTS.md").write_text("maintainer guidance", encoding="utf-8")
    (tmp_path / ".env").write_text("SUPER_SECRET=do-not-read", encoding="utf-8")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "secret.ts").write_text("const hidden = 'arbitrary-source-secret';", encoding="utf-8")
    (tmp_path / ".github" / "workflows").mkdir(parents=True)
    (tmp_path / ".github" / "workflows" / "release.yml").write_text("name: release", encoding="utf-8")

    proc = subprocess.run(
        [sys.executable, str(SURFACE_MAP), str(tmp_path), "--json"],
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(proc.stdout)
    dumped = json.dumps(payload)
    assert payload["schema"] == "veteran-repository-surface-map-v2"
    assert payload["package_json_hints"][0]["info"]["name"] == "fixture-app"
    assert "AGENTS.md" in payload["repository_instructions"]
    assert ".github/workflows/release.yml" in payload["ci_workflows"]
    assert "do-not-read" not in dumped
    assert "arbitrary-source-secret" not in dumped
    assert "Seed evidence only" in payload["note"]


def test_project_intelligence_guidance_is_refreshable_cache_not_authority():
    text = (ROOT / "references" / "project-takeover-engineering.md").read_text(encoding="utf-8")
    assert "## Maintain a compact Project Intelligence Snapshot" in text
    assert "cache over current evidence" in text
    assert "repo_surface_map.py <repo> --json" in text
    assert "Refresh only the slices invalidated" in text
