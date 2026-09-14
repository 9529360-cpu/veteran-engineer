# File, upload, and media product engineering

Use this when users or integrations upload, import, attach, preview, transform, download, replace, version, or delete files/media. Treat bytes as one stage in a lifecycle, not as the product contract.

`authorized intent -> transfer -> trusted finalization -> validate/quarantine/process -> domain attachment -> delivery -> replace/delete -> derivative/orphan cleanup`

For object-access and SSRF boundaries also use `security-multitenancy-patterns.md`; for storage/data movement use its focused owner; for async processing use async/workflow guidance; for privacy retention/deletion use the privacy lifecycle owner.

## Keep intent, object, attachment, and readiness separate

Use stable identities for the upload/import intent, immutable or versioned stored object, domain attachment/link, processing generation, and any short-lived upload/download capability. They may share storage, but their authority and transitions must remain distinguishable.

An object key is not a public domain identity. “Object exists” is not “file is ready”: bytes may be incomplete, unverified, quarantined, orphaned, superseded, or unattached.

Before issuing upload capability, authorize the exact principal, tenant, target resource, purpose/category, size/content policy, expiry, and session/finalization semantics. Signed URLs/cookies are capabilities; scope exact object/version, method, and bounded lifetime. Never derive authoritative storage identity from a client filename/path.

## Transfer and finalization must survive retry and ambiguity

Multipart/resumable transfer needs stable session/part identity, idempotent part retry, resume discovery, cancellation, finalization preconditions, expiry, and abandoned-part cleanup.

A timeout after finalization or attachment may be an unknown outcome. Reconcile by stable operation/upload/object identity before starting a second logical upload or attachment. Byte-transfer progress reaching 100% does not prove validation/processing/readiness is complete.

Finalization is a trusted boundary: verify the expected object/version exists and enforce actual size, signature/type, checksum and domain/parser limits as required. Client extension/content metadata is a hint. Do not parse untrusted content in a privileged process merely because transfer succeeded.

## Quarantine and processing are authoritative states

When scanning/moderation/DLP/transcoding/OCR/metadata extraction is asynchronous, distinguish bytes-present, validating/quarantined, processing, ready, and failed states where behavior differs. A preview/download path must not bypass quarantine by reading raw storage through a different route.

Derivatives are projections bound to source object/version plus transform recipe/generation. Retries must not create unbounded duplicates, and stale work for version N must not publish over N+1. Bound expensive processing by the real downstream bottleneck.

Attach only through the domain owner after required validation. If upload succeeds but attachment fails, the object is an orphan candidate. If attachment commits but thumbnail/index/notification fails, keep the committed domain result and represent downstream failure separately unless the product explicitly couples them.

## Delivery, import, replacement, and deletion keep current authority

Every preview/download re-establishes current object/resource authorization before granting bytes. Signed delivery capability is not permanent authority. Handle content type/disposition, active content, range/stream aborts, CDN/cache versioning, expiry, and secret-safe logging according to the threat model.

Import-from-URL combines file lifecycle with SSRF/network trust. Authorize the target, restrict protocol/redirect/DNS/size/time as required, and run fetched bytes through the same trusted validation/quarantine path. HTTP 200 is not content-policy proof.

Prefer immutable/versioned object identity for replacements when caches, concurrent readers, rollback, or stale processors matter. A source-generation check must prevent old transform results from attaching to a newer logical version.

Deletion spans domain metadata, source bytes, derivatives, caches/projections, multipart parts, delivery capabilities, and external processors. Stop new delivery/processing, clean or suppress owned copies, reconcile, then claim terminal completion. Shared/deduplicated bytes need reference ownership so deleting one attachment does not erase another valid reference.

Orphan cleanup needs a bounded criterion that cannot race a valid multi-step flow. Quotas/admission must be enforced at an authority direct-to-storage uploads cannot bypass.

## User-visible recovery, compatibility, and proof

Expose actionable states such as uploading/paused/retrying, processing/scanning, ready, rejected, failed, cancel-pending/completed, and unknown/reconciling when they differ. Account/session changes must not let old queued uploads attach into the wrong tenant.

Files can outlive releases, storage providers, clients, and transform recipes. Preserve stable domain object identity through provider/key migration; version derivative recipes; keep finalization/attachment contracts mixed-version safe; separate code rollback from irreversible delete/external writes.

High-value tests include cross-tenant finalize/attach, duplicate finalize, lost finalization acknowledgement, interrupted resume, invalid bytes, processing failure, quarantine bypass, stale transform generation, signed delivery expiry/revocation, partial downstream failure, delete/reference ownership, orphan expiry, and old/new client overlap.

The useful oracle is not HTTP 200 or bucket presence. Domain attachment, authoritative object/version, validation/processing generation, current delivery authorization, derivative ownership, cleanup state, and visible terminal state must converge after retry, replay, failure, replacement, and deletion.

Correlate intent, object/version, attachment and processing job ids while keeping raw file content, credentials, and signed URLs out of logs/evidence.
