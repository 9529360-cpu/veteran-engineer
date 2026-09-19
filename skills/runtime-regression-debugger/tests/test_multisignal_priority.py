import itertools
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from engineering_context_router import ALIASES, ROUTES, route_signals  # noqa: E402


def ref_paths(payload):
    return [item["path"] for item in payload["references"]]


def deferred_paths(payload):
    return [item["path"] for item in payload["deferred_references"]]


def deferred_signals(payload):
    return [item["signal"] for item in payload["deferred_signals"]]


def test_every_single_canonical_signal_preserves_its_direct_route_contract():
    for signal, expected in ROUTES.items():
        payload = route_signals(signal, 7)
        assert payload["signals"] == [signal]
        assert payload["unmatched_signals"] == []
        assert payload["primary_signal"] == signal
        assert payload["primary_reference"] == expected[0]
        assert ref_paths(payload) == expected
        assert deferred_paths(payload) == []
        assert payload["truncated"] is False


def test_every_alias_preserves_the_canonical_single_signal_route_contract():
    for alias, canonical in ALIASES.items():
        payload = route_signals(alias, 7)
        assert payload["signals"] == [canonical]
        assert payload["unmatched_signals"] == []
        assert ref_paths(payload) == ROUTES[canonical]


def test_design_security_migration_release_has_one_design_owner_and_future_stage_queue():
    payload = route_signals("product-design,security,migration,release", 7)
    assert payload["primary_signal"] == "product-design"
    assert payload["primary_stage"] == "design"
    assert payload["primary_reference"] == "references/frontend-product-patterns.md"
    assert set(payload["active_signals"]) == {"product-design", "security"}
    assert set(deferred_signals(payload)) == {"migration", "release"}
    assert "references/security-multitenancy-patterns.md" in ref_paths(payload)
    assert "references/data-consistency-migration-patterns.md" in deferred_paths(payload)
    assert "references/release-promotion-patterns.md" in deferred_paths(payload)
    assert all(item["deferred_by"] == "stage" for item in payload["deferred_references"])


def test_diagnostic_owner_keeps_failing_mechanisms_active_even_when_they_look_like_later_stages():
    payload = route_signals("bug,async,desktop,ai-product", 7)
    assert payload["primary_signal"] == "bug"
    assert payload["primary_stage"] == "diagnostic"
    assert payload["deferred_signals"] == []
    assert payload["deferred_references"] == []
    assert "references/async-edge-job-patterns.md" in ref_paths(payload)
    assert "references/runtime-lifecycle-patterns.md" in ref_paths(payload)
    assert "references/ai-llm-product-engineering.md" in ref_paths(payload)



def test_explicit_debugging_or_regression_advances_review_into_diagnostic_owner():
    for wording in ("debugging", "regression", "regression-debugging"):
        payload = route_signals(f"review,{wording}", 7)
        assert payload["signals"] == ["review", "bug"]
        assert payload["unmatched_signals"] == []
        assert payload["primary_signal"] == "bug"
        assert payload["primary_stage"] == "diagnostic"
        assert set(payload["active_signals"]) == {"review", "bug"}
        assert "references/causal-debugging-experiment-design.md" in ref_paths(payload)
        assert "references/code-review-patterns.md" in ref_paths(payload)


def test_requirements_owner_keeps_billing_and_auth_constraints_but_defers_frontend_implementation():
    payload = route_signals("product-requirements,subscription-billing,auth,frontend", 7)
    assert payload["primary_signal"] == "product-requirements"
    assert payload["primary_stage"] == "requirements"
    assert set(payload["active_signals"]) == {"product-requirements", "subscription-billing", "auth"}
    assert deferred_signals(payload) == ["frontend"]
    assert "references/subscription-billing-entitlements-product-engineering.md" in ref_paths(payload)
    assert "references/security-multitenancy-patterns.md" in ref_paths(payload)
    assert "references/frontend-product-patterns.md" not in ref_paths(payload)
    assert "references/frontend-implementation-patterns.md" in deferred_paths(payload)


def test_incident_owner_does_not_hide_migration_or_external_provider_failure_context():
    payload = route_signals("incident,migration,external", 7)
    assert payload["primary_signal"] == "incident"
    assert payload["primary_stage"] == "incident"
    assert payload["deferred_signals"] == []
    assert "references/incident-command-uncertainty.md" in ref_paths(payload)
    assert "references/data-consistency-migration-patterns.md" in ref_paths(payload)
    assert "references/dependency-outcome-degradation.md" in ref_paths(payload)


def test_explicit_fullstack_advances_accepted_design_into_implementation_without_loading_review():
    payload = route_signals("product-design,fullstack", 7)
    assert payload["primary_signal"] == "fullstack"
    assert payload["primary_stage"] == "implementation"
    assert payload["deferred_signals"] == []
    assert ref_paths(payload) == [
        "references/full-stack-product-engineering.md",
        "references/frontend-product-patterns.md",
    ]
    assert "references/visual-ui-quality-assurance-product-engineering.md" not in ref_paths(payload)


def test_stage_arbitration_is_order_invariant_for_representative_mixed_signal_sets():
    scenarios = [
        ("product-design", "security", "migration", "release"),
        ("bug", "async", "desktop", "ai-product"),
        ("product-requirements", "subscription-billing", "auth", "frontend"),
        ("incident", "migration", "external"),
    ]
    for signals in scenarios:
        baseline = route_signals(",".join(signals), 7)
        expected = (
            baseline["primary_signal"],
            baseline["primary_stage"],
            set(ref_paths(baseline)),
            set(deferred_paths(baseline)),
            set(deferred_signals(baseline)),
        )
        for permutation in itertools.permutations(signals):
            payload = route_signals(",".join(permutation), 7)
            observed = (
                payload["primary_signal"],
                payload["primary_stage"],
                set(ref_paths(payload)),
                set(deferred_paths(payload)),
                set(deferred_signals(payload)),
            )
            assert observed == expected, (signals, permutation, observed, expected)


def test_budget_deferral_is_distinct_from_stage_deferral():
    payload = route_signals("product-design,security,migration,release", 1)
    assert payload["truncated"] is True
    assert payload["has_deferred"] is True
    by_path = {item["path"]: item["deferred_by"] for item in payload["deferred_references"]}
    assert by_path["references/security-multitenancy-patterns.md"] == "budget"
    assert by_path["references/data-consistency-migration-patterns.md"] == "stage"
    assert by_path["references/release-promotion-patterns.md"] == "stage"


def test_all_canonical_signal_pairs_preserve_owner_partition_invariants():
    for left, right in itertools.combinations(sorted(ROUTES), 2):
        payload = route_signals(f"{left},{right}", 7)
        active_signals = set(payload["active_signals"])
        deferred_signal_set = {item["signal"] for item in payload["deferred_signals"]}
        active_refs = set(ref_paths(payload))
        deferred_refs = set(deferred_paths(payload))
        assert payload["primary_signal"] in active_signals, (left, right, payload)
        assert active_signals.isdisjoint(deferred_signal_set), (left, right, payload)
        assert active_signals | deferred_signal_set == set(payload["signals"]), (left, right, payload)
        assert active_refs.isdisjoint(deferred_refs), (left, right, payload)
        assert payload["primary_reference"] in active_refs, (left, right, payload)
        assert payload["candidate_count"] == len(active_refs | deferred_refs), (left, right, payload)
        budget_deferred = any(item["deferred_by"] == "budget" for item in payload["deferred_references"])
        assert payload["truncated"] is budget_deferred, (left, right, payload)
        assert payload["has_deferred"] is bool(deferred_refs), (left, right, payload)
        if payload["primary_stage"] in {"diagnostic", "incident"}:
            assert deferred_signal_set == set(), (left, right, payload)


def test_byte_budget_bounds_all_canonical_signal_pairs_without_losing_primary_owner():
    budget = 65536
    for left, right in itertools.combinations(sorted(ROUTES), 2):
        payload = route_signals(f"{left},{right}", 4, budget)
        active = set(ref_paths(payload))
        deferred = set(deferred_paths(payload))
        assert payload["primary_reference"] in active, (left, right, payload)
        assert active.isdisjoint(deferred), (left, right, payload)
        assert payload["candidate_count"] == len(active | deferred), (left, right, payload)
        # A future single reference may legitimately exceed the soft byte budget;
        # otherwise the selected working set must remain bounded.
        primary_bytes = next(item["bytes"] for item in payload["references"] if item["path"] == payload["primary_reference"])
        assert payload["selected_reference_bytes"] <= max(budget, primary_bytes), (left, right, payload)
        if payload["active_candidate_bytes"] > budget and len(active | deferred) > 1:
            assert any(item["deferred_by"] in {"bytes", "budget", "stage"} for item in payload["deferred_references"]), (left, right, payload)
