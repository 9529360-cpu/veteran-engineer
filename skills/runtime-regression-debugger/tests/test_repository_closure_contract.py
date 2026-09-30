import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent.parent


def test_repository_closure_is_the_workspace_default():
    skill = (ROOT / "SKILL.md").read_text()
    autonomous = (ROOT / "references" / "autonomous-repository-engineering.md").read_text()

    assert "authoritative online repository and its control plane" in skill
    assert "### Close the authoritative online repository loop" in skill
    assert "A green check on an older head is historical evidence only." in skill
    assert "A head change invalidates exact-head CI/review evidence" in skill
    assert "merge is not completion" in skill
    assert "durable experience capture or Skill self-modification is **not** part of ordinary repository completion" in skill
    assert "implemented -> focused-validated -> PR-ready -> exact-head-green -> merged -> main-validated" in skill

    assert "## Close the authoritative online repository loop" in autonomous
    assert "Bind proof to the current head" in autonomous
    assert "Refresh after every consequential remote mutation" in autonomous
    assert "Keep online repo work online by default" in autonomous
    assert "Do not make experience capture a completion gate" in autonomous
    assert "expected-head protection" in autonomous
    assert "Do not make the user repeatedly say \"continue\"" in autonomous
    assert "do not behave like a passive ticket executor" in autonomous


def test_workspace_plugin_metadata_is_repo_first():
    plugin = json.loads((REPO_ROOT / "plugin.json").read_text())
    assert plugin["version"] == "1.14.27"
    assert "Repository-first" in plugin["description"]
    keywords = set(plugin["keywords"])
    assert {"github", "repository", "pull-request", "ci", "exact-head", "repository-closure"}.issubset(keywords)
    assert "foreground-continuation" in keywords
    assert not {"remote-machine", "terminal", "cross-device"}.intersection(keywords)
    interface = plugin["extensions"]["com.openai"]["interface"]
    long_description = interface["longDescription"]
    assert "hosted repository/control plane as the default authority" in long_description
    assert "Local desktop or machine execution is optional evidence only" in long_description
    default_prompts = "\n".join(interface["defaultPrompt"])
    assert "After a merged or main-validated repository slice" in default_prompts
    assert "do not stop at status-only reporting" in default_prompts
