# Release promotion patterns

## Contents

- Evidence levels
- Release topology and trigger ownership
- Freshness barriers after remote mutation
- Exact source and build provenance
- Build once, promote same bytes
- Immutable artifacts and mutable metadata
- Previous stable and rollback
- Public integrity verification
- Consistent-view concepts
- Attestations and SBOMs
- Staged rollout and withdrawal
- Updater metadata backward compatibility
- Signing identity rotation
- Package hardening and fuse compatibility
- Signing and installed-client validation
- Failure and recovery rules
- Mature references to consult live

## Evidence levels

Keep these states distinct:

1. source/contract tests pass;
2. interaction/E2E tests pass;
3. package builds;
4. validation install runs;
5. real-client interaction succeeds;
6. production artifacts are uploaded;
7. update metadata/channel pointer is promoted;
8. public update source serves the intended version;
9. public artifact bytes pass cryptographic integrity checks;
10. rollback target remains verified.

A green workflow can represent any one of these. Read the actual workflow steps before stating which level succeeded.

## Release topology and trigger ownership

Before changing version, tag, release, package, channel, or deployment state, recover the live release path:

`source branch/PR -> merge or tag trigger -> version authority -> CI/release workflow -> artifact -> registry/update metadata -> deployment/public view`

Identify which actor owns each transition: a developer command, protected merge, release bot, Changesets/release-please/semantic-release-style automation, tag-triggered workflow, registry publisher, updater metadata promoter, or deployment controller. Read the current workflow/config that proves the trigger; do not infer release behavior from an old README or a previous run.

Keep one release authority. In a repository where merge to the default branch already starts versioning or publishing, the correct action for "publish a new version" may be `merge -> observe automation -> verify outputs`, not a second manual version bump/tag/publish. Likewise, if a tag is the trigger, do not separately dispatch a second publish workflow unless the repository explicitly requires both. When merge/tag/push predictably triggers production publication or deployment, treat the initiating action as carrying that downstream release consequence for authorization and advisability; do not classify it as a harmless repository-only mutation.

Treat auto-generated version commits, tags, changelogs, releases, and publication metadata as authoritative outputs of their owner. Do not race them with a parallel manual path.

## Freshness barriers after remote mutation

Repository and release state has an epoch. Any remote mutation or automation trigger invalidates the snapshot used to decide the mutation. This includes merge, push, tag creation, workflow dispatch, release-bot commit, version bump, release creation, artifact upload, channel promotion, deployment, or rollback.

Before the next consequential action, reacquire only the authoritative state that can change the decision, typically:

- remote default-branch HEAD and the merged PR/merge commit identity;
- current version source, changelog/changeset state, and generated release metadata;
- tags and releases that now exist;
- relevant CI/release workflow run identity, conclusion, and produced artifact identity;
- package registry, update channel, or public release metadata when publication participates;
- deployed revision/version when deployment participates.

Compare the new state with the pre-action snapshot. If it advanced, discard the stale plan and continue from the new truth. Treat the initiator as unknown until a live current-execution tool return, platform-bound causal automation, or explicit executor provenance identifies it. A persisted journal receipt is only a historical mission claim until its identity and causal relation are revalidated; the changed state, account-level actor, timing, or journal entry alone does not prove another actor/session caused it. Never assume a local checkout, cached connector response, or previously listed tags/releases became current automatically after a remote mutation.

Do not chain two consequential release mutations using only the state observed before the first one.

## Exact source and build provenance

Record the exact commit/head that produced the candidate. The release package must be attributable to that source identity.

Where practical, preserve:

- source commit SHA;
- workflow/run identity;
- package/application version;
- generated artifact hashes;
- build environment/toolchain versions;
- signed build provenance/attestation when supported.

A file with the right filename is not enough to prove it came from the intended source.

## Build once, promote same bytes

Prefer one build artifact moving through validation and production promotion.

Avoid:

`build candidate A -> validate A -> independently rebuild B -> publish B`

Prefer:

`build A -> hash/provenance A -> validate A -> promote A`

If a rebuild is unavoidable, treat it as a new artifact and repeat integrity/runtime gates.

## Immutable artifacts and mutable metadata

Versioned binaries, blockmaps/deltas, manifests, and checksums should be immutable once published. Channel-discovery metadata such as `latest.yml`, `latest.json`, a channel alias, or a redirect is mutable and should be promoted **after** all referenced artifacts are available.

General sequence:

`build -> validate -> upload versioned artifacts -> verify availability -> preserve rollback metadata -> promote mutable pointer -> verify public view`

This reduces the window where clients can discover metadata that references missing or incomplete artifacts.

## Previous stable and rollback

Before promotion, fetch and validate the current production metadata and identify the previous stable version.

Preserve enough information to restore that known-good state without rebuilding it. A rollback snapshot should be version-addressed as well as available through an operational "current rollback" key when that improves recovery.

If the new promotion fails public verification:

1. restore previous stable metadata;
2. verify the public update source sees the previous stable version again;
3. fail the release run loudly even if rollback succeeds;
4. preserve failed-version diagnostics without silently republishing different bytes under the same version.

## Public integrity verification

Verification must happen from the consumer-facing source, not only from the upload API.

At minimum verify:

- advertised version;
- metadata parseability;
- every referenced artifact is reachable;
- content length/expected structure when meaningful;
- SHA-256 or stronger digest matches the build manifest.

For differential updaters, include delta/blockmap artifacts in integrity checks where they participate in client updates.

## Consistent-view concepts

The Update Framework (TUF) formalizes the need for clients to receive a consistent view of metadata and targets. A lightweight updater does not need to implement TUF to learn from the model.

Reusable principles:

- metadata should identify versions/hashes of referenced metadata or targets;
- clients should not be able to combine files from different repository states accidentally;
- freshness metadata and target metadata have different responsibilities;
- mutable "latest" state should not point at partially published target state.

Use these principles to reason about race windows in custom update servers.

## Attestations and SBOMs

When CI/platform support exists, artifact attestations can bind a binary digest to repository, workflow, commit, and build identity. SBOM attestations can add dependency transparency.

Treat them as supply-chain provenance, not runtime correctness proof. An attested artifact can still contain a bug; a correctly functioning artifact without provenance still has weaker origin guarantees.

For private repositories, verify whether the platform/plan supports attestations before designing a required gate.

## Staged rollout and withdrawal

When the updater supports staged rollout, treat the rollout percentage/channel decision as mutable promotion metadata, not as a reason to mutate already-published versioned binaries.

- verify the staged metadata publicly before increasing exposure;
- preserve the exact artifact hashes while changing rollout percentage;
- define what happens to users who already installed a bad staged release;
- do not assume replacing metadata for the same version can downgrade or repair already-updated clients; many updater models require a newer version to move those clients forward safely;
- separate rollout-control evidence from artifact-build evidence.

A staged rollout reduces blast radius; it does not replace real-client validation or rollback design.

## Updater metadata backward compatibility

Update metadata is a protocol consumed by already-installed clients, not merely output from the newest builder. Builder defaults and metadata fields can change over time while old clients remain in the field.

Before changing updater/build tooling:

- identify the oldest installed updater version still supported;
- generate candidate metadata with the new toolchain;
- verify that every supported installed client can parse/select/download it;
- treat custom update servers/dashboards that parse metadata as protocol consumers too;
- ensure artifact and metadata descriptors come from the same build; checksum mismatch can be a mixed-build publication failure, not network corruption.

Dropping a legacy metadata field is safe only after the population that requires it is no longer supported.

## Signing identity rotation

If update verification pins a publisher/certificate identity, certificate rotation is a client-compatibility migration.

Plan an overlap window where old installed clients accept the intended new signer, then validate `old signed client -> newly signed update` before retiring the previous identity. Do not treat changing a CI signing secret as sufficient migration evidence.

Signing also affects OS-level app identity, keychain access, notifications, and some auto-update mechanisms. Test those continuity properties across upgrades, not only installer launch.

## Package hardening and fuse compatibility

Electron package fuses can reduce attack surface, but they are package-time runtime contracts, not free toggles. Maintain a fuse matrix:

`fuse -> security benefit -> application dependency -> test/tooling dependency -> persisted-state migration/rollback effect`

Examples requiring explicit compatibility tests include inspector/Node flags, ASAR-only loading/integrity validation, and cookie encryption. Some security fuses can conflict with Electron automation tooling, and cookie-encryption changes can be one-way for existing stores. Enable hardening only after installed multi-account Session and updater rollback tests prove the migration.

Apply package hardening before final signing when required by the toolchain, and verify the final signed package rather than the pre-fuse/pre-sign intermediate.

## Signing and installed-client validation

Signing is part of release compatibility, not just branding. Platform trust, keychain/credential behavior, notifications, and updater behavior can differ between development, unsigned validation builds, and signed production builds.

- validate auto-update in an installed package when the updater/runtime documentation recommends it;
- include at least the oldest still-supported installed updater in metadata compatibility tests;
- record whether validation and production use the same signing identity;
- treat signing/notarization failure as its own release owner, not as application-runtime failure;
- never expose signing keys/certificates in logs or artifacts;
- after signing, verify the final distributed bytes/digests rather than only the pre-sign artifact.

## Failure and recovery rules

- Never mutate release/version markers merely to test unrelated product code.
- Keep formal release authorization separate from normal merge authorization.
- Do not overwrite immutable versioned binaries to "fix" a failed release; issue a new version unless the release system has an explicit safe same-version recovery contract.
- Do not call a release successful until the public source is verified.
- Preserve the previous stable target until the new release has enough real-world confidence for the product's rollback policy.
- Record exactly which layer passed or failed; do not compress build, upload, promotion, and verification into one status word.

## Mature references to consult live

Prefer current versions of:

- `electron-updater` / electron-builder auto-update documentation for generated metadata and provider behavior;
- The Update Framework (TUF) metadata model for consistent repository views and freshness roles;
- GitHub Actions artifact digest and artifact-attestation documentation for integrity/provenance;
- the storage provider's current object consistency/immutability/versioning documentation;
- platform signing/notarization requirements for the target operating system.

Re-check current provider behavior before changing a production updater. Release infrastructure ages quickly.
