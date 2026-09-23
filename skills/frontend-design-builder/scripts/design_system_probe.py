#!/usr/bin/env python3
"""Bounded repository probe for frontend/design-system evidence.

The probe reports concrete files and installed packages; it does not decide the
product design. It intentionally skips generated/vendor trees and caps traversal.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

SKIP_DIRS = {
    ".git", ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".venv", "venv",
    "node_modules", "dist", "build", "coverage", "out", "vendor",
}

PACKAGE_GROUPS = {
    "frameworks": {
        "react": "React", "next": "Next.js", "vue": "Vue", "nuxt": "Nuxt",
        "svelte": "Svelte", "@sveltejs/kit": "SvelteKit", "@angular/core": "Angular",
        "solid-js": "Solid", "astro": "Astro",
    },
    "ui_libraries": {
        "@mui/material": "MUI", "antd": "Ant Design", "@chakra-ui/react": "Chakra UI",
        "@mantine/core": "Mantine", "@headlessui/react": "Headless UI React",
        "@headlessui/vue": "Headless UI Vue", "@fluentui/react-components": "Fluent UI",
        "@adobe/react-spectrum": "React Spectrum", "@shopify/polaris": "Polaris",
    },
    "styling": {
        "tailwindcss": "Tailwind CSS", "styled-components": "styled-components",
        "@emotion/react": "Emotion", "sass": "Sass", "less": "Less",
    },
    "motion": {
        "framer-motion": "Framer Motion", "motion": "Motion", "gsap": "GSAP",
    },
    "component_lab": {
        "storybook": "Storybook", "chromatic": "Chromatic", "loki": "Loki",
        "@playwright/test": "Playwright", "playwright": "Playwright",
    },
    "design_tools": {
        "@figma/code-connect": "Figma Code Connect",
        "@figma/code-connect-react": "Figma Code Connect React",
    },
}

PREFIX_PACKAGES = {
    "@radix-ui/": ("ui_libraries", "Radix UI"),
    "@storybook/": ("component_lab", "Storybook"),
}

KNOWN_FILES = [
    "components.json",
    "tailwind.config.js", "tailwind.config.ts", "tailwind.config.cjs", "tailwind.config.mjs",
    "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs",
    "figma.config.json", "figma.config.js", "figma.config.ts",
    ".storybook/main.js", ".storybook/main.ts", ".storybook/main.mjs",
    ".storybook/preview.js", ".storybook/preview.ts", ".storybook/preview.mjs",
]

COMPONENT_DIRS = [
    "components", "src/components", "app/components", "src/ui", "ui",
    "src/design-system", "design-system", "packages/ui", "packages/design-system",
]

THEME_DIRS = ["styles", "src/styles", "theme", "src/theme", "tokens", "src/tokens"]

INTERESTING_NAME_PARTS = ("token", "theme", "variable", "palette", "typography")
INTERESTING_SUFFIXES = {".css", ".scss", ".sass", ".less", ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx"}


def _relative(root: Path, path: Path) -> str:
    return path.relative_to(root).as_posix()


def _package_manager(root: Path) -> str | None:
    for filename, name in [
        ("pnpm-lock.yaml", "pnpm"), ("yarn.lock", "yarn"), ("bun.lockb", "bun"),
        ("bun.lock", "bun"), ("package-lock.json", "npm"),
    ]:
        if (root / filename).is_file():
            return name
    return None


def _read_package(root: Path) -> tuple[dict, list[str]]:
    path = root / "package.json"
    if not path.is_file():
        return {}, []
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return {}, [f"package.json: {exc}"]
    if not isinstance(value, dict):
        return {}, ["package.json: top-level value is not an object"]
    return value, []


def _dependencies(package: dict) -> dict[str, str]:
    merged: dict[str, str] = {}
    for key in ("dependencies", "devDependencies", "peerDependencies", "optionalDependencies"):
        value = package.get(key, {})
        if isinstance(value, dict):
            for name, version in value.items():
                if isinstance(name, str) and isinstance(version, str):
                    merged.setdefault(name, version)
    return merged


def _detect_packages(deps: dict[str, str]) -> dict[str, list[dict]]:
    result = {key: [] for key in PACKAGE_GROUPS}
    seen = {key: set() for key in PACKAGE_GROUPS}
    for group, exact in PACKAGE_GROUPS.items():
        for package, label in exact.items():
            if package in deps and label not in seen[group]:
                result[group].append({"name": label, "package": package, "version": deps[package]})
                seen[group].add(label)
    for package, version in deps.items():
        for prefix, (group, label) in PREFIX_PACKAGES.items():
            if package.startswith(prefix) and label not in seen[group]:
                result[group].append({"name": label, "package": package, "version": version})
                seen[group].add(label)
    return result


def _walk_bounded(root: Path, max_files: int) -> tuple[list[Path], bool]:
    files: list[Path] = []
    for current, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if d not in SKIP_DIRS)
        for filename in sorted(filenames):
            files.append(Path(current) / filename)
            if len(files) >= max_files:
                return files, True
    return files, False


def _css_variable_sources(paths: list[Path], root: Path) -> list[str]:
    out = []
    for path in paths:
        if path.suffix.lower() not in {".css", ".scss", ".sass", ".less"}:
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")[:200_000]
        except OSError:
            continue
        if "--" in text and (":root" in text or "var(" in text):
            out.append(_relative(root, path))
    return sorted(set(out))[:50]


def probe(root: Path, *, max_files: int = 2000) -> dict:
    root = root.expanduser().resolve()
    if not root.is_dir():
        raise NotADirectoryError(str(root))

    package, errors = _read_package(root)
    deps = _dependencies(package)
    packages = _detect_packages(deps)
    files, truncated = _walk_bounded(root, max_files)
    rel_files = {_relative(root, path): path for path in files}

    known_files = sorted(path for path in KNOWN_FILES if path in rel_files)
    component_dirs = sorted(path for path in COMPONENT_DIRS if (root / path).is_dir())
    theme_dirs = sorted(path for path in THEME_DIRS if (root / path).is_dir())

    token_theme_files = []
    for rel, path in rel_files.items():
        lower_name = path.name.lower()
        if path.suffix.lower() not in INTERESTING_SUFFIXES:
            continue
        if any(part in lower_name for part in INTERESTING_NAME_PARTS):
            token_theme_files.append(rel)
    token_theme_files = sorted(set(token_theme_files))[:100]

    if (root / "components.json").is_file() and not any(x["name"] == "shadcn/ui" for x in packages["ui_libraries"]):
        packages["ui_libraries"].append({"name": "shadcn/ui", "package": None, "version": None, "evidence": "components.json"})

    figma_evidence = [path for path in known_files if "figma" in path.lower()]
    storybook_evidence = [path for path in known_files if path.startswith(".storybook/")]

    signals: list[str] = []
    if component_dirs or token_theme_files or theme_dirs or packages["ui_libraries"]:
        signals.extend(["existing-system", "design-system"])
    if packages["design_tools"] or figma_evidence:
        signals.extend(["figma", "code-connect"])
    if packages["component_lab"] or storybook_evidence:
        signals.extend(["storybook", "component-lab"])
    if packages["design_tools"] and (packages["component_lab"] or token_theme_files):
        signals.append("design-system-sync")
    signals = list(dict.fromkeys(signals))

    return {
        "schema_version": 1,
        "repo_root": str(root),
        "package_manager": _package_manager(root),
        "packages": packages,
        "component_dirs": component_dirs,
        "theme_dirs": theme_dirs,
        "known_config_files": known_files,
        "token_theme_files": token_theme_files,
        "css_variable_sources": _css_variable_sources(files, root),
        "routing_signals": signals,
        "files_scanned": len(files),
        "scan_truncated": truncated,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo_root")
    parser.add_argument("--max-files", type=int, default=2000)
    parser.add_argument("--signals", action="store_true", help="Print only comma-separated routing signals")
    args = parser.parse_args()
    if args.max_files < 1:
        raise SystemExit("--max-files must be >= 1")
    result = probe(Path(args.repo_root), max_files=args.max_files)
    if args.signals:
        print(",".join(result["routing_signals"]))
    else:
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
