#!/usr/bin/env python3
"""Export the current Skill plus the bundled MCP runtime as one plugin ZIP.

Usage:
  export_plugin_bundle.py <skill-root> [--output /path/to/veteran-engineer-plugin.zip]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import tempfile
import zipfile

SKIP_NAMES = {"__pycache__", ".DS_Store", "node_modules", ".git"}


def copy_filtered(src: pathlib.Path, dst: pathlib.Path, *, exclude_runtime_asset: bool = False) -> None:
    src = src.resolve()
    for path in src.rglob("*"):
        rel = path.relative_to(src)
        if any(part in SKIP_NAMES for part in rel.parts):
            continue
        if path.suffix == ".pyc":
            continue
        if exclude_runtime_asset and rel.parts[:2] == ("assets", "plugin-runtime-starter"):
            continue
        target = dst / rel
        if path.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif path.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)


def validate_export(root: pathlib.Path) -> None:
    required = [
        root / ".codex-plugin" / "plugin.json",
        root / ".mcp.json",
        root / "mcp" / "server.mjs",
        root / "src" / "mcp-server.mjs",
        root / "src" / "worker-orchestrator.mjs",
        root / "src" / "worker-adapter.mjs",
        root / "src" / "worktree-manager.mjs",
        root / "tests" / "worker-execution.test.mjs",
        root / "skills" / "runtime-regression-debugger" / "SKILL.md",
    ]
    missing = [str(p.relative_to(root)) for p in required if not p.is_file()]
    if missing:
        raise RuntimeError("plugin export missing required files: " + ", ".join(missing))
    manifest = json.loads((root / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    if manifest.get("name") != "veteran-engineer":
        raise RuntimeError("plugin manifest name must remain veteran-engineer")
    if manifest.get("skills") != "./skills/" or manifest.get("mcpServers") != "./.mcp.json":
        raise RuntimeError("plugin manifest must point to bundled skills and MCP config")
    package = json.loads((root / "package.json").read_text(encoding="utf-8"))
    if manifest.get("version") != package.get("version"):
        raise RuntimeError("plugin manifest and runtime package versions must match")
    mcp = json.loads((root / ".mcp.json").read_text(encoding="utf-8"))
    if "veteran-engineer" not in mcp.get("mcpServers", {}):
        raise RuntimeError(".mcp.json must declare veteran-engineer")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_root")
    parser.add_argument("--output", default="veteran-engineer-plugin.zip")
    args = parser.parse_args()

    skill_root = pathlib.Path(args.skill_root).expanduser().resolve()
    runtime = skill_root / "assets" / "plugin-runtime-starter"
    if not (skill_root / "SKILL.md").is_file():
        raise RuntimeError(f"not a skill root: {skill_root}")
    if not runtime.is_dir():
        raise RuntimeError(f"plugin runtime starter missing: {runtime}")

    output = pathlib.Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="veteran-engineer-plugin-") as temp_name:
        temp = pathlib.Path(temp_name)
        plugin_root = temp / "veteran-engineer"
        copy_filtered(runtime, plugin_root)
        skills_dir = plugin_root / "skills"
        if skills_dir.exists():
            shutil.rmtree(skills_dir)
        bundled_skill = skills_dir / "runtime-regression-debugger"
        bundled_skill.mkdir(parents=True, exist_ok=True)
        copy_filtered(skill_root, bundled_skill, exclude_runtime_asset=True)
        validate_export(plugin_root)

        if output.exists():
            output.unlink()
        with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
            for path in sorted(plugin_root.rglob("*")):
                if path.is_file():
                    zf.write(path, pathlib.Path("veteran-engineer") / path.relative_to(plugin_root))

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
