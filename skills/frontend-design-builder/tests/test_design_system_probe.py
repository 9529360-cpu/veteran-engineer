import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from design_system_probe import probe  # noqa: E402


def test_probe_discovers_design_system_stack_and_emits_routing_signals(tmp_path: Path):
    package = {
        "dependencies": {
            "react": "19.0.0",
            "@mui/material": "7.0.0",
            "tailwindcss": "4.0.0",
            "@figma/code-connect": "1.4.0",
            "@storybook/react": "9.0.0",
        }
    }
    (tmp_path / "package.json").write_text(json.dumps(package), encoding="utf-8")
    (tmp_path / "pnpm-lock.yaml").write_text("lockfileVersion: '9'\n", encoding="utf-8")
    (tmp_path / "components.json").write_text("{}\n", encoding="utf-8")
    (tmp_path / ".storybook").mkdir()
    (tmp_path / ".storybook" / "main.ts").write_text("export default {}\n", encoding="utf-8")
    (tmp_path / "src" / "components").mkdir(parents=True)
    (tmp_path / "src" / "styles").mkdir(parents=True)
    (tmp_path / "src" / "styles" / "tokens.css").write_text(":root { --space-1: 4px; }\n", encoding="utf-8")

    result = probe(tmp_path)
    assert result["package_manager"] == "pnpm"
    assert {x["name"] for x in result["packages"]["frameworks"]} == {"React"}
    assert {x["name"] for x in result["packages"]["ui_libraries"]} == {"MUI", "shadcn/ui"}
    assert {x["name"] for x in result["packages"]["design_tools"]} == {"Figma Code Connect"}
    assert {x["name"] for x in result["packages"]["component_lab"]} == {"Storybook"}
    assert "src/components" in result["component_dirs"]
    assert "src/styles/tokens.css" in result["token_theme_files"]
    assert "src/styles/tokens.css" in result["css_variable_sources"]
    assert result["routing_signals"] == [
        "existing-system", "design-system", "figma", "code-connect", "storybook", "component-lab", "design-system-sync"
    ]


def test_probe_skips_vendor_and_generated_trees(tmp_path: Path):
    (tmp_path / "package.json").write_text("{}\n", encoding="utf-8")
    (tmp_path / "node_modules" / "pkg").mkdir(parents=True)
    (tmp_path / "node_modules" / "pkg" / "theme.css").write_text(":root { --fake: 1; }\n", encoding="utf-8")
    (tmp_path / "dist").mkdir()
    (tmp_path / "dist" / "tokens.json").write_text("{}\n", encoding="utf-8")
    result = probe(tmp_path)
    assert all("node_modules" not in path for path in result["token_theme_files"])
    assert all(not path.startswith("dist/") for path in result["token_theme_files"])


def test_probe_reports_malformed_package_without_crashing(tmp_path: Path):
    (tmp_path / "package.json").write_text("{not-json", encoding="utf-8")
    (tmp_path / "components").mkdir()
    result = probe(tmp_path)
    assert result["errors"]
    assert result["component_dirs"] == ["components"]
    assert result["routing_signals"] == ["existing-system", "design-system"]


def test_probe_caps_walk(tmp_path: Path):
    for i in range(10):
        (tmp_path / f"file-{i}.txt").write_text("x", encoding="utf-8")
    result = probe(tmp_path, max_files=3)
    assert result["files_scanned"] == 3
    assert result["scan_truncated"] is True
