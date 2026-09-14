# Causal Debugging and Experiment Design

Use this when several plausible mechanisms fit the same symptom, especially for regressions, performance incidents, races, retries, or distributed failures.

## Contents

- Turn explanations into competing causal models
- Predict before probing
- Prefer interventions over correlations
- Choose discriminators by information gain and cost
- Control confounders
- Use counterfactual checks
- Stop when the remaining uncertainty cannot change the action

## Turn explanations into competing causal models

Keep at most three active hypotheses. Each must name a mechanism, owner, and observable consequence.

Write them as:

`cause -> mechanism -> predicted observation -> falsifier`

Do not use labels such as "network issue" or "race condition" without stating what should happen if that explanation is true.

## Predict before probing

Before running a command, changing code, clearing state, or restarting a service, write what each active hypothesis predicts for that probe. This prevents post-hoc storytelling.

A useful probe produces different predicted outcomes for different hypotheses. A probe that all hypotheses predict equally is usually low information.

Use `scripts/causal_discriminator.py` when several probes are available and their predicted outcomes, cost, and blast radius can be stated explicitly. Mark a probe `irreversible: true` when it cannot be safely undone and `production_wide: true` when it changes a broad live-production boundary. Those probes are scored for comparison but are kept in `escalation_only_probes`, never `ranked_probes` or `recommended_probe`. If no reversible bounded probe exists, the discriminator returns a blocked status rather than recommending a destructive experiment. Authorization and action-threshold decisions remain separate; a high information score never creates permission.

The discriminator fails closed on ambiguous safety/ranking metadata such as string booleans, negative/non-finite cost or blast radius, duplicate probe ids, and prediction keys that do not name an active hypothesis. Its ranking is still only as good as the declared hypotheses and predictions.

## Prefer interventions over correlations

A correlated metric is evidence, not causation. Prefer bounded interventions that change one mechanism while preserving the rest of the system:

- freeze or delay one completion;
- disable one cache layer for a controlled request;
- pin one dependency version;
- force one retry/redelivery;
- hold one lock/lease;
- run the same input through old and new code;
- replay one captured event into an isolated consumer.

Do not perform destructive or production-wide interventions merely to get stronger evidence.

## Control confounders

Change one meaningful variable at a time where practical. Record environment, exact revision, input, seed/clock, dependency state, and relevant generation/tenant identity.

If a probe changes several variables at once, state which conclusions it cannot support.

## Use counterfactual checks

After a candidate root cause appears strong, ask what should be observed if that cause were absent. If the counterfactual prediction contradicts reality, the model is incomplete.

For a patch, ask whether disabling or reversing only the proposed mechanism reintroduces the failure. This is stronger than "the test passed after my change."

## Distinguish cause from amplifier

An overloaded queue, high CPU, or retry storm may amplify a bug without owning it. Separate:

`trigger -> root mechanism -> amplifier -> visible symptom`

Fix the owner required by the contract, then bound amplifiers that can recreate unsafe conditions.

## Stop deliberately

Stop causal investigation when one mechanism explains the evidence, competing hypotheses are falsified enough for the risk level, and additional evidence cannot change the safe action. For irreversible or security-sensitive actions, require stronger falsification before stopping.
