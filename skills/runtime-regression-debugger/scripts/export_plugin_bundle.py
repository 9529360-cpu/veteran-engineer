#!/usr/bin/env python3
"""Export Veteran Engineer for a specific OpenAI product surface.

Profiles:
  desktop  - Skill + local runtime + .mcp.json (Desktop-only by platform rules)
  codex    - Skill + local runtime + .mcp.json for Codex/local plugin use
  web      - Skill-first plugin with no local MCP manifest. Optionally reference an
             already-approved app by supplying a complete .app.json via --app-manifest.

The web exporter intentionally does not invent app IDs, OAuth configuration, remote MCP
URLs, or Secure MCP Tunnel provisioning. Those remain workspace/app configuration.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import tempfile
import zipfile

SKIP_NAMES = {"__pycache__", ".DS_Store", "node_modules", ".git"}
LOCAL_PROFILES = {"desktop", "codex"}
ALL_PROFILES = LOCAL_PROFILES | {"web"}


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


def load_json(path: pathlib.Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: pathlib.Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def build_distribution_metadata(profile: str, *, app_reference: bool) -> dict:
    if profile in LOCAL_PROFILES:
        return {
            "schemaVersion": 1,
            "product": "veteran-engineer",
            "profile": profile,
            "surfaceProfile": "local-stdio",
            "includes": {"skill": True, "runtime": True, "mcpManifest": True, "appReference": False},
            "platformNotes": {
                "webCompatible": False,
                "reason": "Local MCP manifests make imported plugins Desktop-only on ChatGPT web."
            }
        }
    return {
        "schemaVersion": 1,
        "product": "veteran-engineer",
        "profile": "web",
        "surfaceProfile": None,
        "includes": {"skill": True, "runtime": False, "mcpManifest": False, "appReference": app_reference},
        "platformNotes": {
            "webCompatible": True,
            "actions": "external-app" if app_reference else "skill-only",
            "runtimeTopology": "Use an approved remote MCP app or Secure MCP Tunnel; do not embed .mcp.json in this artifact."
        }
    }


def bundle_skill(skill_root: pathlib.Path, plugin_root: pathlib.Path) -> None:
    skills_dir = plugin_root / "skills"
    if skills_dir.exists():
        shutil.rmtree(skills_dir)
    bundled_skill = skills_dir / "runtime-regression-debugger"
    bundled_skill.mkdir(parents=True, exist_ok=True)
    copy_filtered(skill_root, bundled_skill, exclude_runtime_asset=True)


def build_local_profile(skill_root: pathlib.Path, runtime: pathlib.Path, plugin_root: pathlib.Path, profile: str) -> None:
    copy_filtered(runtime, plugin_root)
    bundle_skill(skill_root, plugin_root)
    write_json(plugin_root / "veteran-distribution.json", build_distribution_metadata(profile, app_reference=False))


def build_web_profile(skill_root: pathlib.Path, runtime: pathlib.Path, plugin_root: pathlib.Path, app_manifest: pathlib.Path | None) -> None:
    manifest = load_json(runtime / ".codex-plugin" / "plugin.json")
    manifest.pop("mcpServers", None)
    manifest["skills"] = "./skills/"
    if app_manifest is not None:
        if not app_manifest.is_file():
            raise RuntimeError(f"app manifest does not exist: {app_manifest}")
        # The app manifest is caller/workspace supplied. Treat it as opaque platform
        # configuration instead of guessing a schema that can change independently.
        shutil.copy2(app_manifest, plugin_root / ".app.json")
        manifest["apps"] = "./.app.json"
    else:
        manifest.pop("apps", None)
    write_json(plugin_root / ".codex-plugin" / "plugin.json", manifest)
    bundle_skill(skill_root, plugin_root)
    write_json(plugin_root / "veteran-distribution.json", build_distribution_metadata("web", app_reference=app_manifest is not None))


def validate_export(root: pathlib.Path, profile: str) -> None:
    skill = root / "skills" / "runtime-regression-debugger" / "SKILL.md"
    manifest_path = root / ".codex-plugin" / "plugin.json"
    required = [skill, manifest_path, root / "veteran-distribution.json"]
    missing = [str(p.relative_to(root)) for p in required if not p.is_file()]
    if missing:
        raise RuntimeError("plugin export missing required files: " + ", ".join(missing))

    manifest = load_json(manifest_path)
    if manifest.get("name") != "veteran-engineer":
        raise RuntimeError("plugin manifest name must remain veteran-engineer")
    if manifest.get("skills") != "./skills/":
        raise RuntimeError("plugin manifest must point to bundled skills")

    metadata = load_json(root / "veteran-distribution.json")
    if metadata.get("profile") != profile:
        raise RuntimeError("distribution profile metadata mismatch")

    if profile in LOCAL_PROFILES:
        local_required = [
            root / ".mcp.json",
            root / "mcp" / "server.mjs",
            root / "src" / "mcp-server.mjs",
            root / "src" / "worker-orchestrator.mjs",
            root / "src" / "worker-adapter.mjs",
            root / "src" / "worktree-manager.mjs",
            root / "tests" / "worker-execution.test.mjs",
        ]
        local_missing = [str(p.relative_to(root)) for p in local_required if not p.is_file()]
        if local_missing:
            raise RuntimeError("local plugin export missing runtime files: " + ", ".join(local_missing))
        if manifest.get("mcpServers") != "./.mcp.json":
            raise RuntimeError("local plugin manifest must point to bundled MCP config")
        package = load_json(root / "package.json")
        if manifest.get("version") != package.get("version"):
            raise RuntimeError("plugin manifest and runtime package versions must match")
        mcp = load_json(root / ".mcp.json")
        if "veteran-engineer" not in mcp.get("mcpServers", {}):
            raise RuntimeError(".mcp.json must declare veteran-engineer")
    else:
        forbidden = [root / ".mcp.json", root / "mcp" / "server.mjs", root / "src" / "mcp-server.mjs"]
        present = [str(p.relative_to(root)) for p in forbidden if p.exists()]
        if present:
            raise RuntimeError("web plugin must not embed local MCP/runtime surfaces: " + ", ".join(present))
        if "mcpServers" in manifest:
            raise RuntimeError("web plugin manifest must not declare mcpServers")
        app_path = root / ".app.json"
        if app_path.exists() and manifest.get("apps") != "./.app.json":
            raise RuntimeError("web app reference must be declared through ./.app.json")
        if not app_path.exists() and "apps" in manifest:
            raise RuntimeError("web plugin manifest references an app but .app.json is missing")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("skill_root")
    parser.add_argument("--output", default="veteran-engineer-plugin.zip")
    parser.add_argument("--profile", choices=sorted(ALL_PROFILES), default="desktop")
    parser.add_argument("--app-manifest", help="Complete caller-supplied .app.json to reference from the web profile")
    args = parser.parse_args()

    skill_root = pathlib.Path(args.skill_root).expanduser().resolve()
    runtime = skill_root / "assets" / "plugin-runtime-starter"
    if not (skill_root / "SKILL.md").is_file():
        raise RuntimeError(f"not a skill root: {skill_root}")
    if not runtime.is_dir():
        raise RuntimeError(f"plugin runtime starter missing: {runtime}")
    if args.app_manifest and args.profile != "web":
        raise RuntimeError("--app-manifest is only valid with --profile web")

    app_manifest = pathlib.Path(args.app_manifest).expanduser().resolve() if args.app_manifest else None
    output = pathlib.Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="veteran-engineer-plugin-") as temp_name:
        temp = pathlib.Path(temp_name)
        plugin_root = temp / "veteran-engineer"
        plugin_root.mkdir(parents=True, exist_ok=True)
        if args.profile in LOCAL_PROFILES:
            build_local_profile(skill_root, runtime, plugin_root, args.profile)
        else:
            build_web_profile(skill_root, runtime, plugin_root, app_manifest)
        validate_export(plugin_root, args.profile)

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
