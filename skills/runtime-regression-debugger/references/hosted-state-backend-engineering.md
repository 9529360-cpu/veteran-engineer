# Hosted State Backend Engineering

Use this reference when adding, replacing, reviewing, or debugging a durable state backend for a plugin/control-plane runtime, especially with multiple processes, hosts, or database connections.

## Preserve one layered contract

Model persistence capability in layers instead of letting storage details leak through the runtime:

1. **Base state contract** - initialize, read, mutate transactionally, record timeline/audit evidence, expose execution-local artifact/worktree roots.
2. **Transaction contract** - return an opaque revision and support compare-and-commit. A stale expected revision must fail before state or audit mutation.
3. **Durable-outcome contract** - expose reconciliation for writes whose acknowledgement is ambiguous. The caller must be able to distinguish known success, known failure, and unknown outcome.

Require hosted and local backends to pass the same reusable conformance suites. Backend-specific tests add failure modes; they do not replace shared semantics.

## Put authority at the durable boundary

For a database-backed implementation, serialize competing writers at the database boundary, not only with an in-process mutex. Two processes or two connection pools targeting the same durable identity must observe one mutation order.

Prefer:

`per-identity DB lock/lease -> row lock -> verify revision -> mutate copy -> state + audit in one DB transaction -> commit`

Use the database's real transaction and locking primitives. Keep revisions opaque to callers even if the implementation uses a counter internally.

Do not claim distributed safety from same-process concurrency tests. Prove at least two independently constructed backend instances or connection pools against the same durable identity.

## Treat COMMIT acknowledgement loss as an unknown outcome

A client error after sending `COMMIT` does not prove rollback. Blind retry can duplicate an irreversible mutation.

Assign each durable mutation a stable commit identity before commit. Bind state and audit/evidence to that identity. If commit acknowledgement is lost:

1. discard or quarantine the uncertain connection when the driver permits it;
2. reconnect through an independent connection;
3. query durable evidence by commit identity;
4. return the original result only when exactly one matching committed record is proven;
5. return known-not-applied only when durable evidence proves absence under a safe authority boundary;
6. otherwise surface an explicit unknown outcome and forbid blind replay.

Application request idempotency must stay conservative above this layer. A handler that may already have committed becomes `unknown`, not falsely `failed`.

## Reconcile only what can be proven

Recovery is not permission to rewrite history.

- Repair a missing latest audit/evidence record only when current durable state carries enough commit identity and payload to reconstruct it exactly.
- Make repair idempotent and prove it appends at most once.
- Accept an already-present matching record without duplication.
- Fail closed on hash-chain corruption, mismatched commit identity, duplicate commit identity, schema mismatch, or ambiguous earlier history.
- Keep reconciliation under the same per-identity serialization boundary as ordinary writes.

## Keep ordering types honest

Do not cast ordered numeric identifiers to text and then order by the alias. Lexical order changes `1, 2, 10` into `1, 10, 2` and can create false corruption signals or replay order bugs.

Order using the authoritative database column/type. Convert only after ordering when an API needs a string representation. Add a regression case that crosses the single-digit boundary.

## Validate with real failure-shaped evidence

A hosted backend is not validated by mocks alone. Cover:

- real engine startup and schema bootstrap;
- base and compare-and-commit conformance;
- simultaneous writers from independent backend instances/pools;
- stale revision rejection with no state/audit mutation;
- commit acknowledgement loss and commit-identity reconciliation;
- missing latest audit repair exactly once;
- tamper/mismatch rejection;
- restart/reopen behavior;
- selection through the real application/protocol path, not only direct class calls.

Pin disposable CI engines by immutable image digest when practical. Bind evidence to the exact source/commit under test.

## Keep optional hosted capabilities explicit

Do not destabilize a verified baseline dependency graph merely to make an optional backend look automatic.

- Pin the hosted driver/version when compatibility depends on it.
- Fail closed when the selected capability is missing or version-drifted.
- Regenerate lockfiles with the real package manager; never hand-edit integrity metadata.
- Preserve optional runtime capabilities across repair/upgrade if the installer intentionally preserves the dependency tree.
- Decide whether to promote an optional driver into the base release graph as a separate distribution/versioning decision.

## Make recovery seeds executable contracts

If the Skill or product carries a bundled recovery starter, generated mirror, template runtime, or vendored checkpoint, prevent silent drift with an executable parity gate.

Compare the authoritative runtime and recovery copy at the appropriate strength: byte-for-byte for deliberately mirrored source/config/tests, or a deterministic semantic comparison for generated artifacts. A change to one side without the other must fail normal validation.

## Run a convergence pass after a milestone

After a large persistence/runtime milestone, stop adding features and review the whole change as a system:

`authority -> state transitions -> concurrency -> unknown outcomes -> audit/recovery -> dependency graph -> recovery mirrors -> docs -> real gates`

Use failures found during convergence to strengthen prevention. Prefer a permanent regression test, integrity check, or parity gate over a prose-only warning. Record deliberate deferrals separately from correctness gaps so the next session does not reopen closed work by accident.
