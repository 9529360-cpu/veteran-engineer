#!/usr/bin/env python3
"""Export the current Skill plus the bundled MCP runtime as one plugin ZIP.

The archive is intentionally deterministic: filesystem mtimes and checkout umasks do
not affect the emitted bytes. Symlinks are rejected instead of followed so the
bundle cannot escape the declared Skill/runtime source trees.

Usage:
  export_plugin_bundle.py <skill-root> [--output /path/to/veteran-engineer-plugin.zip]
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import stat
import tempfile
import zipfile

SKIP_NAMES = {"__pycache__", ".DS_Store", "node_modules", ".git"}
ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def copy_filtered(src: pathlib.Path, dst: pathlib.Path, *, exclude_runtime_asset: bool = False) -> None:
    src = src.resolve()
    for source in src.rglob("*"):
        rel = source.relative_to(src)
        if any(part in SKIP_NAMES for part in rel.parts):
            continue
        if source.suffix == ".pyc":
            continue
        if exclude_runtime_asset and rel.parts[:2] == ("assets", "plugin-runtime-starter"):
            continue
        if source.is_symlink():
            raise RuntimeError(f"plugin export refuses symbolic link: {rel.as_posix()}")

        target = dst / rel
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        elif source.is_file():
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)


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
        root / "skills" / "runtime-regression-debugger" / "agents" / "openai.yaml",
    ]
    missing = [str(path.relative_to(root)) for path in required if not path.is_file()]
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


def normalized_archive_mode(path: pathlib.Path) -> int:
    source_mode = path.stat().st_mode
    permissions = 0o755 if source_mode & 0o111 else 0o644
    return stat.S_IFREG | permissions


def write_deterministic_archive(plugin_root: pathlib.Path, output: pathlib.Path) -> None:
    if output.exists():
        output.unlink()

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for source in sorted(plugin_root.rglob("*"), key=lambda item: item.relative_to(plugin_root).as_posix()):
            if source.is_symlink():
                raise RuntimeError(
                    "plugin export refuses symbolic link in staged bundle: "
                    + source.relative_to(plugin_root).as_posix()
                )
            if not source.is_file():
                continue

            relative = source.relative_to(plugin_root)
            archive_name = (pathlib.PurePosixPath("veteran-engineer") / pathlib.PurePosixPath(relative.as_posix())).as_posix()
            info = zipfile.ZipInfo(archive_name, date_time=ZIP_TIMESTAMP)
            info.create_system = 3
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = normalized_archive_mode(source) << 16
            info.flag_bits |= 0x800
            archive.writestr(
                info,
                source.read_bytes(),
                compress_type=zipfile.ZIP_DEFLATED,
                compresslevel=9,
            )


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
        write_deterministic_archive(plugin_root, output)

    print(output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
