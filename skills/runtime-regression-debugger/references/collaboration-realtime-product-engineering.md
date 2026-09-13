# Collaboration and realtime product engineering

Use this when multiple users, devices, tabs, or processes can observe or mutate shared product state with low-latency updates, presence, collaborative editing, comments/reactions, live status, optimistic UI, or offline/reconnect behavior. Treat realtime collaboration as a consistency and user-trust contract, not as “add WebSockets”.

## Compile the collaboration contract

Start from the shared fact and visible outcome:

`actor -> authorized operation -> authoritative shared state transition -> ordered/versioned publication -> local reconciliation -> visible shared result or recovery`

Capture only decisions that change implementation:

- authoritative owner of each durable shared fact;
- operation identity, version/precondition, ordering and duplicate semantics;
- which state is durable versus ephemeral presence/projection;
- transport delivery guarantees and reconnect/resume behavior;
- optimistic UI ownership and rollback/reconciliation;
- concurrent edit/conflict semantics;
- offline mutation policy and resubmission identity;
- permission changes while sessions are active;
- fan-out/backpressure and stale client behavior;
- multi-tab/multi-device identity and session generation;
- observability and validation under reorder, duplicate, delay and disconnect.

Do not choose CRDT, OT, event sourcing, locks, or a new broker before recovering the actual conflict and availability contract. Many collaboration flows need only conditional updates plus broadcast projections.

## Keep one durable authority

Realtime messages, local caches, browser stores and presence services are projections unless the architecture explicitly makes them authoritative.

For a durable shared fact, preserve:

`client intent -> trusted authorization -> authoritative mutation -> committed version -> publication`

Do not let the broadcast layer become a second writer. A client seeing its own echoed message does not prove the mutation committed unless the protocol binds the message to authoritative commit identity.

If the product has more than one legitimate writer, define reconciliation/version semantics at that ownership boundary rather than letting last network arrival win accidentally.

## Give operations stable identity

Retryable or reconnectable mutations need stable identity when duplicates are possible.

Useful fields can include:

- operation/request id;
- actor/tenant/object id;
- base version or causal predecessor when required;
- client/session generation;
- authoritative resulting version/revision;
- server commit/event id.

A reconnect that resends an operation must not create a second comment, reaction, payment-like effect, membership change, or document mutation merely because the socket is new.

Separate transport message ids from domain operation ids. Repacking the same durable operation onto a new connection should not change its idempotency identity.

## Ordering, versions and stale clients

Never infer total order from arrival time across clients unless one authority actually assigns that order.

Decide which model the product needs:

- latest authoritative snapshot/version;
- per-object monotonic revision;
- append-only ordered stream;
- causal relation between operations;
- commutative operations where order is intentionally irrelevant;
- explicit conflict when concurrent writes cannot be safely merged.

Clients should reject or reconcile stale publications using authoritative version/generation evidence. “The last packet received wins” can regress state after reconnect or cross-region delay.

When events can arrive out of order, define whether the client buffers, refetches snapshot state, applies only newer versions, or uses a domain-specific merge.

## Optimistic UI is a speculative projection

Optimistic rendering improves latency but does not change authority.

Model:

`local speculative operation -> pending identity -> authoritative accept/reject/transform -> reconcile -> terminal visible state`

Keep enough identity to distinguish:

- pending local mutation;
- authoritative echo of that mutation;
- another actor's concurrent change;
- server-normalized/transformed result;
- rejection/authorization loss;
- timeout/unknown outcome.

Do not simply “remove optimistic item on error” when the authoritative result may already have committed. Unknown outcome needs reconciliation by operation id or a fresh authoritative snapshot.

If the server transforms or merges the operation, replace speculative state with the committed representation instead of assuming the local draft is canonical.

## Presence is ephemeral state with explicit expiry

Presence usually answers “who appears active here now?” and should not silently become durable business truth.

Define:

- presence scope (workspace/document/channel/view);
- stable actor identity versus per-device/session identity;
- join/heartbeat/leave/expiry semantics;
- reconnect generation;
- visibility/privacy rules;
- how multiple tabs/devices collapse or remain distinct;
- stale presence expiry under crash/network partition.

A missing disconnect event is normal. Use leases/heartbeats/expiry or equivalent bounded freshness rather than requiring perfect leave delivery.

Cursor/selection/typing indicators are high-frequency projections. Bound rate, payload size, lifetime and fan-out; do not persist them as audit history unless the product explicitly needs that.

## Concurrent editing and conflict policy

Recover the domain before choosing merge technology.

For each shared object/field, ask:

- can concurrent operations commute safely;
- can one operation be conditionally rejected on stale version;
- can fields merge independently;
- does user intent require preserving both edits;
- is conflict resolution visible to users;
- must offline edits merge after long divergence;
- is deterministic convergence required across many replicas without a central serialization point.

Simple records may need versioned conditional writes and a visible conflict/reload path. Rich text or long-offline shared documents may justify OT/CRDT, but only when their complexity buys required semantics.

If using OT/CRDT, define document/schema versioning, operation validation, authorization, compaction/snapshotting, tombstone lifecycle, migration and interoperability. The merge algorithm does not solve access control, storage durability, privacy or UI conflict semantics.

## Reconnect and resume

A connection is not a user/session authority.

On reconnect, establish:

`authenticated principal + tenant/object scope + subscription generation + last authoritative cursor/version + pending operation identities`

Then decide whether to:

- resume from a durable stream cursor;
- request missed updates;
- fetch a fresh snapshot and discard stale projections;
- replay unconfirmed idempotent operations;
- mark unknown outcomes for explicit reconciliation.

Do not assume a new socket has the same subscription state as the old one. Cancel or generation-guard messages arriving from a replaced connection.

A resume token/cursor must be scoped so one tenant/object/session cannot use another's replay position to access data.

## Offline collaboration

Offline-first behavior needs an explicit product promise.

Classify operations as:

- safe local-only drafts;
- queueable idempotent operations;
- operations requiring fresh authorization/version before commit;
- operations that must be disabled offline because current server state is required.

Persist pending operations only when the product must survive process termination. Protect account/tenant identity in the queue so logout/account switch cannot submit old operations into a new session.

On reconnect, validate current authorization and base version. Do not interpret “was allowed when queued” as current permission.

Expose meaningful sync states when the user can otherwise mistake a local draft for shared durable state.

## Permissions can change while clients are connected

Authorize every consequential mutation at the trusted owner even when the realtime subscription was previously authorized.

Define how active subscriptions react to:

- membership removal;
- role downgrade;
- object visibility change;
- workspace/account suspension;
- token/session revocation;
- document deletion/archive.

A connection opened under old permissions must not remain a permanent capability.

For highly sensitive projections, publish revocation or close subscriptions promptly, but still enforce authorization on subsequent server reads/writes because revocation messages can be delayed or dropped.

## Subscription and fan-out ownership

Treat subscription state as a resource with limits and cleanup.

Bound:

- subscriptions per connection/user/tenant;
- room/channel membership;
- reconnect rate;
- queued outbound bytes/messages;
- high-frequency presence/cursor updates;
- retained replay windows;
- snapshot size.

Backpressure must have product semantics: drop/coalesce ephemeral presence, disconnect slow consumers, or force snapshot resync rather than allowing unbounded memory growth.

Durable state updates generally cannot be silently dropped if the client relies on the stream for correctness; use version gaps/cursors so a slow/disconnected client can detect it must resync.

## Multi-tab and multi-device behavior

One person can have several concurrent client instances.

Decide whether each device/tab has:

- independent presence;
- shared optimistic queue;
- shared local cache;
- one elected transport leader;
- independent subscriptions with server deduplication.

Do not assume browser local-storage events or one mobile process are a globally reliable coordinator.

Use stable account identity plus session/device/tab generation when required to prevent stale callbacks from an old instance committing into a replacement.

## Comments, reactions and collaboration metadata

Small collaborative features still need durable semantics.

For comments/reactions/mentions/assignments:

- stable operation id prevents duplicate retry;
- exact actor and object authorization is checked on write and read;
- deletion/edit history follows product/privacy policy;
- notifications are projections of the committed event, not the mutation authority;
- unread counts derive from a clear read marker/event model;
- mention notification failure must not roll back an already committed comment unless the contract explicitly couples them.

Separate “content committed” from “fan-out/notification delivered” so partial failure is representable.

## Transport is an implementation detail

WebSocket, SSE, long polling, push, broker fan-out, database notifications and managed realtime services can all satisfy parts of the contract.

Choose based on:

- client-to-server write needs;
- delivery latency;
- replay/resume requirements;
- ordering scope;
- connection scale;
- infrastructure support;
- provider lock-in and failure model;
- auth/subscription controls.

Do not make protocol choice the architecture before defining state authority and recovery.

When a provider manages realtime fan-out, keep domain authorization and durable truth under application authority unless the product intentionally delegates them with an explicit contract.

## Validation shape

Derive tests from collaboration failure modes:

- two actors mutate the same object concurrently;
- duplicate mutation after timeout/reconnect;
- authoritative success with lost acknowledgement;
- out-of-order and repeated publications;
- stale event after snapshot/resubscribe;
- disconnect before/after commit;
- reconnect with missed versions;
- offline queued mutation after account/permission change;
- membership removal while subscribed;
- slow consumer/backpressure;
- multi-tab/device replacement;
- presence crash without clean leave;
- server normalization/transformation of optimistic data;
- old/new client/schema overlap.

A green WebSocket connection test is not evidence of collaboration correctness. Assert durable state, authoritative revision, projections on multiple clients, pending/failed UI state and recovery.

For deterministic tests, control message reorder/duplicate/drop and clock/lease expiry rather than relying on sleeps.

## Observability

Useful bounded signals include:

- active connections/subscriptions by bounded cohort;
- reconnect/resume success and forced snapshot resync;
- operation accept/reject/conflict/unknown-outcome counts;
- publication lag and version-gap resync;
- outbound queue/backpressure disconnects;
- presence lease expiry;
- stale generation/message rejection;
- permission-revoked subscription closures;
- offline queue age/size.

Correlate operation id, object id (when safe), authoritative revision and connection/session generation without logging sensitive document content.

## Compatibility and rollout

Realtime systems create long-lived mixed-version overlap because old clients can stay connected while servers deploy.

Evolve message schemas additively or with explicit version negotiation. Assume an old client can receive a new event and a new server can receive an old operation during the support window.

For document/operation schemas, separate storage migration from wire compatibility. A new server representation should not make reconnect/replay impossible for supported older clients.

Roll out changes with bounded cohorts when message semantics, merge behavior or permission propagation changes. Keep a snapshot/resync escape hatch where possible.

Rollback code separately from durable operations already committed. Never “undo” other users' valid collaborative changes merely to roll back a client/server release.

## Completion boundary

A realtime collaboration feature is not complete because two browser windows update live.

Close the contract: durable authority, operation identity, versions/order, optimistic reconciliation, presence expiry, concurrent edit semantics, reconnect/resume, offline behavior, current authorization, backpressure, multi-device generations, partial notification/fan-out failure, observability, mixed-version compatibility and recovery.

Use `references/frontend-product-patterns.md` for local UI ownership, `references/data-consistency-migration-patterns.md` and `references/distributed-systems-consistency.md` for durable/concurrent state, `references/security-multitenancy-patterns.md` for permission boundaries, and async/messaging references only when those mechanisms are actually active.
