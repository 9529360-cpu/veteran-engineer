import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "frontend_style_fingerprint.py"


def run(root: Path):
    proc = subprocess.run(
        [sys.executable, str(SCRIPT), str(root), "--json"],
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(proc.stdout)


def test_detects_tailwind_css_modules_tokens_and_review_signals_without_calling_them_violations():
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        (repo / "src").mkdir()
        (repo / "package.json").write_text(json.dumps({
            "dependencies": {
                "react": "^19.0.0",
                "tailwindcss": "^4.0.0",
                "class-variance-authority": "^1.0.0",
            }
        }))
        (repo / "tailwind.config.ts").write_text("export default { theme: { extend: {} } }\n")
        (repo / "src" / "Card.tsx").write_text(
            'export const Card = () => <div className="p-[13px]" style={{width: 12}}>x</div>;\n'
        )
        (repo / "src" / "Card.module.css").write_text(
            ":root { --text-primary: #111; }\n.card { color: var(--text-primary); padding: 12px !important; z-index: 9; }\n"
        )

        payload = run(repo)
        systems = {item["name"] for item in payload["detected_systems"]}
        assert "tailwind" in systems
        assert "utility-composition" in systems
        assert "css-modules" in systems
        assert "css-custom-properties" in systems
        assert "tailwind.config.ts" in payload["authoritative_candidates"]
        assert "src/Card.module.css" in payload["authoritative_candidates"]
        review = {item["kind"]: item["count"] for item in payload["review_signals"]}
        assert review["inline_style_objects"] == 1
        assert review["important_rules"] == 1
        assert review["numeric_z_index_rules"] == 1
        assert "not style violations" in payload["note"]


def test_scan_is_bounded_and_ignores_node_modules():
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        (repo / "node_modules" / "x").mkdir(parents=True)
        (repo / "node_modules" / "x" / "ignored.css").write_text(".x{color:#fff}")
        (repo / "src").mkdir()
        (repo / "src" / "a.css").write_text(".a{padding:8px}")
        payload = run(repo)
        assert payload["scan"]["files_seen"] == 1
        assert payload["source_counts"]["style_files"] == 1
        assert all("node_modules" not in path for paths in payload["source_samples"].values() for path in paths)
