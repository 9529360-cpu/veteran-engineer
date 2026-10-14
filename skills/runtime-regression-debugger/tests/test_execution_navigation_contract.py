import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from engineering_context_router import route_signals  # noqa: E402


def selected(signal):
    payload = route_signals(signal, 4)
    assert payload["unmatched_signals"] == []
    return {item["path"] for item in payload["references"]}


def test_command_transport_routes_only_for_real_command_hops():
    target = "references/command-transport-integrity.md"
    assert target in selected("powershell-wsl")
    assert target in selected("native-argument-truncation")
    assert target in selected("script-handoff")
    assert target not in selected("bug")
    assert target not in selected("desktop")
    assert "references/host-shell-platform-patterns.md" not in selected("powershell-wsl")


def test_semantic_navigation_optional_and_lazy():
    target = "references/semantic-code-navigation.md"
    assert target in selected("code-intelligence")
    assert target in selected("symbol-navigation")
    assert target in selected("lsp")
    assert target not in selected("bug")
    assert target not in selected("frontend-redesign")
    assert "references/frontend-product-patterns.md" not in selected("symbol-navigation")


def test_transport_and_semantics_do_not_replace_engineering_owner():
    active = selected("powershell-wsl,code-intelligence")
    assert "references/command-transport-integrity.md" in active
    assert "references/semantic-code-navigation.md" in active
    skill = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    transport = (ROOT / "references" / "command-transport-integrity.md").read_text(encoding="utf-8")
    semantic = (ROOT / "references" / "semantic-code-navigation.md").read_text(encoding="utf-8")
    assert "references/command-transport-integrity.md" in skill
    assert "references/semantic-code-navigation.md" in skill
    assert "target-visible byte count and SHA-256" in transport
    assert "Get-FileHash" in transport and "wsl.exe --exec" in transport
    assert "independent postcondition evidence" in transport
    assert "graphical IDE is **optional**" in semantic
    assert "the same workspace" in semantic
    assert "preview the full write set" in semantic


def test_studio_version_and_keywords_follow_skill_change():
    plugin = json.loads((ROOT.parent.parent / "plugin.json").read_text(encoding="utf-8"))
    assert plugin["version"] == "1.14.28"
    assert {"command-transport", "semantic-code-navigation"}.issubset(set(plugin["keywords"]))
