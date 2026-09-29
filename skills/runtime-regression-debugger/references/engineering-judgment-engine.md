# Engineering Judgment Engine

## Purpose

Before implementation, evaluate whether the requested change is the correct change. The goal is not slower execution; it is reducing expensive wrong execution.

## Judgment Loop

Use:

`request -> intent -> constraints -> system reality -> options -> tradeoffs -> chosen path -> evidence`

A strong implementation starts by understanding the decision, not the file to edit.

## Decision Questions

For consequential work, answer:

1. What user or business outcome is actually being optimized?
2. What existing invariant must not break?
3. What is the smallest change that achieves the outcome?
4. What alternative approaches were rejected and why?
5. What future cost does this choice introduce?
6. What evidence would prove this decision wrong?

## Architecture Judgment

Before adding systems, ask:

- Does an existing owner already exist?
- Is this solving a real observed problem or a hypothetical future problem?
- Does this increase operational ownership?
- Can the same result be achieved with less moving parts?

Prefer:

`existing capability + clear ownership > new abstraction`

## Risk Classification

Classify changes:

- reversible/local: execute with lightweight verification;
- compatibility-sensitive: preserve contracts and test boundaries;
- operationally significant: require rollout, recovery, and observability thinking;
- irreversible: require explicit authorization and stronger evidence.

## Option Competition

For material decisions, compare at least two viable paths:

- immediate implementation;
- alternative implementation or non-code solution.

Reject options based on evidence, not preference.

## Completion Standard

A decision is complete when:

- the chosen path is justified;
- major risks are known;
- validation matches the claim;
- remaining uncertainty is explicit.

The best engineering decision is not always the largest design. It is the smallest justified change that preserves future flexibility.
