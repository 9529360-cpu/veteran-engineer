# Change Entropy and Rollback Paradox

Use this before a medium/high-risk change or release where a small diff crosses several ownership, state, protocol, or deployment boundaries.

## Contents

- Measure semantic spread, not line count
- Estimate change entropy
- Split high-entropy changes
- Progressive exposure and freeze conditions
- Build the old/new compatibility matrix
- Separate code rollback from state recovery
- Detect forward-only transitions
- Choose the safest recovery direction

## Measure semantic spread, not line count

Risk grows when one change spans independently owned failure domains, even when the patch is tiny.

Count material crossings such as:

- authoritative state owners;
- persistence/data-format boundaries;
- async/queue/network boundaries;
- public or inter-service protocol boundaries;
- independently deployed units;
- auth/tenant/security boundaries;
- irreversible external effects;
- important unknowns that remain unproven.

Use `scripts/change_entropy.py` for a rough weighted score. It is a planning aid, not a release policy.

## Estimate change entropy

Interpret a high score as a prompt to ask whether the change can be decomposed, staged, shadowed, or made compatible. Do not inflate ceremony for a high count when the boundaries are already tightly owned and proven.

The useful question is:

`how many independently failing assumptions must all be correct for this change to be safe?`

## Split high-entropy changes

Prefer separating compatibility preparation, durable migration, behavior cutover, exposure, and cleanup when doing so creates independently provable steps.

Do not split a single invariant across commits/deployments if the intermediate state would be unsafe.

## Progressive exposure and freeze conditions

Risk is semantic, not proportional to diff size: a one-line auth, schema, routing, retry, money, or flag-default change can be more dangerous than a large isolated refactor. Assess reversibility/repairability, blast radius, old/new compatibility, invariant observability, synchronized-rollout dependency, load sensitivity, and operator stop/bypass ability.

When architecture permits, expose progressively: one box or test tenant -> internal cohort -> small external cohort -> broader rollout. Gate on user-visible and invariant signals, not process health alone. Pause when critical telemetry is ambiguous, error-budget burn accelerates, divergence grows, or the next step crosses an irreversible boundary without proven recovery.

## Build the old/new compatibility matrix

Before calling a stateful rollout reversible, check the combinations that can exist:

- old code + old data/protocol;
- new code + old data/protocol;
- old code + new data/protocol;
- new code + new data/protocol.

For multi-service rollout, perform the same reasoning across producer/consumer versions.

An unknown matrix cell is a risk, not implied compatibility.

## Separate code rollback from state recovery

Rolling back binaries/config does not undo schema changes, emitted events, external provider calls, cache formats, client updates, or durable user actions.

Define whether recovery requires reconciliation, replay, compensating action, data repair, cache/index rebuild, or roll-forward.

## Detect forward-only transitions

Mark a step forward-only when old code cannot safely interpret state already written by new code or when irreversible side effects have escaped the boundary.

Forward-only is not automatically wrong; pretending it is reversible is wrong.

## Choose the safest recovery direction

During an incident, rollback only when the old version remains compatible with current state. Otherwise prefer the smallest safe forward repair, traffic isolation, feature disablement, or reconciliation path supported by evidence.
