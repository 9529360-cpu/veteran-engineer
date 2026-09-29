from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_engineering_judgment_is_wired_into_the_kernel():
    skill = (ROOT / "SKILL.md").read_text()
    judgment = (ROOT / "references" / "veteran-engineering-judgment.md").read_text()

    assert "### Run Engineering Judgment before consequential implementation" in skill
    assert "**Judgment** - when the consequential-change trigger is active" in skill
    assert "engineering judgment lock (when consequential)" in skill
    assert "Compare at least two genuinely viable options" in skill
    assert "Keep trivial/local/reversible edits fast" in skill
    assert "reopen the decision" in skill
    assert "references/veteran-engineering-judgment.md" in skill

    assert "Engineering Decision Record" in judgment
    assert "problem/outcome | current reality | invariants + non-goals" in judgment
    assert "Evidence-backed no-change is a legitimate engineering result." in judgment
    assert "Tiny/local/reversible changes with one obvious evidence-backed owner do not need ceremony" in judgment
    assert "Risk follows consequence, not diff size." in judgment
    assert "Do not call a path reversible merely because code rollback exists." in judgment
    assert "Pre-mortem high-risk choices before lock-in" in judgment
    assert "Define exit criteria for temporary complexity" in judgment
    assert "reversibility + consequence" in skill
    assert "pre-mortem the few failure modes that can change the decision" in skill
