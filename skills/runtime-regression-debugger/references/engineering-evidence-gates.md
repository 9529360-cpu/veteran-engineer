# Risk-Based Engineering Evidence Gates

Use this to decide what evidence is needed before making a completion or release claim. These are defaults, not a substitute for repository policy.

## Contents

- Principle and baseline
- Plan the cheapest sufficient evidence ladder
- Additional gates by risk surface
- Confidence and release decisions

## Principle

Validation strength should track the mechanism and cost of being wrong, not diff size.

A one-line authorization default, migration, routing rule, payment retry, or feature-flag default can require stronger evidence than a thousand-line internal refactor.

## Baseline evidence

For any non-trivial code change, prefer:

- active-path confirmation;
- focused test or characterization of changed behavior;
- complete diff review;
- repository-required static/type/lint/build checks relevant to the path.

## Plan the cheapest sufficient evidence ladder

Start from the material invariant/semantic delta and ask what observation could falsify it. Run the narrowest evidence that can reject the design first, then cross the real boundary where mocks cannot represent the risk. Mark evidence as **required**, **useful**, or **unavailable**; unavailable evidence lowers the completion claim rather than disappearing.

Typical mapping: pure decision logic -> unit/property; public contract -> schema/consumer compatibility; auth/tenant -> positive plus negative isolation; data migration -> mixed-version/resume/data checks; async/external effect -> duplicate/reorder/timeout-after-success; runtime/release -> exact artifact plus lifecycle/canary evidence. Prefer deterministic scheduling, fake clocks, controlled dependency outcomes, and explicit old/new fixtures over arbitrary sleeps. A surprising result is a reason to revisit ownership/assumptions before broadening the suite blindly. Use `scripts/validation_planner.py` only as a deterministic baseline.

## Additional gates by risk surface

### Authorization / multi-tenancy

Require representative positive and negative authorization cases. Exercise cross-tenant/resource confusion where plausible. Verify cache/job/storage scope follows the same authority. Review logs/audit events for leakage or missing attribution.

### Durable data / migrations

Prove old/new coexistence, migration/backfill restartability, constraints/invariants, and behavior at realistic data scale when material. For irreversible steps, name the forward-repair path before cutover.

### Money / stored value / external irreversible effect

Exercise stable idempotency identity, timeout-after-commit/unknown outcome, duplicate webhook/request, reconciliation, exact monetary representation, and auditability. A happy-path provider mock is insufficient evidence.

### Public API / event / persisted schema

Exercise producer/consumer compatibility across the versions that can overlap. Validate additive defaults, unknown fields, old events, and downgrade/rollback behavior where applicable.

### Async / queue / workflow

Exercise redelivery, retry classification, duplicate suppression/idempotency, poison/terminal state, and crash between durable steps where the mechanism allows it.

### Runtime / desktop / browser lifecycle

Exercise reload/navigation/recreation/crash/suspend or account/session replacement relevant to the bug. Validate the packaged runtime when behavior depends on packaging, signing, sandbox, native modules, or embedded browser versions.

### Infrastructure / routing / release

Validate exact rendered/generated config, staged/canary behavior when available, health/readiness semantics, rollback, and public discovery/routing path. Deployment success alone is not user-visible verification.

### Performance / capacity / overload

Use comparable baseline/candidate workloads. Measure the suspected bottleneck and tail behavior. Test saturation/recovery and downstream protection when the change affects concurrency, retries, queues, pools, or rate limits.

### DR / replication / global authority

Require restore/failover/fencing evidence appropriate to the claim. For region or primary changes, prove stale authority cannot continue writing. Backup existence is not restore evidence.

### Security-sensitive parsing/uploads/SSRF/secrets

Use malicious/negative cases around trust boundaries, size/path/content constraints, redirect/network policies, secret exposure, and authorization. Follow repository/security policy for specialized tooling.

## Confidence and release decisions

Do not demand maximum evidence for a reversible low-risk internal change. Do demand stronger evidence when:

- failure corrupts data or money;
- authority/security can be bypassed;
- rollback cannot restore prior state;
- multiple deployed versions must coexist;
- the blast radius is global or fleet-wide;
- the change touches recovery tooling itself;
- the symptom has already survived one or more plausible fixes.

Use `scripts/evidence_gate.py` as a conservative planning aid. Repository-mandated checks override its defaults, and passing the script does not prove correctness.
