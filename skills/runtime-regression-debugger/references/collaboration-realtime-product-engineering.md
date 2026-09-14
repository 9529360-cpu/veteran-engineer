# Collaboration and realtime product engineering

Use this when users, devices, tabs, or processes can observe or mutate shared state with low-latency updates, presence, optimistic UI, offline work, or reconnect/resume behavior. Realtime is a consistency and user-trust contract, not “add WebSockets”.

`actor -> current authorization -> authoritative shared-state transition -> committed version/order -> publication -> local reconciliation -> visible result or recovery`

For local UI ownership use `frontend-product-patterns.md`; for durable concurrency use `data-consistency-migration-patterns.md` and `distributed-systems-consistency.md`; for permission boundaries use `security-multitenancy-patterns.md`. Add async/messaging machinery only when the actual mechanism needs it.

## Keep one durable authority

Realtime messages, browser stores, caches, presence, and optimistic state are projections unless the architecture explicitly makes them authoritative.

A durable mutation should preserve:

`stable operation identity -> trusted authorization -> authoritative mutation -> committed revision -> publication`

The broadcast layer must not become a second writer. Seeing an echoed message does not prove commit unless it is bound to authoritative commit/version identity. If several legitimate writers exist, define reconciliation at that ownership boundary instead of letting network arrival order decide truth.

## Operation identity is not transport identity

Retries, reconnects, and lost acknowledgements can repeat transport. Preserve one domain operation id across those attempts when duplicate effects matter. Keep actor/tenant/object identity, base/precondition when required, client/session generation, and authoritative resulting revision where they affect correctness.

A new socket must not turn one logical comment, reaction, edit, membership change, or other mutation into a second effect. Timeout after commit is an unknown outcome: reconcile by operation id or authoritative state before minting another logical operation.

## Versions and ordering outrank packet arrival

Do not infer total order from “last packet received” unless one authority actually assigns that order. Use the smallest model the domain needs: snapshot/version, per-object monotonic revision, ordered stream, causal relation, commutative operations, or explicit conflict.

Clients reject, ignore, or reconcile stale publications using authoritative version/generation evidence. A detected gap must trigger bounded replay/resume or snapshot resync rather than silently continuing from stale local state.

## Optimistic UI is speculative

Model optimistic work as:

`local pending operation -> authoritative accept/reject/transform/unknown -> reconcile -> terminal visible state`

Keep pending identity distinct from another actor's change and from the authoritative echo. If the server normalizes or merges the operation, replace speculation with the committed representation. Do not remove optimistic state blindly on timeout when the write may already have committed.

## Presence is ephemeral and expires

Presence, cursors, typing, and similar high-frequency signals are normally bounded projections. Define scope, account versus device/session identity, heartbeat/lease/expiry, reconnect generation, visibility, multi-device behavior, fan-out limits, and crash/partition expiry.

A clean leave event is not guaranteed. Presence that cannot expire is eventually false durable-looking state.

## Conflict policy earns merge complexity

Recover product semantics before selecting CRDT, OT, locks, or another merge system. Simple records often need only conditional versions plus a visible conflict/reload path. Rich long-offline shared documents may justify heavier merge machinery when user intent and convergence requirements demand it.

If CRDT/OT is actually required, its operation validation, authorization, schema/version migration, compaction/snapshotting, tombstone lifecycle, and interoperability become real responsibilities; the merge algorithm does not solve them automatically.

## Reconnect and offline work re-establish authority

A connection is not identity or authorization. Reconnect should re-establish principal, tenant/object scope, subscription/session generation, last authoritative cursor/version, and pending operation identities; then resume, replay bounded history, fetch a fresh snapshot, or reconcile unknown outcomes as the contract requires.

Offline queues need explicit operation classes. Persist only work that must survive process exit, bind it to account/tenant/object/base-version identity, and re-check current authorization/version before commit. Logout or account switch must not submit an old queue under a new identity. “Was allowed when queued” is not current permission.

## Permissions can change while connected

Authorize every consequential read/write at the trusted owner even when the subscription was previously authorized. Membership removal, role downgrade, object visibility changes, suspension, token/session revocation, and deletion/archive must invalidate or generation-guard affected subscriptions and future operations.

Revocation messages can improve latency, but they are not the authorization boundary because they can be delayed or dropped.

## Bound fan-out and backpressure

Bound connections/subscriptions, reconnect rate, queued bytes/messages, high-frequency projections, replay windows, and snapshot size by the real bottleneck.

Ephemeral presence can often be coalesced or dropped. Durable update gaps generally require disconnect/resync or another explicit recovery signal; do not hide loss behind an apparently live connection or allow unbounded per-client queues.

Multiple tabs/devices need stable account identity plus session/device/tab generation when stale callbacks from replaced instances could mutate or project current state incorrectly.

## Compatibility, observability, and validation

Long-lived connections create mixed-version overlap. Evolve wire/document schemas additively or negotiate explicit versions until supported old clients are retired. Separate storage migration from wire compatibility. Code rollback must not undo other users' already committed valid operations.

Correlate safe operation id, object identity when appropriate, authoritative revision, connection/session generation, reconnect/resync, conflict/unknown outcome, backpressure, presence expiry, stale-generation rejection, and permission revocation without logging sensitive shared content.

Use tests that can falsify the changed mechanism: concurrent writes, duplicate retry, lost acknowledgement, out-of-order/repeated publications, reconnect gaps, offline work after account/permission change, presence crash/expiry, permission revocation while subscribed, slow consumers, multi-device replacement, server-transformed optimistic data, and mixed-version clients.

A green WebSocket or two browser windows updating live is not evidence of collaboration correctness. The useful oracle is that authoritative durable state and revision converge, every client can detect/recover gaps or conflicts, stale operations cannot regain authority, and pending/offline/degraded UI remains truthful.
