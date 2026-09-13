# File, upload, and media product engineering

Use this when users or integrations create, upload, attach, import, preview, process, transform, download, replace, version, or delete files and media. Treat file handling as a lifecycle with durable identity, authorization, transfer state, validation/processing, delivery, and cleanup—not as “write bytes to object storage”.

## Compile the file lifecycle contract

Start from the user-visible state machine:

`intent -> authorized upload/import -> bytes transferred -> object verified -> scan/transform -> attached/available -> preview/download -> replace/delete -> derivative/orphan cleanup`

Capture only facts that change implementation:

- actor/tenant/resource that owns the file;
- upload/import purpose and allowed size/type policy;
- stable upload intent, object, attachment and version identities;
- direct-to-object-storage versus server-proxied transfer;
- single-part, multipart or resumable transfer semantics;
- checksum/finalization and duplicate/retry behavior;
- validation, malware scan, quarantine, media transform and metadata extraction state;
- when an object becomes visible/attachable/downloadable;
- signed URL/streaming authorization and expiry;
- replacement/versioning and cache/CDN behavior;
- deletion/retention, derivatives, orphaned parts and failed jobs;
- progress, cancel, retry, partial failure and unknown outcome UX;
- observability and validation under interruption/replay.

Do not choose S3/GCS/Azure, multipart thresholds, a transcoder, a virus scanner, or a CDN when repository/product constraints already determine the answer. Recover the existing object-store, metadata, worker and delivery authority first.

## Separate upload intent, stored object, attachment, and availability

One overloaded “file” row usually hides important transitions.

Useful conceptual identities are:

- **upload/import intent** — who may transfer which kind of object for what purpose;
- **stored object/version** — immutable or versioned bytes plus checksum/size/content metadata;
- **attachment/domain link** — relationship from object to message/document/avatar/ticket/etc.;
- **processing state** — pending/validated/quarantined/transcoding/failed/ready;
- **delivery capability** — short-lived authorization to preview/download/upload bytes.

These may live in one table or several; the important property is that authority and state transitions are explicit.

Do not make an object-storage key the public domain identity. Storage paths can change during provider migration, versioning, deduplication or quarantine.

Do not consider “object exists in the bucket” equivalent to “user-visible file is ready”. The object may be incomplete, unverified, quarantined, orphaned or not yet attached.

## Bind upload intent to exact authority and purpose

Before issuing upload capability, authorize the exact principal, tenant, destination resource and action.

Where practical bind the upload intent to expected constraints:

- owner/tenant/resource id;
- purpose/category (attachment, avatar, import, evidence, media, etc.);
- max size;
- allowed content policy;
- expected checksum or client-known metadata when meaningful;
- expiry;
- multipart/session identity;
- one-time/finalization semantics.

A signed upload URL is a capability. Keep scope/method/object key/expiry narrow enough that possessing it does not grant unrelated object access.

Never trust the client-provided filename/path to choose the authoritative storage key.

## Transfer and resumability

Large/unstable-network uploads need a transfer contract separate from domain attachment.

For multipart/resumable flows define:

- stable upload session id;
- part/chunk numbering and size rules;
- retry/deduplication semantics per part;
- resume discovery after process/network interruption;
- cancellation/abort behavior;
- finalization preconditions;
- expiry and cleanup of abandoned sessions/parts;
- whether completed parts may outlive the client session.

A client timeout after finalization can create an unknown outcome. Do not start a brand-new upload or attachment blindly; reconcile by upload/object id or checksum and authoritative finalization state.

Progress should represent the real stage. “100% uploaded” can still mean validating/scanning/processing. Separate byte-transfer progress from processing/readiness when the distinction matters to users.

## Verify bytes and metadata at trusted boundaries

Client metadata is a hint, not authoritative validation.

Depending on threat/product needs, validate:

- actual byte size;
- content signature/type rather than filename extension alone;
- checksum/digest;
- image/video/audio/container structure;
- archive extraction safety;
- dimensions/duration/page count or other domain limits;
- duplicate/version constraints.

If clients upload directly to object storage, the application still needs a trusted finalization step that verifies the object exists under the expected key/version and satisfies the intent before linking it into domain state.

Do not parse or render untrusted content in a privileged process merely because upload succeeded.

## Validation, quarantine and processing are explicit states

When scanning or transformation is asynchronous, use a truthful state machine such as:

`issued -> transferring -> object-present -> validating -> quarantined | processing -> ready | failed`

The exact names vary, but users and downstream consumers must be able to distinguish “bytes arrived” from “safe/valid/ready”.

If malware scanning, content moderation, DLP or another policy check is required, quarantine the object from normal delivery until the authoritative check passes. A preview pipeline must not bypass quarantine by reading the raw object through a different path.

If a scanner/provider is unavailable, define whether uploads remain pending, fail closed, or enter a bounded degraded path. Do not silently mark them ready.

## Media transforms and derivatives

Thumbnails, previews, transcodes, OCR text, waveform data, extracted metadata and optimized variants are derived projections.

Bind each derivative to:

- source object/version identity;
- transform recipe/version/config;
- output content type/size/checksum when useful;
- processing state/error;
- lifecycle owner.

A source replacement must not leave old derivatives attached to the new logical object. Use immutable/versioned source identity or generation checks.

Processing jobs need stable identity and idempotency. A retry should not create unbounded duplicate variants or publish a stale result after a newer source version replaced it.

If processing is expensive, bound concurrency, queue age, input size/duration and provider/resource budgets.

## Attach only through domain authority

The object-store service should not decide which message/document/profile now owns a file.

A common safe flow is:

`upload finalized/validated -> application authorizes target mutation -> domain record links object/version -> transaction/outbox publishes downstream projections`

If attachment creation fails after upload succeeds, the object is an orphan candidate, not automatically user-visible content.

If domain mutation succeeds but notification/indexing fails, keep the attachment committed and represent downstream failure separately unless the contract intentionally couples them.

## Delivery, preview and download authorization

Every preview/download path must re-establish current authorization at the trusted boundary before granting byte access.

For signed delivery URLs or cookies:

- scope to the exact object/version and method;
- keep TTL bounded;
- consider filename/content-disposition separately from storage key;
- avoid logging raw signed URLs;
- account for CDN caching and revocation/deletion behavior;
- do not treat knowledge of an object id/key as authorization.

For streaming endpoints, handle range requests, content length/type, disposition and aborts without loading unbounded content into memory.

Untrusted active content can execute in browsers. Define safe `Content-Type`, `Content-Disposition`, origin/sandbox policy and preview behavior for HTML/SVG/PDF/office/archive or other risky types according to the product threat model.

## Remote imports and URL fetches

Import-from-URL combines file lifecycle with SSRF/network trust.

Authorize the import target, validate/normalize destination under the product security model, limit protocols/redirects/DNS resolution/size/time, and never let the fetched filename/type become authoritative by itself.

Use the same post-fetch validation/quarantine/processing pipeline as direct uploads where applicable.

A successful HTTP 200 is not proof that the imported content satisfies product policy.

## Replacement and versioning

Clarify whether “replace file” means:

- mutate the logical attachment to point to a new immutable object version;
- create a new attachment/version while preserving history;
- overwrite bytes at the same storage key (usually risky for caches/races);
- replace only a derived rendition.

Prefer immutable/versioned object keys where stale CDN/browser caches, concurrent readers or rollback matter.

Use generation/version checks so a slow processing job for version N cannot publish over version N+1.

If old versions remain accessible, their authorization/retention must be explicit.

## Deletion, retention and orphan cleanup

Deletion is a lifecycle across domain metadata, source bytes, derivatives, caches, multipart parts and external processors.

Model:

`domain delete/suppress -> stop new delivery/processing -> delete source/derivatives -> invalidate projections/cache when required -> reconcile -> terminal state`

Shared/deduplicated objects need reference ownership: deleting one attachment must not erase bytes still owned by another legitimate reference.

Orphan cleanup needs an explicit criterion. Never delete “unattached” objects immediately if a valid multi-step flow can leave them temporarily unattached.

Expire abandoned upload intents/parts and failed processing outputs deliberately. Track cleanup failures rather than assuming object-store lifecycle rules cover every metadata/projection copy.

Retention/legal/privacy policy may intentionally keep some bytes or audit metadata; use the approved policy authority rather than inventing a duration.

## Client UX and recovery

Expose states users can act on:

- queued/waiting;
- uploading with transferable progress;
- paused/offline/retrying;
- processing/scanning;
- ready;
- rejected with actionable reason;
- failed and retryable/non-retryable;
- cancel requested/completed;
- unknown/reconciling after timeout.

Preserve user-selected filename/description/caption separately from internal storage identity.

Cancellation should define whether it aborts transfer only, processing, domain attachment, or cleanup. A cancel click after server finalization may need reconciliation rather than pretending the upload never existed.

For mobile/offline clients, account switch/logout must prevent old queued uploads from attaching into a new account/session.

## Quotas, admission and abuse resistance

Storage and processing are capacity-bearing product resources.

Bound where material:

- file/object size;
- files per request/resource/account;
- concurrent multipart uploads;
- unfinalized bytes/parts;
- media processing concurrency/minutes/pages;
- total storage/retention quota;
- outbound bandwidth/download rate;
- remote import limits.

Enforce quotas at the authority that cannot be bypassed by direct object-store upload. A pre-signed URL without server-side finalization/accounting can otherwise exceed product quotas even when the UI blocks it.

Choose fail/retry/backpressure behavior according to the expensive downstream bottleneck rather than queueing unbounded transformations.

## Observability

Useful bounded signals include:

- upload intents issued/expired/finalized;
- bytes and duration by bounded product category;
- resume/retry/abort/finalization failures;
- checksum/type/policy rejection;
- scanning/quarantine/processing latency and failure;
- orphan/multipart cleanup backlog;
- attachment commit versus processing/indexing/notification partial failure;
- signed delivery authorization failures;
- stale transform generation rejection;
- storage/processing quota pressure.

Correlate upload intent id, object/version id, domain attachment id and processing job id without logging raw file content, credentials or signed URLs.

## Validation shape

Choose tests that falsify lifecycle invariants:

- wrong tenant/resource tries to finalize or attach another user's object;
- direct-upload object exists but violates size/type/checksum intent;
- duplicate finalization/retry;
- timeout after successful finalization/attachment;
- interrupted multipart upload resumes without duplicate bytes/domain records;
- abandoned multipart parts expire/clean up;
- scanner/processor unavailable or rejects content;
- quarantined object cannot be previewed/downloaded through alternate path;
- source version changes while old transform job is running;
- attachment commit succeeds while downstream thumbnail/index/notification fails;
- signed URL expires or authorization is revoked;
- range/stream abort does not leak resources;
- delete removes/suppresses source, derivatives and delivery while preserving legitimately shared references;
- old/new client/schema overlap during rollout.

Assert durable metadata, object/version identity, authorization state, processing state and user-visible terminal state—not only HTTP 200 or object-store presence.

## Compatibility and migration

Files can outlive application releases, storage providers and processing recipes.

During provider/bucket/key migration preserve a stable domain object identity and support old/new locations during the overlap window. Do not expose provider paths so widely that migration becomes a public API break.

For transform recipe changes, version derivatives and regenerate lazily/eagerly according to product needs. Do not silently reinterpret an existing derivative as a new recipe without identity evidence.

For message/API schema evolution, assume supported old clients can hold upload intents while new servers deploy. Keep finalization/attachment contracts additive or explicitly versioned.

Rollback code separately from irreversible deletes or external uploads. A deploy rollback cannot restore bytes that were already deleted unless an approved recovery path exists.

## Completion boundary

A file/media feature is not complete because bytes reached storage or a preview rendered.

Close the lifecycle: upload/import authority, stable identity, transfer/resume/finalization, trusted validation, scan/quarantine/processing, domain attachment, delivery authorization, versioning, user recovery states, quotas, derivatives, deletion/orphan cleanup, observability, mixed-version compatibility and recovery.

Use `references/security-multitenancy-patterns.md` for trust/object-access boundaries, `references/data-movement-cdc-search-storage.md` for object/storage mechanics, async/workflow references for processing queues, privacy lifecycle guidance for retention/deletion when user data is involved, and frontend/mobile guidance for client progress/recovery behavior.
