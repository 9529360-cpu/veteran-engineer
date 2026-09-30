from skills.runtime_regression_debugger.scripts.mutation_intent_gate import Mutation, validate_mutation


def test_accepts_meaningful_repository_change():
    assert validate_mutation(
        Mutation("update_file", "src/service.py", "fix runtime behavior")
    ) == []


def test_rejects_probe_files():
    errors = validate_mutation(
        Mutation("create_file", ".tmp-check.txt", "debug")
    )
    assert errors


def test_requires_reason():
    errors = validate_mutation(
        Mutation("update_file", "src/app.py", "")
    )
    assert errors
