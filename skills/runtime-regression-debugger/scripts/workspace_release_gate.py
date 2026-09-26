#!/usr/bin/env python3
"""Fail-closed validation for a Workspace Studio publication archive."""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import stat
import unicodedata
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
EXPECTED_SKILL_ROOTS = {
    "runtime-regression-debugger",
    "frontend-design-builder",
}
EXPECTED_SKILL_NAMES = {
    "skills/runtime-regression-debugger/SKILL.md": "runtime-regression-debugger",
    "skills/frontend-design-builder/SKILL.md": "frontend-design-builder",
}
EXPECTED_AGENT_DISPLAY_NAMES = {
    "skills/runtime-regression-debugger/agents/openai.yaml": "Veteran Full Stack Engineer",
    "skills/frontend-design-builder/agents/openai.yaml": "Veteran Frontend Design Builder",
}
FORBIDDEN_PATHS = {
    ".mcp.json",
    "mcp.json",
    ".app.json",
    "mcp/server.mjs",
    "src/mcp-server.mjs",
}
FORBIDDEN_BASENAMES = {".mcp.json", "mcp.json", ".app.json"}
ALLOWED_CODEX_PLUGIN_PATHS = {".codex-plugin/plugin.json"}
HEX_REVISION = re.compile(r"^[0-9a-f]{40}$")
SEMVER = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
MAX_FILE_COUNT = 2_000
MAX_TOTAL_UNCOMPRESSED_BYTES = 25 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 8 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200.0


def load_json(archive: zipfile.ZipFile, path: str) -> dict:
    try:
        value = json.loads(archive.read(path).decode("utf-8"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid or missing JSON file: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"JSON file must contain an object: {path}")
    return value


def load_text(archive: zipfile.ZipFile, path: str) -> str:
    try:
        return archive.read(path).decode("utf-8")
    except (KeyError, UnicodeDecodeError) as exc:
        raise RuntimeError(f"invalid or missing UTF-8 file: {path}") from exc


def skill_frontmatter_name(text: str, path: str) -> str:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise RuntimeError(f"Skill frontmatter is missing: {path}")
    try:
        end = next(index for index, line in enumerate(lines[1:], 1) if line.strip() == "---")
    except StopIteration as exc:
        raise RuntimeError(f"Skill frontmatter is unterminated: {path}") from exc
    names = [
        line.split(":", 1)[1].strip().strip('"\'')
        for line in lines[1:end]
        if line.strip().startswith("name:") and ":" in line
    ]
    if len(names) != 1 or not names[0]:
        raise RuntimeError(f"Skill frontmatter must contain exactly one name: {path}")
    return names[0]


def reject_control_characters(value: str, label: str) -> None:
    for char in value:
        if unicodedata.category(char).startswith("C"):
            raise RuntimeError(f"{label} contains Unicode control/format characters: {value!r}")


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


def load_installed_state(path: pathlib.Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"invalid installed state JSON: {path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("installed state must be a JSON object")
    if value.get("schema") != "veteran-workspace-installed-state-v2":
        raise RuntimeError("installed state schema mismatch")
    if value.get("plugin_id") != "Plugin_8d9c7648269081918d366e3d9e9a43e2":
        raise RuntimeError("installed state plugin identity mismatch")
    release_id = value.get("release_id")
    if not isinstance(release_id, str) or not re.fullmatch(r"pluginrel_[A-Za-z0-9]+", release_id):
        raise RuntimeError("installed state release_id is missing or invalid")
    version = value.get("version")
    parse_semver(version, "installed state version")
    if value.get("inventory_complete") is not True:
        raise RuntimeError("installed state inventory_complete must be true")

    pages = value.get("pages")
    if not isinstance(pages, list) or not pages:
        raise RuntimeError("installed state pages must be a non-empty array")

    flattened_paths: list[str] = []
    expected_offset = 0
    page_offsets: list[int] = []
    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            raise RuntimeError(f"installed state pages[{index}] must be an object")
        offset = page.get("offset")
        count = page.get("count")
        next_offset = page.get("next_offset")
        page_paths = page.get("paths")
        if offset != expected_offset:
            raise RuntimeError(
                f"installed state page chain is not contiguous at page {index}: "
                f"expected offset {expected_offset}, got {offset}"
            )
        if not isinstance(count, int) or count < 1:
            raise RuntimeError(f"installed state pages[{index}].count must be a positive integer")
        if not isinstance(page_paths, list) or len(page_paths) != count:
            raise RuntimeError(f"installed state pages[{index}] paths/count mismatch")
        if not all(isinstance(item, str) and item for item in page_paths):
            raise RuntimeError(f"installed state pages[{index}] paths must be non-empty strings")
        if index < len(pages) - 1:
            if not isinstance(next_offset, int) or next_offset != offset + count:
                raise RuntimeError(
                    f"installed state pages[{index}].next_offset must equal offset + count"
                )
        elif next_offset is not None:
            raise RuntimeError("installed state final page must have next_offset=null")
        page_offsets.append(offset)
        flattened_paths.extend(page_paths)
        expected_offset = next_offset if next_offset is not None else offset + count
        if index < len(pages) - 1 and pages[index + 1].get("offset") != next_offset:
            raise RuntimeError(
                f"installed state page chain next_offset mismatch at page {index}"
            )

    path_count = value.get("path_count")
    if path_count != len(flattened_paths):
        raise RuntimeError("installed state path_count does not match flattened page paths")
    paths = set(flattened_paths)
    if len(paths) != len(flattened_paths):
        raise RuntimeError("installed state contains duplicate paths")

    normalized_keys: dict[str, str] = {}
    for item in flattened_paths:
        reject_control_characters(item, "installed state path")
        pure = pathlib.PurePosixPath(item)
        if pure.is_absolute() or ".." in pure.parts or "\\" in item or pure.as_posix() != item:
            raise RuntimeError(f"installed state contains unsafe/non-canonical path: {item}")
        normalized = unicodedata.normalize("NFC", item)
        if normalized != item:
            raise RuntimeError(f"installed state path is not Unicode NFC-normalized: {item!r}")
        key = normalized.casefold()
        previous = normalized_keys.get(key)
        if previous is not None and previous != item:
            raise RuntimeError(
                f"installed state contains Unicode/case-colliding paths: {previous!r} and {item!r}"
            )
        normalized_keys[key] = item

    return {
        "release_id": release_id,
        "version": version,
        "paths": paths,
        "path_count": len(paths),
        "page_offsets": page_offsets,
        "pages": pages,
    }

def validate(
    archive_path: pathlib.Path,
    *,
    expected_revision: str,
    expected_version: str | None = None,
    installed_version: str | None = None,
    expected_sha256: str | None = None,
    installed_state: pathlib.Path | None = None,
    publication: bool = False,
) -> dict:
    if not HEX_REVISION.fullmatch(expected_revision):
        raise RuntimeError("--expected-revision must be a full lowercase 40-hex Git commit SHA")
    if publication:
        missing_args = []
        if expected_sha256 is None:
            missing_args.append("--expected-sha256")
        if installed_state is None:
            missing_args.append("--installed-state")
        if missing_args:
            raise RuntimeError(
                "--publication requires fresh installed state and immutable artifact identity: "
                + ", ".join(missing_args)
            )

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
        file_infos = [item for item in infos if not item.is_dir()]
        names = [item.filename for item in file_infos]
        if len(file_infos) > MAX_FILE_COUNT:
            raise RuntimeError(
                f"candidate ZIP contains too many files: {len(file_infos)} > {MAX_FILE_COUNT}"
            )
        total_uncompressed = sum(item.file_size for item in file_infos)
        if total_uncompressed >= MAX_TOTAL_UNCOMPRESSED_BYTES:
            raise RuntimeError(
                "candidate ZIP is unexpectedly large when uncompressed: "
                f"{total_uncompressed} bytes"
            )
        if len(names) != len(set(names)):
            raise RuntimeError("candidate ZIP contains duplicate file paths")

        normalized_names: dict[str, str] = {}
        for item in infos:
            name = item.filename
            if item.flag_bits & 0x1:
                raise RuntimeError(f"candidate ZIP contains encrypted entry: {name}")
            if not item.is_dir():
                if item.file_size > MAX_SINGLE_FILE_BYTES:
                    raise RuntimeError(
                        f"candidate ZIP file is unexpectedly large: {name} -> {item.file_size} bytes"
                    )
                if item.file_size > 0:
                    if item.compress_size <= 0:
                        raise RuntimeError(f"candidate ZIP has invalid compressed size: {name}")
                    ratio = item.file_size / item.compress_size
                    if ratio > MAX_COMPRESSION_RATIO:
                        raise RuntimeError(
                            f"candidate ZIP compression ratio is suspicious: {name} -> {ratio:.1f}x"
                        )

            reject_control_characters(name, "candidate ZIP path")
            normalized = unicodedata.normalize("NFC", name)
            if normalized != name:
                raise RuntimeError(f"candidate ZIP path is not Unicode NFC-normalized: {name!r}")
            folded = normalized.casefold()
            previous = normalized_names.get(folded)
            if previous is not None and previous != name:
                raise RuntimeError(
                    f"candidate ZIP contains Unicode/case-colliding paths: {previous!r} and {name!r}"
                )
            normalized_names[folded] = name

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
        leaked.extend(
            name for name in names
            if pathlib.PurePosixPath(name).name in FORBIDDEN_BASENAMES
            and name not in leaked
        )
        leaked.extend(
            name for name in names
            if "plugin-runtime-starter" in pathlib.PurePosixPath(name).parts
            and name not in leaked
        )
        if leaked:
            raise RuntimeError(
                "candidate Workspace archive leaks local runtime/MCP surfaces: "
                + ", ".join(sorted(leaked))
            )

        unexpected_codex = sorted(
            name for name in names
            if name.startswith(".codex-plugin/")
            and name not in ALLOWED_CODEX_PLUGIN_PATHS
        )
        if unexpected_codex:
            raise RuntimeError(
                "candidate Workspace archive contains unexpected .codex-plugin surfaces: "
                + ", ".join(unexpected_codex)
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
        skill_members = [
            pathlib.PurePosixPath(name)
            for name in names
            if name.startswith("skills/")
        ]
        if any(len(member.parts) < 3 for member in skill_members):
            raise RuntimeError("candidate Workspace archive contains files directly under skills/")
        skill_roots = {member.parts[1] for member in skill_members}
        if skill_roots != EXPECTED_SKILL_ROOTS:
            raise RuntimeError(
                "candidate Workspace archive Skill roots mismatch: "
                + ", ".join(sorted(skill_roots))
            )

        missing = sorted(REQUIRED_PATHS.difference(names))
        if missing:
            raise RuntimeError("candidate Workspace archive is missing: " + ", ".join(missing))

        installed_snapshot = load_installed_state(installed_state) if installed_state is not None else None
        if installed_snapshot is not None:
            if installed_version is not None and installed_snapshot["version"] != installed_version:
                raise RuntimeError(
                    "installed version argument disagrees with installed-state snapshot: "
                    f"{installed_version} != {installed_snapshot['version']}"
                )
            installed_version = installed_snapshot["version"]
            omitted_installed = sorted(installed_snapshot["paths"].difference(names))
            if omitted_installed:
                raise RuntimeError(
                    "candidate omits installed Workspace paths that overlay publication cannot delete; "
                    "preserve them or ship explicit inert tombstones: "
                    + ", ".join(omitted_installed[:50])
                )

        plugin = load_json(archive, "plugin.json")
        legacy = load_json(archive, ".codex-plugin/plugin.json")
        distribution = load_json(archive, "veteran-distribution.json")
        skill_texts = {
            skill_path: load_text(archive, skill_path)
            for skill_path in EXPECTED_SKILL_NAMES
        }
        agent_texts = {
            agent_path: load_text(archive, agent_path)
            for agent_path in EXPECTED_AGENT_DISPLAY_NAMES
        }

    if plugin.get("name") != PLUGIN_NAME:
        raise RuntimeError("candidate root plugin identity mismatch")
    if legacy.get("name") != PLUGIN_NAME:
        raise RuntimeError("candidate compatibility manifest identity mismatch")
    if legacy.get("skills") != "./skills":
        raise RuntimeError("candidate compatibility manifest must point to ./skills")
    root_interface = plugin.get("extensions", {}).get("com.openai", {}).get("interface")
    if not isinstance(root_interface, dict) or not root_interface:
        raise RuntimeError("candidate root manifest OpenAI interface is missing")
    if legacy.get("interface") != root_interface:
        raise RuntimeError("candidate compatibility manifest interface drifted from root manifest")
    if "mcpServers" in legacy or "apps" in legacy:
        raise RuntimeError("candidate compatibility manifest must remain Workspace skill-only")
    for skill_path, expected_name in EXPECTED_SKILL_NAMES.items():
        actual_name = skill_frontmatter_name(skill_texts[skill_path], skill_path)
        if actual_name != expected_name:
            raise RuntimeError(
                f"candidate Skill frontmatter name mismatch: {skill_path} -> {actual_name!r}"
            )
    for agent_path, expected_display in EXPECTED_AGENT_DISPLAY_NAMES.items():
        agent_text = agent_texts[agent_path]
        if re.search(r"(?m)^\s*policy\s*:", agent_text) or "allow_implicit_invocation" in agent_text:
            raise RuntimeError(f"candidate Skill agent declares unsupported invocation policy: {agent_path}")
        for product in ("chatgpt", "codex", "api", "atlas"):
            if re.search(rf"(?m)^\s*-\s*{re.escape(product)}\s*$", agent_text):
                raise RuntimeError(
                    f"candidate Skill agent declares unsupported product policy metadata: {agent_path}"
                )
        display_pattern = rf'(?m)^\s*display_name:\s*["\']?{re.escape(expected_display)}["\']?\s*    version_tuple = parse_semver(version, "candidate plugin version")
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
    if "apps" in plugin or "mcpServers" in plugin:
        raise RuntimeError("candidate root manifest must not declare app/MCP runtime surfaces")

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
        "uncompressed_bytes": total_uncompressed,
        "sha256": digest,
        "installed_inventory_checked": installed_state is not None,
        "installed_path_count": installed_snapshot["path_count"] if installed_state is not None else None,
        "installed_page_offsets": installed_snapshot["page_offsets"] if installed_state is not None else None,
        "expected_release_id": installed_snapshot["release_id"] if installed_state is not None else None,
        "publication_mode": publication,
        "safe_for_publication": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--expected-version")
    parser.add_argument("--installed-version")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--installed-state")
    parser.add_argument("--publication", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = validate(
        pathlib.Path(args.archive).expanduser().resolve(),
        expected_revision=args.expected_revision,
        expected_version=args.expected_version,
        installed_version=args.installed_version,
        expected_sha256=args.expected_sha256,
        installed_state=(
            pathlib.Path(args.installed_state).expanduser().resolve()
            if args.installed_state
            else None
        ),
        publication=args.publication,
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

        if not re.search(display_pattern, agent_text):
            raise RuntimeError(
                f"candidate Skill agent display name mismatch: {agent_path}"
            )

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
    if "apps" in plugin or "mcpServers" in plugin:
        raise RuntimeError("candidate root manifest must not declare app/MCP runtime surfaces")

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
        "installed_inventory_checked": installed_state is not None,
        "installed_path_count": installed_snapshot["path_count"] if installed_state is not None else None,
        "installed_page_offsets": installed_snapshot["page_offsets"] if installed_state is not None else None,
        "expected_release_id": installed_snapshot["release_id"] if installed_state is not None else None,
        "publication_mode": publication,
        "safe_for_publication": True,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archive")
    parser.add_argument("--expected-revision", required=True)
    parser.add_argument("--expected-version")
    parser.add_argument("--installed-version")
    parser.add_argument("--expected-sha256")
    parser.add_argument("--installed-state")
    parser.add_argument("--publication", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    report = validate(
        pathlib.Path(args.archive).expanduser().resolve(),
        expected_revision=args.expected_revision,
        expected_version=args.expected_version,
        installed_version=args.installed_version,
        expected_sha256=args.expected_sha256,
        installed_state=(
            pathlib.Path(args.installed_state).expanduser().resolve()
            if args.installed_state
            else None
        ),
        publication=args.publication,
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
