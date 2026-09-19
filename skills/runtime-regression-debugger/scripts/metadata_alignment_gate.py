#!/usr/bin/env python3
"""Validate that ChatGPT-facing Skill metadata still matches the packaged Skill identity.

This is intentionally narrow: it checks durable structural alignment, not preferred copy.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

try:
    import yaml
except Exception as exc:  # pragma: no cover - environment failure
    raise SystemExit(f"PyYAML is required: {exc}")


def normalize_identity(value: str) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", value.lower()))


def load_skill_identity(skill_md: Path) -> tuple[str, str, str]:
    text = skill_md.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        raise ValueError("SKILL.md is missing YAML frontmatter")
    try:
        _, front, body = text.split("---", 2)
    except ValueError as exc:
        raise ValueError("SKILL.md frontmatter is not closed") from exc
    meta = yaml.safe_load(front) or {}
    name = str(meta.get("name") or "").strip()
    description = str(meta.get("description") or "").strip()
    heading = next((line[2:].strip() for line in body.splitlines() if line.startswith("# ")), "")
    if not name or not description or not heading:
        raise ValueError("SKILL.md must provide name, description, and a top-level heading")
    return name, description, heading


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("skill_root")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    root = Path(args.skill_root).resolve()
    skill_md = root / "SKILL.md"
    metadata_path = root / "agents" / "openai.yaml"
    failures: list[str] = []

    try:
        name, description, heading = load_skill_identity(skill_md)
    except Exception as exc:
        failures.append(str(exc))
        name = description = heading = ""

    if not metadata_path.is_file():
        failures.append("agents/openai.yaml is missing")
        metadata = {}
    else:
        try:
            metadata = yaml.safe_load(metadata_path.read_text(encoding="utf-8")) or {}
        except Exception as exc:
            failures.append(f"agents/openai.yaml is invalid YAML: {exc}")
            metadata = {}

    interface = metadata.get("interface") if isinstance(metadata, dict) else None
    if not isinstance(interface, dict):
        failures.append("agents/openai.yaml must contain interface metadata")
        interface = {}

    display_name = str(interface.get("display_name") or "").strip()
    short_description = str(interface.get("short_description") or "").strip()
    if not display_name:
        failures.append("interface.display_name is missing")
    elif heading and normalize_identity(display_name) != normalize_identity(heading):
        failures.append(
            f"display_name {display_name!r} no longer matches SKILL heading {heading!r}"
        )

    if not short_description:
        failures.append("interface.short_description is missing")
    elif len(short_description) < 40:
        failures.append("interface.short_description is too short to communicate the Skill's scope")

    for key in ("icon_small", "icon_large"):
        value = interface.get(key)
        if value:
            target = root / str(value)
            if not target.is_file():
                failures.append(f"{key} points to missing file: {value}")

    payload = {
        "status": "pass" if not failures else "fail",
        "skill_name": name,
        "skill_heading": heading,
        "display_name": display_name,
        "metadata_path": str(metadata_path.relative_to(root)) if metadata_path.exists() else None,
        "failures": failures,
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        if failures:
            print("FAIL")
            for item in failures:
                print(f"- {item}")
        else:
            print(f"PASS {display_name} ({name})")
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
