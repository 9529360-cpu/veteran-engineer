#!/usr/bin/env python3
"""Advisory static UI slop scanner for Frontend Design Builder.

This scanner catches a deliberately small set of mechanically detectable UI
smells. It is not a design-quality oracle and must not replace rendered review.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path

EXTENSIONS = {".html", ".htm", ".css", ".scss", ".sass", ".less", ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte", ".astro"}
SKIP_DIRS = {"node_modules", "dist", "build", ".next", ".nuxt", "coverage", "vendor", ".git"}

LINE_RULES = [
    ("dead-link", "warning", re.compile(r'href\s*=\s*["\'](?:#|javascript:void\(0\))["\']', re.I),
     "Interactive-looking link has no real destination."),
    ("lorem-ipsum", "advisory", re.compile(r"\blorem\s+ipsum\b", re.I),
     "Placeholder copy is still visible in UI source."),
    ("placeholder-identity", "advisory", re.compile(r"\b(?:John Doe|Jane Doe|Jane Smith|Acme Corp)\b", re.I),
     "Generic placeholder identity makes the interface read like a template."),
    ("tiny-text", "warning", re.compile(r"(?:font-size\s*:\s*(?:8|9|10|11)px\b|\btext-\[(?:8|9|10|11)px\])", re.I),
     "Text below 12px is easy to make illegible and should be justified by the actual role."),
    ("viewport-height", "advisory", re.compile(r"(?:height\s*:\s*100vh\b|\bh-screen\b)", re.I),
     "100vh/h-screen can be brittle on mobile browser chrome; verify whether dynamic viewport units are safer."),
    ("extreme-z-index", "advisory", re.compile(r"(?:z-index\s*:\s*(?:[2-9]\d{2,}|\d{4,})\b|\bz-\[(?:[2-9]\d{2,}|\d{4,})\])", re.I),
     "Very large z-index often signals an unmanaged layering scale."),
]

@dataclass
class Finding:
    rule_id: str
    severity: str
    file: str
    line: int
    message: str
    evidence: str


def _iter_files(root: Path, max_files: int):
    count = 0
    candidates = [root] if root.is_file() else root.rglob("*")
    for path in candidates:
        if count >= max_files:
            break
        if not path.is_file() or path.suffix.lower() not in EXTENSIONS:
            continue
        if any(part in SKIP_DIRS for part in path.parts):
            continue
        count += 1
        yield path


def _line_number(text: str, offset: int) -> int:
    return text.count("\n", 0, offset) + 1


def _relative(path: Path, root: Path) -> str:
    if root.is_file():
        return path.name
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return path.as_posix()


def _suppressed(line: str, rule_id: str) -> bool:
    return f"ui-slop-ignore:{rule_id}" in line or "ui-slop-ignore:all" in line


def _add_threshold_finding(findings, *, rule_id, severity, path, root, text, pattern, threshold, message):
    matches = list(pattern.finditer(text))
    if len(matches) < threshold:
        return
    first = matches[0]
    line = text.splitlines()[_line_number(text, first.start()) - 1] if text.splitlines() else ""
    if _suppressed(line, rule_id):
        return
    findings.append(Finding(
        rule_id=rule_id,
        severity=severity,
        file=_relative(path, root),
        line=_line_number(text, first.start()),
        message=f"{message} Found {len(matches)} occurrences in this file.",
        evidence=first.group(0)[:120],
    ))


def scan_path(root: Path, max_files: int = 2000) -> dict:
    root = root.resolve()
    findings: list[Finding] = []
    files_scanned = 0

    for path in _iter_files(root, max_files=max_files):
        files_scanned += 1
        try:
            text = path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        lines = text.splitlines()

        for rule_id, severity, pattern, message in LINE_RULES:
            emitted = 0
            for match in pattern.finditer(text):
                line_no = _line_number(text, match.start())
                line = lines[line_no - 1] if 0 < line_no <= len(lines) else ""
                if _suppressed(line, rule_id):
                    continue
                findings.append(Finding(
                    rule_id=rule_id,
                    severity=severity,
                    file=_relative(path, root),
                    line=line_no,
                    message=message,
                    evidence=match.group(0)[:120],
                ))
                emitted += 1
                if emitted >= 5:
                    break

        _add_threshold_finding(
            findings,
            rule_id="pill-saturation",
            severity="advisory",
            path=path,
            root=root,
            text=text,
            pattern=re.compile(r"(?:\brounded-full\b|border-radius\s*:\s*(?:999|9999)px)", re.I),
            threshold=6,
            message="Pill geometry is repeated heavily; verify that pills encode real control/status semantics rather than default decoration.",
        )
        _add_threshold_finding(
            findings,
            rule_id="transition-all-saturation",
            severity="advisory",
            path=path,
            root=root,
            text=text,
            pattern=re.compile(r"\btransition-all\b|transition-property\s*:\s*all", re.I),
            threshold=4,
            message="Broad transition-all usage is repeated; prefer transitions tied to the properties that actually communicate state.",
        )
        _add_threshold_finding(
            findings,
            rule_id="bounce-saturation",
            severity="advisory",
            path=path,
            root=root,
            text=text,
            pattern=re.compile(r"\banimate-bounce\b|cubic-bezier\([^)]*(?:1\.5|1\.6|1\.7|1\.8|1\.9|2\.)", re.I),
            threshold=3,
            message="Bouncy motion is repeated; verify that motion hierarchy is intentional rather than ornamental.",
        )

        if re.search(r"\boutline-none\b|outline\s*:\s*none", text, re.I) and not re.search(r"focus-visible|:focus\b", text, re.I):
            match = re.search(r"\boutline-none\b|outline\s*:\s*none", text, re.I)
            if match:
                findings.append(Finding(
                    rule_id="focus-removal",
                    severity="advisory",
                    file=_relative(path, root),
                    line=_line_number(text, match.start()),
                    message="Focus outline is removed in a file with no visible replacement state.",
                    evidence=match.group(0),
                ))

    by_severity = {"warning": 0, "advisory": 0}
    for finding in findings:
        by_severity[finding.severity] = by_severity.get(finding.severity, 0) + 1

    return {
        "root": str(root),
        "files_scanned": files_scanned,
        "finding_count": len(findings),
        "severity_counts": by_severity,
        "findings": [asdict(f) for f in findings],
        "disclaimer": "Static advisories only. Rendered designer critique remains the visual-quality authority.",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Scan frontend source for a small set of deterministic UI slop advisories.")
    parser.add_argument("path", nargs="?", default=".", help="Frontend file or directory to scan.")
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    parser.add_argument("--strict", action="store_true", help="Exit 2 when warning-severity findings exist.")
    parser.add_argument("--max-files", type=int, default=2000, help="Maximum supported frontend files to scan.")
    args = parser.parse_args()

    payload = scan_path(Path(args.path), max_files=max(1, args.max_files))
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        for finding in payload["findings"]:
            print(f'{finding["severity"].upper()} {finding["rule_id"]} {finding["file"]}:{finding["line"]} - {finding["message"]}')
        print(f'scanned={payload["files_scanned"]} findings={payload["finding_count"]} warnings={payload["severity_counts"].get("warning", 0)} advisories={payload["severity_counts"].get("advisory", 0)}')

    if args.strict and payload["severity_counts"].get("warning", 0):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
