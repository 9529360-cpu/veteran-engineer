import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ui_slop_scan.py"
sys.path.insert(0, str(ROOT / "scripts"))

from ui_slop_scan import scan_path  # noqa: E402


def test_scan_flags_high_confidence_source_smells(tmp_path: Path):
    source = tmp_path / "page.tsx"
    source.write_text(
        """
        export function Page() {
          return <main className="h-screen">
            <a href="#">Learn more</a>
            <p className="text-[10px]">Lorem ipsum John Doe</p>
            <div className="z-[9999] outline-none">X</div>
          </main>
        }
        """,
        encoding="utf-8",
    )

    payload = scan_path(tmp_path)
    ids = {row["rule_id"] for row in payload["findings"]}

    assert {
        "dead-link",
        "lorem-ipsum",
        "placeholder-identity",
        "tiny-text",
        "viewport-height",
        "extreme-z-index",
        "focus-removal",
    }.issubset(ids)
    assert payload["severity_counts"]["warning"] >= 2
    assert "Rendered designer critique" in payload["disclaimer"]


def test_scan_uses_thresholds_for_repeated_aesthetic_patterns(tmp_path: Path):
    source = tmp_path / "cards.tsx"
    source.write_text(
        "\n".join(
            [
                '<span className="rounded-full transition-all animate-bounce">x</span>',
                '<span className="rounded-full transition-all animate-bounce">x</span>',
                '<span className="rounded-full transition-all animate-bounce">x</span>',
                '<span className="rounded-full transition-all">x</span>',
                '<span className="rounded-full">x</span>',
                '<span className="rounded-full">x</span>',
            ]
        ),
        encoding="utf-8",
    )

    payload = scan_path(tmp_path)
    ids = {row["rule_id"] for row in payload["findings"]}

    assert "pill-saturation" in ids
    assert "transition-all-saturation" in ids
    assert "bounce-saturation" in ids
    assert payload["severity_counts"]["warning"] == 0


def test_scan_does_not_turn_single_normal_pattern_into_slop(tmp_path: Path):
    source = tmp_path / "button.tsx"
    source.write_text(
        '<button className="rounded-full transition-colors focus-visible:ring-2">Save</button>\n',
        encoding="utf-8",
    )

    payload = scan_path(tmp_path)

    assert payload["findings"] == []
    assert payload["finding_count"] == 0


def test_inline_suppression_is_scoped_to_rule(tmp_path: Path):
    source = tmp_path / "page.html"
    source.write_text(
        '<a href="#">Placeholder</a> <!-- ui-slop-ignore:dead-link -->\n'
        '<p style="font-size:10px">Metadata</p>\n',
        encoding="utf-8",
    )

    payload = scan_path(tmp_path)
    ids = [row["rule_id"] for row in payload["findings"]]

    assert "dead-link" not in ids
    assert "tiny-text" in ids


def test_cli_json_and_strict_exit_codes(tmp_path: Path):
    source = tmp_path / "page.html"
    source.write_text('<a href="#">Broken</a>\n', encoding="utf-8")

    normal = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "--json"],
        text=True,
        capture_output=True,
        check=True,
    )
    payload = json.loads(normal.stdout)
    assert payload["finding_count"] == 1

    strict = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path), "--strict"],
        text=True,
        capture_output=True,
        check=False,
    )
    assert strict.returncode == 2
    assert "dead-link" in strict.stdout


def test_scan_skips_generated_and_vendor_trees(tmp_path: Path):
    (tmp_path / "node_modules" / "pkg").mkdir(parents=True)
    (tmp_path / "node_modules" / "pkg" / "bad.css").write_text("font-size: 9px", encoding="utf-8")
    (tmp_path / "src").mkdir()
    (tmp_path / "src" / "good.css").write_text(".label { font-size: 14px; }\n", encoding="utf-8")

    payload = scan_path(tmp_path)

    assert payload["files_scanned"] == 1
    assert payload["findings"] == []
