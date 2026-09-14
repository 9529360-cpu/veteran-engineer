# Privacy and data lifecycle engineering

Use this when product behavior collects, derives, stores, transmits, exports, shares, logs, analyzes, retains, anonymizes, or deletes user- or organization-linked data. Privacy is a lifecycle and authority problem, not a settings banner.

This reference does not invent legal obligations. Recover approved product/compliance policy when it changes implementation; otherwise surface missing policy inputs instead of fabricating retention periods, legal bases, or regulatory classifications.

The technical contract is:

`approved purpose -> minimized collection -> authorized processing -> owned copies -> retention/export/correction/deletion -> downstream/provider convergence -> truthful completion or recovery`

## Keep authorization, purpose, and preference separate

Authorization answers whether a principal may act on an object now. Processing policy answers whether the product may collect/use/share a category for a purpose. Consent or privacy preference, when the approved product policy uses it, answers whether an optional behavior is currently enabled for its scope.

Authorization to read profile data does not authorize unrelated analytics, model training, advertising, discovery, or provider sharing. A preference toggle is not effective if queued workers/providers continue using stale state. Bind consequential async processing to a generation/effective version or re-read current authority at the trusted boundary.

## Minimize data and track every meaningful copy

Collect only fields needed for the approved contract. Avoid speculative “future analytics” fields and whole-object provider/event payloads when a smaller projection works. For sensitive fields, identify writer, purpose, readers, copies, retention/correction/export/deletion behavior, and logging/evidence boundaries.

Trace lifecycle-relevant copies across primary records, replicas/read models, caches, search, object storage, queue/job payloads, analytics/warehouses, support tools, logs/traces, backups, and external processors. Classify each copy as authoritative, replayable projection, temporary processing copy, approved immutable/audit record, external processor copy, or backup/recovery copy.

Hashing, tokenization, embeddings, aggregates, opaque ids, or derived attributes do not automatically make data non-sensitive or detached from a subject. “Derived” is not a lifecycle policy.

Do not claim “deleted” when only the primary row is gone. If backups cannot be physically erased immediately under approved policy, restored data must re-enter suppression/deletion reconciliation rather than resurrect active state.

## Retention, revocation, and deletion are state transitions

Model optional processing preference/consent and revocation with explicit scope, effective version/time, propagation, and meaning across workers/providers. Do not silently reinterpret old records after their scope changes materially.

Retention should have one authoritative anchor and lifecycle:

`anchor -> eligible -> approved hold/exception check -> delete/anonymize/archive -> derivative convergence -> evidence`

Jobs must be idempotent/resumable. Partial cleanup across stores/providers needs an explicit pending/retry/reconciliation state; TTL or “cleanup queued” is not proof of completion.

Deletion/account closure should normally follow:

`authorize -> suppress authoritative state and new processing -> fan out cleanup -> verify/reconcile copies/providers -> visible terminal state`

Use minimal tombstones/suppression generations where delayed events, old workers, or backup restore could recreate deleted state. Tombstones need their own bounded lifecycle.

## Export and correction are privileged workflows

When the product exposes access/export, bind requester, subject, tenant, cutoff/snapshot, included/excluded categories, redaction, provider/derived sources, artifact access/encryption/expiry, retry identity, and visible terminal states. Generation success does not justify a public or long-lived export URL.

Correction must also update, invalidate, or intentionally preserve affected projections according to their contracts. Updating a primary row while search/admin/analytics state remains stale can make the correction false.

## Logs, evidence, providers, and support are data boundaries

Observability must not become a shadow data lake. Prefer stable ids and bounded metadata; redact or omit secrets/private fields before producer emission; avoid private content in span names, metric labels, exceptions, filenames, screenshots, fixtures, bug reports, or evidence bundles. Use synthetic/minimized data unless an approved process says otherwise.

Treat SaaS integrations, analytics SDKs, AI/model providers, payment/messaging vendors, and support tools as explicit egress boundaries. Know what fields/purpose/tenant/provider configuration cross the boundary, minimize the projection, and define retry, deletion/revocation/export, failure, and migration behavior when the product contract depends on them.

Browser/mobile SDK installation is not authorization to collect. Initialization, identity attachment, and optional tracking follow current product authority.

Privileged admin/support tools keep tenant/object scope, least privilege, purpose-limited views, auditability, bounded impersonation/session identity, and the same field/redaction lifecycle. Support access is not a substitute for promised user-facing export/correction/deletion flows.

## Compatibility and proof

Privacy changes overlap old clients, schemas, queued events, workers, caches, providers, historical data, and backups. Introduce new authority/schema before switching writers; keep mixed-version readers/workers safe; reconcile old copies/providers; remove suppression/deletion markers only after delayed writers/events can no longer recreate protected state.

Code/config rollback is separate from irreversible disclosure or deletion. External disclosure may require provider remediation; erased data may require an approved recovery path, not merely redeploying old code.

High-value tests include denied/minimized collection, stale-worker revocation, disallowed-field exclusion from logs/events/providers, exact export isolation, deletion convergence across representative copies/providers, partial-failure recovery, retention resume, backup/old-event non-resurrection, and mixed-version rollout.

A unit test proving `DELETE FROM users` ran is not lifecycle proof. The useful oracle is that authoritative state, representative copies/providers, suppression generations, and the user-visible terminal state converge after retries, replay, stale work, restore, and migration.

Measure lifecycle stage/backlog/age, reconciliation failures, stale-generation rejections, export artifact expiry/failure, redaction/schema violations before emission, and provider cleanup failures without putting personal content or identifiers into high-cardinality telemetry.

For authorization/tenant boundaries also use `security-multitenancy-patterns.md`; for cross-store lifecycle use the data consistency/lifecycle references; for AI or analytics add their focused owners instead of duplicating them here.
