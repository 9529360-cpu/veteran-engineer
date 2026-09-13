# Decision Compression and Engineering Learning Loop

Use this when symptoms are ambiguous, previous fixes failed, the change surface is large, or many plausible checks compete for attention.

## Contents

- Compress the problem before expanding the investigation
- Maintain a bounded hypothesis and assumption ledger
- Learn from failed attempts inside the task
- Classify failed attempts by behavioral equivalence
- Escalate after repeated failure
- Revalidate the harness and environment
- Stop investigating when the decision is already determined
- Distinguish confidence from action threshold

## Compress the problem before expanding the investigation

A veteran engineer does not inspect everything. Reduce the situation to:

`contract -> invariant -> failing transition -> likely owner -> cheapest discriminator -> stop condition`

Rank probes by expected information gain divided by cost and blast radius. Prefer one observation that separates several hypotheses over many low-value logs.

## Maintain a bounded hypothesis ledger

Keep at most three active hypotheses. For each record:

- mechanism;
- evidence for and against;
- cheapest falsifier;
- risk if wrong;
- next action if confirmed.

When evidence falsifies a hypothesis, retire it. Do not silently mutate it until it becomes unfalsifiable.

## Track decision-sensitive assumptions explicitly

Separate **fact** (direct evidence), **inference** (best explanation), and **assumption** (required but unproven premise). Only track assumptions that can change the design or safe action. Attach a falsifier, evidence source/identity, scope, and freshness/expiry trigger when environment or version drift matters. After contradictory evidence, retire the assumption rather than quietly rephrasing it. Use `scripts/assumption_ledger.py` when several hidden premises interact; by itself it is task-local discipline, not durable self-learning. If an authorized plugin backend provides persistent project memory, promote only reviewed scoped lessons under `engineering-experience-governance.md`; current evidence must still override stored experience.

## Learn from failed attempts inside the task

After every attempted fix or mitigation that fails, record:

`attempt -> assumption it depended on -> observed result -> new evidence -> assumption now forbidden`

Do not repeat a behaviorally equivalent patch under a different name. A failed candidate must change the investigation model, not merely the code diff.

For long investigations, use `scripts/engineering_journal.py` and give failed attempts an `--equivalence-class` when a useful class is evident.

## Classify failed attempts by behavioral equivalence

Two patches are behaviorally equivalent when they depend on the same unproven mechanism even if they touch different files.

Examples:

- adding another UI refresh and adding a second listener can both belong to `presentation-resync`;
- increasing a timeout and retrying more often can both belong to `dependency-will-eventually-succeed`;
- clearing two different caches can both belong to `stale-cache-is-authority`;
- moving a lock and widening a transaction can both belong to `serialization-will-fix-ownership`.

Use equivalence classes to prevent patch roulette. Do not create artificial taxonomy when the relationship is not clear.

## Escalate after repeated failure

Use failure count as a trigger to question the model, not as proof of a specific root cause.

After the **first** meaningful failed candidate:

1. name the failed assumption;
2. capture contrary evidence;
3. forbid the equivalent patch class if justified;
4. choose a discriminator before another change.

After **two behaviorally equivalent** failed candidates or two candidates with the same symptom and no new mechanism evidence:

1. stop layering fixes;
2. reconstruct active callers, authority, lifecycle, and dataflow;
3. inspect whether another writer/generation/cache/worker/client version owns the behavior;
4. instrument the real transition if runtime evidence is weak.

After **three materially failed attempts**:

1. re-establish the execution environment and exact build/data scope;
2. verify the test/reproduction harness can still detect the original failure;
3. re-prove the active path and authoritative owner;
4. revisit Git history/upstream behavior if hidden compatibility is plausible;
5. shrink the hypothesis set before writing more behavior-changing code.

Run `scripts/engineering_journal.py <journal> assess` as a conservative deterministic reminder. It cannot determine the root cause; its purpose is to prevent endless same-model patching.

## Revalidate the harness and environment

A failed candidate does not always mean the candidate mechanism is wrong. The validation environment can also be wrong.

Check:

- exact source/build identity;
- stale generated code or artifacts;
- wrong test selection;
- missing service/dependency;
- different config/feature flags;
- polluted database/cache/profile state;
- unsupported runtime/toolchain version;
- flaky timing or non-deterministic fixture;
- test path that bypasses the real owner.

Do not "fix" product code to satisfy a broken harness. Conversely, do not dismiss a real product failure as environment noise without evidence.

## Stop investigating when the decision is already determined

Additional evidence has diminishing value. Stop when one of these is true:

- a low-risk reversible fix is clearly justified and remaining uncertainty does not change it;
- a high-risk action lacks enough evidence and a safer containment step exists;
- the real blocker is product/risk authorization rather than technical uncertainty;
- the next probe costs more than the plausible improvement in decision quality;
- evidence shows the requested local change belongs to an upstream/other-owner boundary and a local workaround would create worse long-term risk;
- the contract is satisfied and remaining work is unrelated modernization or polish.

## Distinguish confidence from action threshold

High confidence is not always required for reversible containment. Very high confidence may be required for destructive data repair, irreversible migration, money movement, credential rotation, or cross-region authority changes.

Report what evidence would change the decision, not merely a confidence adjective. Calibrate the next action to reversibility, blast radius, and the cost of being wrong.
