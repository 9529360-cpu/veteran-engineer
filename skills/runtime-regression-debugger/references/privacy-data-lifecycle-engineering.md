# Privacy and data lifecycle engineering

Use this when product behavior collects, derives, stores, transmits, exports, shares, logs, analyzes, retains, anonymizes, or deletes user- or organization-linked data. Treat privacy as an engineering lifecycle and authority problem, not as a policy banner layered on top of ordinary authorization.

This reference does not determine legal obligations for a jurisdiction. Recover the product's approved policy/compliance requirements when they are material, then implement those requirements as explicit technical contracts.

## Compile the privacy lifecycle contract

Start from the data flow rather than a settings screen:

`actor/purpose -> collection -> validation/classification -> allowed use -> storage/replication -> disclosure/processing -> retention -> export/correction/deletion -> downstream convergence -> observable completion or recovery`

Capture only facts that change implementation:

- data categories and sensitivity relevant to the feature;
- purpose for each material collection/use;
- collection source and whether the data is required, optional, inferred, or generated;
- consent/preference/legal-policy authority when product behavior depends on it;
- system of record and every material derivative copy;
- service/provider/region boundaries when they affect approved handling;
- retention trigger and duration/policy authority;
- export/access/correction/deletion requirements exposed by the product;
- revocation/withdrawal semantics and effects on future processing;
- audit/observability without recreating the sensitive payload in logs;
- compatibility and recovery during schema/provider/client changes.

Do not ask the user to invent retention periods, legal bases, or regulatory classifications when the repository/product policy does not establish them. Surface those as unresolved policy inputs rather than fabricating law.

## Separate authorization, purpose, and consent/preference

These are different authorities.

- **Authorization** answers whether this principal may perform this action on this object now.
- **Purpose/processing policy** answers whether the product may collect/use/share this category of data for this reason.
- **Consent or user preference**, when applicable to the approved product policy, answers whether an optional behavior is currently enabled for the relevant scope.

A user being authorized to view their profile does not imply the product may reuse profile data for analytics, model training, advertising, contact discovery, or third-party sharing.

Do not encode consent as a decorative UI flag while downstream jobs continue using stale replicated state. When a preference changes behavior, identify the durable authority and the propagation/convergence contract.

For consequential or independently deployed processing, include a version/generation/effective timestamp so stale workers cannot continue processing merely because they cached an older boolean.

## Classify data by engineering consequence

Use the product's approved taxonomy if one exists. The engineering goal is to distinguish handling requirements, not to create a legal taxonomy from scratch.

Useful implementation distinctions can include:

- public/product content intentionally visible to others;
- account/contact/profile data;
- authentication/session/security data;
- financial/value-related records;
- precise or coarse location;
- communications/content and attachments;
- telemetry/analytics identifiers;
- device/network identifiers;
- inferred/derived attributes;
- support/evidence/debug artifacts;
- secrets/credentials, which generally require stronger handling and should not enter ordinary analytics/logging paths.

Classification must follow data through derived fields where material. Hashing, tokenizing, aggregating, embedding, or assigning an opaque id does not automatically make a dataset non-sensitive or unlinkable.

## Minimize collection and field fan-out

Collect only fields needed for the approved product contract. Avoid speculative “future analytics” fields in transactional schemas or event payloads.

For every new sensitive field, ask:

- who writes it;
- why the product needs it;
- where it is copied;
- who reads it;
- whether lower-fidelity or short-lived data is sufficient;
- how it is corrected/exported/deleted if required;
- how logs/traces/tests avoid duplicating it.

Prefer server-side derivation from already-authorized state over asking clients to submit redundant sensitive facts when practical.

Do not send entire domain objects to providers or model/tool contexts when a minimal projection satisfies the operation.

## Make the system of record and derivative copies explicit

Privacy bugs often hide in projections rather than the primary table.

Trace material data through:

`primary record -> replicas/read models -> cache -> search index -> object storage -> queue/job payloads -> warehouse/lake -> analytics events -> support/admin tools -> logs/traces -> backups -> external processors/providers`

Classify each as one of:

- authoritative record;
- replayable projection;
- temporary processing copy;
- immutable/audit record with an explicitly approved retention contract;
- external processor copy with a bounded interface and deletion/export behavior;
- backup/recovery copy governed by a recovery/expiry contract.

Do not promise “deleted” when only the primary row was removed and searchable/cache/provider copies remain active.

When immediate physical erasure from a recovery backup is intentionally not supported, the approved product policy should define expiry/restoration behavior. Engineering must ensure restored data re-enters the deletion/suppression process instead of resurrecting active user state indefinitely.

## Consent, preference, and revocation state machines

When product behavior depends on consent or an optional privacy preference, model it as a state transition rather than a checkbox.

A useful shape is:

`unknown/not-requested -> granted or denied -> changed/revoked -> propagated -> effective`

Capture:

- scope: account, workspace, device, feature, data category, purpose, provider;
- policy/version shown when the state was captured if product policy requires it;
- timestamp and authenticated actor when material;
- whether denial blocks collection, processing, sharing, or only one optional feature;
- propagation to async workers, provider integrations, and cached configuration;
- what happens to already-collected data under the approved policy.

Do not silently reinterpret an old consent/preference record when the meaning/scope materially changes. Version or migrate the contract explicitly.

A revocation must fail safely under queue delay, retries, and old workers. New processing should check the current authoritative state at the trusted boundary or use a freshness mechanism that prevents stale permission from living indefinitely.

## Retention is a state transition, not a cron expression

Define retention from an authoritative event:

`retention anchor -> eligibility -> hold/exception check -> deletion/anonymization/archive action -> derivative convergence -> evidence`

Anchors may be account closure, object deletion, last activity, transaction completion, policy-defined age, or another product event. Do not compute retention independently in multiple services without a shared contract.

Specify what pauses or overrides normal expiry when the approved product policy requires it, such as an active dispute/hold/recovery window. Keep exception authority narrow and auditable.

Retention jobs must be idempotent and resumable. Partial deletion across stores should produce an explicit incomplete/retry state rather than a false success.

Avoid using TTL alone as proof of deletion if other copies are not tied to the same lifecycle.

## Access, export, correction, and portability workflows

If the product exposes user/admin data access or export, treat it as a privileged asynchronous product flow:

`authorized request -> scope snapshot -> collect sources -> transform/redact -> artifact -> notify/deliver -> expire artifact -> audit/recovery`

Define:

- exact requester/subject/tenant binding;
- included/excluded data categories and reason;
- snapshot/cutoff semantics while data changes during export;
- provider/derived data collection boundaries;
- redaction of other principals' data or secrets;
- artifact encryption/access/expiry;
- retry identity and duplicate-request handling;
- visible terminal states.

Do not email or expose a long-lived public export URL merely because generation succeeded.

For correction/update flows, identify which derived copies are recomputed, invalidated, or intentionally immutable. Updating the primary row while search/analytics/admin projections remain stale can make the correction contract false.

## Deletion and account closure need convergence

Define deletion scope before implementation:

- one object versus whole account/workspace;
- soft-delete versus active suppression versus physical erasure/anonymization;
- shared records with other principals;
- records intentionally retained by the approved product policy;
- external providers and integrations;
- cache/search/read models;
- scheduled jobs/messages already in flight;
- generated or inferred derivatives;
- backups/recovery restore behavior.

Model the flow:

`request -> authorize/re-auth if required -> mark/suppress authoritative state -> stop new processing -> fan out cleanup -> verify/reconcile -> visible completion`

For long-running deletion, do not tell the user the operation is complete merely because cleanup was queued. Expose a truthful pending/partial/completed/recovery state when the product surface needs it.

Use tombstones/suppression markers where needed to prevent delayed events or backup restores from recreating deleted active state. Tombstones themselves should contain the minimum data needed for that purpose and have an explicit lifecycle.

## Logging, telemetry, support, and evidence

Observability can accidentally become a shadow data lake.

For logs/traces/errors/events:

- prefer stable object/request ids over raw payloads;
- redact or omit secrets and sensitive fields at the producer boundary;
- bound event schemas and cardinality;
- avoid putting personal content in span names, metric labels, exception messages, filenames, screenshots, or evidence bundles;
- define retention/access for support diagnostics separately from primary product data when material.

A redaction rule applied only in the dashboard is too late if raw logs already contain the value.

Test fixtures, snapshots, bug reports, and copied production examples are data stores too. Use synthetic/minimized data unless an approved process explicitly authorizes otherwise.

## Third-party and provider boundaries

Treat external processors, SaaS integrations, AI/model providers, analytics SDKs, payment providers, messaging vendors, and support tools as explicit data egress boundaries.

For each material provider call, capture:

- data fields/categories sent;
- purpose and trigger;
- tenant/account binding;
- provider identity/configuration/region when material;
- provider-side storage/retention behavior required by approved policy;
- retry/idempotency behavior;
- deletion/revocation/export interface if the product contract depends on it;
- failure/degraded behavior when the provider cannot satisfy the operation.

Do not let a browser/mobile SDK start collecting merely because it is installed. Initialization, identity attachment, optional tracking, and preference state must follow the product contract.

When providers change, migration must account for old provider copies and credentials/configuration as well as code cutover.

## Privacy-aware caches, search, analytics, and derived models

A projection can remain useful after the source changes only if its lifecycle is deliberate.

Caches and search indexes should be invalidated/suppressed under deletion or visibility changes according to the product contract.

Analytics pipelines need field minimization, bounded identifiers, purpose-aligned event schemas, access controls, and retention/deletion behavior where required. Do not copy transactional payloads wholesale into events.

For embeddings, feature vectors, aggregates, scores, or inferred attributes, decide whether they remain linked to the subject and how source deletion/correction affects them. “Derived” is not a lifecycle policy.

If aggregates are intentionally retained because they are no longer linked/re-identifiable under the approved policy, document the transformation and validation boundary rather than assuming aggregation guarantees anonymity.

## Multi-tenant and admin/support surfaces

Privacy boundaries apply inside privileged tools too.

Admin/support access should preserve tenant/object scope, least privilege, auditability, and purpose-limited views. Avoid broad search/export endpoints that bypass the same field-level redaction used in normal product flows.

Impersonation or support-session features need explicit identity, scope, duration, visible/auditable ownership, and exit/revocation semantics.

Do not use production support access as a workaround for missing user-facing export/correction/deletion workflows when the product contract promises those workflows.

## Validation shape

Choose tests from the changed privacy mechanism:

- collection disabled when the authoritative preference/policy denies it;
- revocation blocks new async/provider processing even with queued/stale work;
- minimization prevents disallowed fields from entering events/logs/provider requests;
- export is bound to exact requester/subject/tenant and excludes secrets/other principals;
- deletion removes or suppresses primary, cache, search, provider, and representative derived copies;
- retries/partial failure do not report false completion;
- backup/old-event replay cannot resurrect active deleted state when a tombstone/suppression contract applies;
- retention expiry is idempotent and resumes after interruption;
- old/new clients/providers behave safely during policy/schema rollout.

A unit test proving `DELETE FROM users` ran is not evidence of lifecycle completion when the product has search, objects, events, providers, or caches.

For high-risk flows, use an evidence bundle that records source/build identity, exact scenario, affected stores/providers, and observable terminal state without copying the sensitive payload itself.

## Observability and support

Measure lifecycle outcomes rather than raw user data.

Useful bounded signals include:

- privacy workflow counts and terminal states;
- cleanup backlog/age by store or provider;
- retention/deletion reconciliation failures;
- stale preference/consent generation rejections;
- export generation failures/expiry;
- redaction/schema violations detected before emission;
- provider deletion/revocation failures.

Avoid metrics labels keyed by email, user-entered content, precise location, tokens, or other sensitive high-cardinality values.

Operational tooling should answer “which lifecycle stage/store failed for request X?” without requiring broad exposure of the underlying private content.

## Compatibility, migration, and rollback

Privacy/data-lifecycle changes often cross old clients, schemas, events, workers, providers, and historical data.

Use additive/mixed-version-safe sequencing:

`new authority/schema -> dual-compatible readers/workers -> backfill/classify if required -> switch writers -> verify lifecycle behavior -> remove old path/data/provider`

Do not remove an old suppression/deletion marker while delayed events or supported old writers can still create the data it protects.

Rollback code/config separately from irreversible disclosure or deletion effects. Once data has been sent externally, rollback may require provider-side remediation; once data has been erased, rollback may require recovery from an approved backup if permitted, not simply redeploying old code.

## Completion boundary

A privacy-sensitive feature is not complete because access control passes or a consent toggle renders.

Close the full lifecycle: approved purpose, minimized collection, authoritative preference/consent when applicable, system-of-record plus derivative copies, provider boundaries, retention, export/correction/deletion, revocation propagation, logs/evidence, async failure/retry behavior, observability, mixed-version compatibility, and recovery.

For authorization/tenant boundaries also use `references/security-multitenancy-patterns.md`. For analytics use `references/product-analytics-experimentation.md`; for AI/model data flows use `references/ai-llm-product-engineering.md`; for cross-service lifecycle and deletion use the relevant data consistency/cross-repo/lifecycle references instead of duplicating them here.
