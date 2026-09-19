#!/usr/bin/env python3
"""Fingerprint a repository's frontend styling architecture from local evidence.

This is a bounded navigation aid. It reports observed packages/config/files/patterns;
it does not decide whether a styling choice is correct or authorize UI changes.
"""
from __future__ import annotations

import argparse
import json
import os
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Iterable

SKIP_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "vendor", "dist", "build", "out",
    ".next", ".nuxt", ".svelte-kit", "coverage", ".cache", ".turbo", ".nx",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache",
}

STYLE_SUFFIXES = {".css", ".scss", ".sass", ".less", ".styl", ".stylus"}
CODE_SUFFIXES = {".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".astro", ".html"}
READ_SUFFIXES = STYLE_SUFFIXES | CODE_SUFFIXES

PACKAGE_SYSTEMS = {
    "tailwind": {"tailwindcss", "@tailwindcss/postcss", "@tailwindcss/vite", "@tailwindcss/forms", "@tailwindcss/typography"},
    "css-in-js": {"styled-components", "@emotion/react", "@emotion/styled", "@stitches/react", "goober", "linaria"},
    "vanilla-extract": {"@vanilla-extract/css", "@vanilla-extract/recipes", "@vanilla-extract/vite-plugin"},
    "sass": {"sass", "node-sass"},
    "less": {"less"},
    "mui": {"@mui/material", "@mui/system", "@mui/joy"},
    "chakra": {"@chakra-ui/react"},
    "ant-design": {"antd"},
    "mantine": {"@mantine/core"},
    "radix": {"@radix-ui/react-slot", "@radix-ui/themes"},
    "utility-composition": {"class-variance-authority", "tailwind-merge", "clsx", "classnames"},
}

CONFIG_NAMES = {
    "tailwind.config.js": "tailwind-config",
    "tailwind.config.cjs": "tailwind-config",
    "tailwind.config.mjs": "tailwind-config",
    "tailwind.config.ts": "tailwind-config",
    "postcss.config.js": "postcss-config",
    "postcss.config.cjs": "postcss-config",
    "postcss.config.mjs": "postcss-config",
    "postcss.config.ts": "postcss-config",
    "components.json": "component-registry",
}

TOKEN_NAME_RE = re.compile(r"(^|[-_.])(token|tokens|theme|themes|design-system|designsystem|styles|variables)([-_.]|$)", re.I)
CSS_VAR_RE = re.compile(r"--[a-zA-Z0-9_-]+\s*:")
RAW_COLOR_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\s*\(")
PX_RE = re.compile(r"(?<![\w.-])\d+(?:\.\d+)?px\b")
Z_INDEX_RE = re.compile(r"\bz-index\s*:\s*[-+]?\d+")
IMPORTANT_RE = re.compile(r"!important\b")
INLINE_STYLE_RE = re.compile(r"\bstyle\s*=\s*\{\{")
TAILWIND_ARBITRARY_RE = re.compile(r"(?:^|\s)[^\s\"'`]*\[[^\]\n]+\][^\s\"'`]*(?=\s|$)")
CSS_MODULE_RE = re.compile(r"\.module\.(?:css|scss|sass|less)$", re.I)
STYLED_COMPONENT_RE = re.compile(r"\bstyled(?:\.[A-Za-z][\w]*|\s*\()")
EMOTION_RE = re.compile(r"\bcss\s*=\s*\{|\bsx\s*=\s*\{")


def iter_files(root: Path, max_files: int) -> tuple[list[Path], bool]:
    out: list[Path] = []
    truncated = False
    for base, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        for name in files:
            path = Path(base) / name
            out.append(path)
            if len(out) >= max_files:
                truncated = True
                return out, truncated
    return out, truncated


def rel(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def read_text(path: Path, limit: int) -> str:
    try:
        return path.read_bytes()[:limit].decode("utf-8", errors="ignore")
    except OSError:
        return ""


def package_deps(path: Path) -> set[str]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError):
        return set()
    deps: set[str] = set()
    for field in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        value = data.get(field)
        if isinstance(value, dict):
            deps.update(str(key) for key in value)
    return deps


def add_sample(bucket: dict[str, list[str]], key: str, value: str, limit: int = 8) -> None:
    if value not in bucket[key] and len(bucket[key]) < limit:
        bucket[key].append(value)


def count_matches(pattern: re.Pattern[str], text: str) -> int:
    return sum(1 for _ in pattern.finditer(text))


def fingerprint(root: Path, max_files: int = 12000, max_read_bytes: int = 262144) -> dict:
    root = root.resolve()
    files, truncated = iter_files(root, max_files)

    deps: set[str] = set()
    package_files: list[str] = []
    config_evidence: list[dict[str, str]] = []
    authoritative_candidates: set[str] = set()
    counts = Counter()
    samples: dict[str, list[str]] = defaultdict(list)
    files_read = 0

    for path in files:
        relative = rel(root, path)
        lower_name = path.name.lower()

        if lower_name == "package.json":
            package_files.append(relative)
            deps.update(package_deps(path))

        if lower_name in CONFIG_NAMES:
            config_evidence.append({"kind": CONFIG_NAMES[lower_name], "path": relative})
            authoritative_candidates.add(relative)

        if TOKEN_NAME_RE.search(path.stem) or any(TOKEN_NAME_RE.search(part) for part in path.parts[-3:]):
            if path.suffix.lower() in READ_SUFFIXES or path.suffix.lower() in {".json", ".ts", ".js"}:
                authoritative_candidates.add(relative)

        suffix = path.suffix.lower()
        if suffix not in READ_SUFFIXES:
            continue

        files_read += 1
        text = read_text(path, max_read_bytes)
        if not text:
            continue

        if suffix in STYLE_SUFFIXES:
            counts["style_files"] += 1
            add_sample(samples, "style_files", relative)
            if CSS_MODULE_RE.search(path.name):
                counts["css_module_files"] += 1
                add_sample(samples, "css_module_files", relative)
            elif suffix in {".scss", ".sass"}:
                counts["sass_files"] += 1
                add_sample(samples, "sass_files", relative)
            elif suffix == ".less":
                counts["less_files"] += 1
                add_sample(samples, "less_files", relative)
            else:
                counts["global_or_plain_style_files"] += 1
                add_sample(samples, "global_or_plain_style_files", relative)

        css_vars = count_matches(CSS_VAR_RE, text)
        if css_vars:
            counts["css_variable_declarations"] += css_vars
            add_sample(samples, "css_variable_declarations", relative)
            authoritative_candidates.add(relative)

        raw_colors = count_matches(RAW_COLOR_RE, text)
        if raw_colors:
            counts["raw_color_literals"] += raw_colors
            add_sample(samples, "raw_color_literals", relative)

        px = count_matches(PX_RE, text)
        if px:
            counts["px_literals"] += px
            add_sample(samples, "px_literals", relative)

        important = count_matches(IMPORTANT_RE, text)
        if important:
            counts["important_rules"] += important
            add_sample(samples, "important_rules", relative)

        z_index = count_matches(Z_INDEX_RE, text)
        if z_index:
            counts["numeric_z_index_rules"] += z_index
            add_sample(samples, "numeric_z_index_rules", relative)

        if suffix in CODE_SUFFIXES:
            inline_styles = count_matches(INLINE_STYLE_RE, text)
            if inline_styles:
                counts["inline_style_objects"] += inline_styles
                add_sample(samples, "inline_style_objects", relative)

            styled = count_matches(STYLED_COMPONENT_RE, text)
            if styled:
                counts["styled_component_patterns"] += styled
                add_sample(samples, "styled_component_patterns", relative)

            emotion = count_matches(EMOTION_RE, text)
            if emotion:
                counts["css_in_js_prop_patterns"] += emotion
                add_sample(samples, "css_in_js_prop_patterns", relative)

            arbitrary = count_matches(TAILWIND_ARBITRARY_RE, text)
            if arbitrary:
                counts["utility_arbitrary_value_patterns"] += arbitrary
                add_sample(samples, "utility_arbitrary_value_patterns", relative)

    systems: list[dict] = []
    for system, package_names in PACKAGE_SYSTEMS.items():
        matched = sorted(deps.intersection(package_names))
        if matched:
            systems.append({"name": system, "evidence": [{"kind": "package", "value": value} for value in matched]})

    config_by_kind: dict[str, list[str]] = defaultdict(list)
    for item in config_evidence:
        config_by_kind[item["kind"]].append(item["path"])
    if config_by_kind.get("tailwind-config") and not any(item["name"] == "tailwind" for item in systems):
        systems.append({"name": "tailwind", "evidence": [{"kind": "config", "value": value} for value in config_by_kind["tailwind-config"]]})
    if counts["css_module_files"]:
        systems.append({"name": "css-modules", "evidence": [{"kind": "file-count", "value": counts["css_module_files"]}]})
    if counts["sass_files"] and not any(item["name"] == "sass" for item in systems):
        systems.append({"name": "sass", "evidence": [{"kind": "file-count", "value": counts["sass_files"]}]})
    if counts["less_files"] and not any(item["name"] == "less" for item in systems):
        systems.append({"name": "less", "evidence": [{"kind": "file-count", "value": counts["less_files"]}]})
    if counts["styled_component_patterns"] and not any(item["name"] == "css-in-js" for item in systems):
        systems.append({"name": "css-in-js", "evidence": [{"kind": "source-pattern-count", "value": counts["styled_component_patterns"]}]})
    if counts["global_or_plain_style_files"]:
        systems.append({"name": "plain-or-global-css", "evidence": [{"kind": "file-count", "value": counts["global_or_plain_style_files"]}]})
    if counts["css_variable_declarations"]:
        systems.append({"name": "css-custom-properties", "evidence": [{"kind": "declaration-count", "value": counts["css_variable_declarations"]}]})

    review_keys = (
        "raw_color_literals", "px_literals", "important_rules", "numeric_z_index_rules",
        "inline_style_objects", "utility_arbitrary_value_patterns",
    )
    review_signals = [
        {"kind": key, "count": counts[key], "sample_files": samples.get(key, [])}
        for key in review_keys if counts[key]
    ]

    return {
        "root": str(root),
        "scan": {
            "files_seen": len(files),
            "files_read": files_read,
            "max_files": max_files,
            "max_read_bytes_per_file": max_read_bytes,
            "truncated": truncated,
        },
        "package_files": sorted(package_files),
        "detected_systems": systems,
        "config_evidence": sorted(config_evidence, key=lambda item: (item["kind"], item["path"])),
        "authoritative_candidates": sorted(authoritative_candidates)[:80],
        "source_counts": {key: counts[key] for key in sorted(counts)},
        "source_samples": {key: samples[key] for key in sorted(samples)},
        "review_signals": review_signals,
        "note": (
            "Evidence only. Verify active imports, build/cascade/theme behavior and rendered/computed styles before treating any candidate as styling authority. "
            "Literal/review-signal counts are navigation hints, not style violations."
        ),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", nargs="?", default=".")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--max-files", type=int, default=12000)
    parser.add_argument("--max-read-bytes", type=int, default=262144)
    args = parser.parse_args()

    payload = fingerprint(Path(args.root), max_files=max(1, args.max_files), max_read_bytes=max(1024, args.max_read_bytes))
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("# Frontend style fingerprint")
        for system in payload["detected_systems"]:
            print(f"- {system['name']}")
        if payload["authoritative_candidates"]:
            print("authority candidates:")
            for path in payload["authoritative_candidates"][:20]:
                print(f"  - {path}")
        if payload["review_signals"]:
            print("review signals:")
            for item in payload["review_signals"]:
                print(f"  - {item['kind']}: {item['count']}")
        print(payload["note"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
