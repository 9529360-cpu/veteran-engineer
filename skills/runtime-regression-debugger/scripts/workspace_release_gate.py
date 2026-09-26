#!/usr/bin/env python3
"""Fail-closed validation for a Workspace Studio publication archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import stat
import zipfile


PLUGIN_NAME = "veteran-engineering-studio"
REQUIRED_PATHS = {
    "plugin.json",
    ".codex-plugin/plugin.json",
    "veteran-distribution.json",
    "skills/runtime-regression-debugger/SKILL.md",
    "skills/runtime-regression-debugger/agents/openai.yaml",
    "skills/frontend-design-builder/SKILL.md",
    "skills/frontend-design-builder/agents/openai.yaml",
}
ALLOWED_TOP_LEVEL = {"plugin.json", "veteran-distribution.json", ".codex-plugin", "skills"}
EXPECTED_SKILL_ENTRYPOINTS = {
    "skills/runtime-regression-debugger/SKILL.md",
    "skills/frontend-design-builder/SKILL.md",
}
FORBIDDEN_PATHS = {
    ".mcp.json",
    "mcp.json",
    ".app.json",
    "mcp/server.mjs",
    "src/mcp-server.mjs",
}
HEX_REVISION = re.compile(r"^[0-9a-fA-F]{7,64}$")
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def load_json(archive: zipfile.ZipFile, path: str) -> dict:
    try:
        value = json.loads(archive.read(path).decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing JSON file: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON file must contain an object: {path}")
    return value


def parse_semver(value: object, label: str) -> tuple[int, int, int]:
    if not isinstance(value, str) or not SEMVER.fullmatch(value):
        raise RuntimeError(f"{label} must be strict semantic versioning")
    return tuple(int(part) for part in value.split("."))


def archive_sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate(
    archive_path: pathlib.Path,
    *,
    expected_revision: str,
    expected_version: str | None = None,
    installed_version: str | None = None,
    expected_sha256: str | None = None,
) -> dict:
    if not HEX_REVISION.fullmatch(expected_revision):
        raise RuntimeError("--expected-revision must be a Git commit revision")
    digest = archive_sha256(archive_path)
    if expected_sha256 and digest.lower() != expected_sha256.lower():
        raise RuntimeError(
            f"archive SHA-256 mismatch: expected {expected_sha256.lower()} got {digest.lower()}"
        )

    try:
        archive = zipfile.ZipFile(archive_path)
    except (OSError, zipfile.BadZipFile) as exc:
        raise RuntimeError("candidate is not a readable ZIP archive") from exc

    with archive:
        infos = archive.infolist()
        names = [item.filename for item in infos if not item.is_dir()]
        if len(names) != len(set(names)):
            raise RuntimeError("candidate ZIP contains duplicate file paths")
        folded = [name.casefold() for name in names]
        if len(folded) != len(set(folded)):
            raise RuntimeError("candidate ZIP contains case-colliding file paths")
        for item in infos:
            name = item.filename
            if "\\" in name:
                raise RuntimeError(f"candidate ZIP contains non-portable backslash path: {name}")
            pure = pathlib.PurePosixPath(name)
            if pure.is_absolute() or ".." in pure.parts:
                raise RuntimeError(f"candidate ZIP contains unsafe path: {name}")
            canonical = pure.as_posix()
            if item.is_dir():
                canonical += "/"
            if canonical != name:
                raise RuntimeError(f"candidate ZIP contains non-canonical path: {name}")
            mode = (item.external_attr >> 16) & 0xFFFF
            if stat.S_ISLNK(mode):
                raise RuntimeError(f"candidate ZIP contains symbolic link: {name}")

        leaked = sorted(path for path in FORBIDDEN_PATHS if path in names)
        if leaked:
            raise RuntimeError(
                "candidate Workspace archive leaks local runtime/MCP surfaces: "
                + ", ".join(leaked)
            )

        top_levels = {pathlib.PurePosixPath(name).parts[0] for name in names}
        unexpected_top = sorted(top_levels.difference(ALLOWED_TOP_LEVEL))
        if unexpected_top:
            raise RuntimeError(
                "candidate Workspace archive contains unexpected top-level surfaces: "
                + ", ".join(unexpected_top)
            )
        skill_entrypoints = {
            name for name in names
            if name.startswith("skills/") and name.endswith("/SKILL.md")
        }
        if skill_entrypoints != EXPECTED_SKILL_ENTRYPOINTS:
            raise RuntimeError(
                "candidate Workspace archive Skill entrypoints mismatch: "
                + ", ".join(sorted(skill_entrypoints))
            )

        missing = sorted(REQUIRED_PATHS.difference(names))
        if missing:
            raise RuntimeError("candidate Workspace archive is missing: " + ", ".join(missing))

        plugin = load_json(archive, "plugin.json")
        legacy = load_json(archive, ".codex-plugin/plugin.json")
        distribution = load_json(archive, "veteran-distribution.json")

    if plugin.get("name") != PLUGIN_NAME:
        raise RuntimeError("candidate root plugin identity mismatch")
    if legacy.get("name") != PLUGIN_NAME:
        raise RuntimeError("candidate compatibility manifest identity mismatch")
    if legacy.get("skills") != "./skills":
        raise RuntimeError("candidate compatibility manifest must point to ./skills")
    if "mcpServers" in legacy or "apps" in legacy:
        raise RuntimeError("candidate compatibility manifest must remain Workspace skill-only")
    version = plugin.get("version")
    version_tuple = parse_semver(version, "candidate plugin version")
    if legacy.get("version") != version:
        raise RuntimeError("candidate manifests disagree on Studio version")
    if expected_version is not None and version != expected_version:
        raise RuntimeError(f"candidate version mismatch: expected {expected_version} got {version}")
    if installed_version is not None and version_tuple <= parse_semver(installed_version, "installed version"):
        raise RuntimeError(
            f"candidate version must be newer than installed version: {installed_version} -> {version}"
        )

    openai_extension = plugin.get("extensions", {}).get("com.openai", {})
    if isinstance(openai_extension, dict) and "apps" in openai_extension:
        raise RuntimeError("candidate root manifest must remain Workspace skill-only")

    if distribution.get("product") != PLUGIN_NAME:
        raise RuntimeError("candidate distribution product mismatch")
    if distribution.get("profile") != "workspace" or distribution.get("surfaceProfile") != "workspace-skill":
        raise RuntimeError("candidate is not a Workspace Skill profile")
    includes = distribution.get("includes")
    expected_includes = {
        "skill": True,
        "runtime": False,
        "mcpManifest": False,
        "appReference": False,
    }
    if includes != expected_includes:
        raise RuntimeError("candidate Workspace surface includes are not fail-closed")

    provenance = distribution.get("releaseProvenance")
    if not isinstance(provenance, dict):
        raise RuntimeError("candidate Workspace provenance is missing")
    revision = provenance.get("sourceRevision")
    if revision != expected_revision:
        raise RuntimeError(
            f"candidate source revision mismatch: expected {expected_revision} got {revision}"
        )
    if provenance.get("sourceOfTruth") != "https://github.com/9529360-cpu/veteran-engineer":
        raise RuntimeError("candidate source-of-truth repository mismatch")

    return {
        "plugin": PLUGIN_NAME,
        "version": version,
        "source_revision": revision,
        "profile": "workspace",
        "file_count": len(names),
        "sha256": digest,
        "safe_for_publication": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--expected-version")
    parser.add_argument("--installed-version")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = validate(
        pathlib.Path(args.archive).expanduser().resolve(),
        expected_revision=args.expected_revision,
        expected_version=args.expected_version,
        installed_version=args.installed_version,
        expected_sha256=args.expected_sha256,
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(
            f"workspace_release_gate=pass version={report['version']} "
            f"revision={report['source_revision']} sha256={report['sha256']}"
        )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        raise SystemExit(f"error: {exc}")
