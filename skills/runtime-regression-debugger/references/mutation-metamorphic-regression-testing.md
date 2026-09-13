# Mutation and Metamorphic Regression Testing

Use this when a regression test may be too coupled to the implementation, when there is no single exact output oracle, or when a critical invariant deserves stronger proof.

## Contents

- Prove the test can kill the bug
- Use targeted mutation thinking
- Define metamorphic relations
- Avoid meaningless broad mutation scores
- Preserve deterministic failure signals
- Bind properties to invariants

## Prove the test can kill the bug

A regression test is valuable only if the broken mechanism can make it fail. Before trusting a new test, identify the minimal behavior mutation that should violate the protected invariant.

Examples:

- remove tenant filter;
- accept a stale generation;
- execute the side effect twice;
- swap an ordering guard;
- remove uniqueness enforcement;
- skip rollback/cleanup;
- treat timeout as definite failure;
- allow a terminal state to transition again.

You do not need to commit destructive mutations. A temporary local mutation, historical buggy revision, injected fake, or equivalent negative fixture can provide the proof.

## Use targeted mutation thinking

Prefer mechanism-specific mutations over maximizing a global mutation-testing percentage. The question is:

`would this test detect the exact class of defect we claim to prevent?`

Do not spend time killing irrelevant mutations in generated, trivial, or low-risk code.

## Define metamorphic relations

When exact expected output is expensive or undefined, state a relation that must remain true after a controlled input transformation.

Examples:

- replaying the same stable operation ID must not create another logical charge;
- reordering independent input records must not change the resulting set;
- adding an unrelated optional field must not alter authorization;
- retrying after an unknown outcome must converge to the same durable state;
- rebuilding a projection from the same event log must preserve invariant totals.

## Preserve deterministic failure signals

Avoid relations that tolerate broad output drift. Define which dimensions may change and which must remain invariant.

For concurrency/lifecycle bugs, use controlled scheduling rather than "run 100 times and hope."

## Bind properties to invariants

Use `scripts/regression_oracle_gate.py` for a structured check that critical invariants have at least one direct regression oracle and, where appropriate, a mutation or metamorphic challenge. The script checks coverage declarations, not test correctness.
