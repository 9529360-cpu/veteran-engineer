# SDK and library product engineering

Use this for reusable libraries, client SDKs, published packages, shared modules, generated clients, and language bindings that other codebases consume as dependencies. Treat a library as a product with independently upgrading consumers, not as application-internal code that can be changed atomically with every caller.

## Contents

- Compile the consumer contract
- Recover public-surface authority
- Compatibility dimensions and semantic versioning
- Types, symbols, defaults, and behavioral compatibility
- Dependencies and peer/runtime ownership
- Package entrypoints and artifact shape
- Generated SDKs and schema authority
- Network/client SDK behavior
- Deprecation, migration, and removal
- Documentation and examples as contract surfaces
- Multi-runtime and platform support
- Publishing, provenance, and package identity
- Consumer validation and compatibility matrices
- Whole-slice completion

## Compile the consumer contract

Start from the consumer-observable transition:

`consumer import/install -> construct/configure -> call/await/iterate -> returned value/error/effect -> upgrade to new package version`

Capture only constraints that change implementation:

- package/artifact name and registry/channel;
- supported language/runtime/compiler/platform versions;
- public entrypoints, symbols, types, constants, defaults, errors, callbacks/events, async/cancellation semantics, serialization/wire formats, and side effects;
- supported consumer frameworks or host environments;
- compatibility policy and versioning policy, including pre-1.0 expectations if relevant;
- old/new package coexistence across independently deployed consumers;
- generated versus handwritten surface ownership;
- runtime, peer, optional, bundled, and development dependency responsibilities;
- artifact formats and module/loading modes;
- release/publishing identity and rollback/yank/deprecation constraints.

A passing internal repository test does not prove a consumer can install the package, import the documented symbol, compile against the emitted types, or upgrade without behavioral breakage.

## Recover public-surface authority

Map the real public contract before editing:

`authoritative source/schema -> public symbols/types -> build/codegen -> package entrypoints/artifact -> registry version -> consumer resolution`

Inspect, when material:

- explicit export/public modules and package export maps;
- generated bindings and their authoritative schema/generator;
- emitted type declarations/header files/metadata;
- package manifests and included/excluded files;
- runtime-specific build targets, feature flags, conditional exports, or platform variants;
- compatibility/deprecation annotations;
- package lock or dependency constraints used by consumer fixtures;
- publishing workflow/version authority.

Do not infer the public API only from language visibility. A technically exported symbol may be undocumented/internal by contract, while a generated or re-exported symbol may be the real supported surface.

Avoid creating two authorities. If OpenAPI/protobuf/schema/codegen owns an SDK, change the schema/generator/templates and regenerate rather than hand-editing derivative client files.

## Compatibility dimensions and semantic versioning

Versioning is a promise about consumer breakage, not a diff-size counter.

Evaluate at least the compatibility dimensions that apply:

- **source compatibility** - existing consumer source still compiles/typechecks/interprets;
- **binary/ABI compatibility** - already-compiled consumers still load/link where the ecosystem has ABI concerns;
- **type compatibility** - inferred/generic/nullability/variance/overload behavior remains acceptable;
- **runtime compatibility** - supported runtime/platform/module-loader combinations still work;
- **behavioral compatibility** - same valid call produces contract-compatible outcome, ordering, errors, timing, and side effects;
- **wire/data compatibility** - serialized requests/responses/events/persisted values remain readable across versions;
- **artifact compatibility** - documented import paths, package files, metadata, native assets, and entrypoints still resolve.

Use semantic versioning only when the project actually follows it. If it does, classify version impact from the supported consumer surface, not from maintainer intent.

A change can be breaking even when signatures compile: changing defaults, retry policy, exception type, ordering, callback timing, cancellation, serialization, network headers, auth behavior, or accepted ranges can break consumers.

Conversely, an internal refactor is not a breaking change merely because many source lines changed when the public contract is proven equivalent.

## Types, symbols, defaults, and behavioral compatibility

Review public changes as a consumer would experience them.

Potentially breaking changes include:

- removing/renaming/moving a public symbol or import path;
- narrowing accepted inputs or widening outputs in a way consumer type systems reject;
- changing generic bounds, variance, overload selection, nullability, optionality, enum exhaustiveness, trait/interface requirements, or callback shape;
- changing defaults that alter requests, performance, retries, timeouts, caching, security, or persistence;
- replacing one stable error/exception/result category with another;
- changing sync/async behavior, callback order, event order, stream termination, pagination, iterator semantics, or cancellation;
- making formerly lazy work eager or vice versa when side effects/performance are observable;
- changing thread-safety/concurrency guarantees;
- changing object identity/mutability or copy/reference ownership.

Do not add compatibility overloads/shims indefinitely without an owner and removal condition. Compatibility layers are product debt with lifecycle obligations.

## Dependencies and peer/runtime ownership

A library's dependency graph becomes part of the consumer's environment.

Classify dependencies deliberately:

- **runtime/direct** - the package needs and owns a compatible resolved dependency;
- **peer/provided-by-host** - the consumer/runtime must provide a compatible version;
- **optional/feature** - capability is conditional and failure/degraded behavior must be explicit;
- **bundled/vendored** - bytes ship inside the artifact and the library owns update/security consequences;
- **development/build/test** - not required by normal consumers.

Avoid accidentally leaking internal dependency types into public APIs; doing so can turn a private dependency upgrade into a consumer-facing breaking change.

Peer ranges should express actually tested compatibility, neither artificially pinning consumers nor claiming versions never validated. Optional dependency absence should fail or degrade intentionally, not through late import/link errors.

Use `references/dependency-supply-chain-patterns.md` for dependency provenance, vulnerability, lockfile, and CI supply-chain concerns.

## Package entrypoints and artifact shape

The package artifact is part of the API.

Validate the installed/published shape, not only source directories:

- expected files are included and development/secrets/private fixtures are excluded;
- documented entrypoints resolve from a clean consumer;
- public subpath imports remain intentional;
- generated types/declarations/headers/source maps/native libraries/resources are present when promised;
- package metadata points to real files;
- executable bits/native platform metadata are correct where needed;
- dual module formats or conditional exports expose semantically equivalent supported surfaces;
- tree-shaking/side-effect metadata does not erase required initialization;
- runtime/compiler compatibility matches emitted syntax/bytecode/ABI.

For JavaScript/TypeScript, treat `exports`, CommonJS/ESM conditions, `types`, browser/node conditions, and deep-import behavior as public resolution contracts when consumers rely on them. Do not leave undeclared deep imports accidentally stable if the package intends to reserve internals.

For Python wheels/sdists, Rust crates, NuGet/Maven artifacts, native libraries, and other ecosystems, inspect the actual packed artifact and metadata through the ecosystem's normal consumer path.

## Generated SDKs and schema authority

Generated SDKs are versioned products even when source files are machine-produced.

Preserve:

`authoritative schema -> exact generator/templates/config -> generated semantic diff -> package version -> consumer validation`

- pin or identify the generator/template/config version used for evidence;
- regenerate deterministically from the authoritative contract;
- review semantic generated changes instead of accepting volume as noise;
- prevent handwritten drift inside generated files unless an explicit supported extension mechanism exists;
- keep naming, pagination, error, auth, nullability, enum, and unknown-field policies stable across regeneration where promised;
- validate old/new server and client combinations when rollout is independent;
- avoid generating a new SDK that requires a server version not yet safely available to consumers.

Use `references/cross-repo-contract-mesh.md` when the schema, SDK, server, and consumers live or deploy independently.

## Network/client SDK behavior

Client SDKs own more than request serialization.

Define, where material:

- endpoint/base-URL/environment selection;
- auth/credential injection and refresh ownership;
- timeout and cancellation semantics;
- retryable status/errors and backoff;
- idempotency identity for retryable mutations;
- pagination/iteration and streaming behavior;
- rate-limit metadata and retry-after handling;
- user-agent/client-version headers;
- proxy/TLS/transport customization;
- request/response validation and unknown fields;
- stable error/result taxonomy;
- observability hooks that do not leak credentials or payloads.

Do not silently retry non-idempotent operations merely because a transport failed. Timeout-after-commit and connection-loss outcomes may be unknown.

Keep authorization on the server/service boundary; SDK convenience checks are not security authority.

## Deprecation, migration, and removal

Deprecation is a consumer migration program, not an annotation alone.

A useful deprecation includes:

- the old surface and why it is being replaced;
- the supported replacement and migration example;
- version/time policy for removal when the project has one;
- telemetry/adoption evidence when available and privacy-appropriate;
- compatibility shim owner and removal condition;
- explicit behavior for unsupported old consumers after the window closes.

Prefer additive introduction -> consumer migration -> evidence -> removal over atomic rename/removal across independently upgrading users.

For package registry ecosystems, deprecating/yanking/unlisting an artifact has different consequences from publishing a fixed version. Avoid destructive registry actions as a substitute for compatibility planning.

Use `references/lifecycle-closure-design-to-deletion.md` when retiring old surfaces or compatibility paths.

## Documentation and examples as contract surfaces

For a library, examples are executable promises.

- Compile/typecheck/run representative documented examples against the packed artifact where practical.
- Keep snippets on supported import paths and current defaults.
- Include migration examples for breaking or deprecated surfaces.
- Do not document internal symbols merely because autocomplete exposes them.
- Verify generated API docs against the actual exported/public surface.

A README example that only works from the monorepo because of workspace aliases, unpublished files, or undeclared dependencies is a packaging defect.

## Multi-runtime and platform support

Support matrices need evidence.

For each claimed runtime/compiler/platform version consider:

- emitted syntax/bytecode/ABI;
- standard-library/API availability;
- native dependency/prebuilt binary availability;
- filesystem/network/TLS/threading differences;
- module loader/resolution behavior;
- architecture/OS-specific packaging;
- minimum-version tests and latest-supported tests.

Do not broaden metadata compatibility ranges just because the package builds on one current environment.

When dropping an old runtime/compiler/platform, treat that as consumer-visible compatibility change even if library APIs are unchanged.

## Publishing, provenance, and package identity

Release identity should connect exact source to exact public artifact:

`source/head -> build/codegen identity -> packed artifact -> package version -> registry digest/provenance -> consumer install`

Before publication verify:

- version authority and tag/release relationship;
- clean reproducible package contents;
- registry/package name and scope;
- expected entrypoints/types/native assets;
- dependency/peer ranges;
- licensing/notices/provenance/SBOM/signature requirements where applicable;
- no credentials, local paths, private fixtures, debug-only files, or unpublished workspace assumptions;
- consumer install from the exact package/tarball/wheel/crate/artifact.

A successful repository build is weaker evidence than installing the exact packed artifact into a clean consumer.

Use `references/release-promotion-patterns.md` for release topology and `references/dependency-supply-chain-patterns.md` for provenance/trust boundaries.

## Consumer validation and compatibility matrices

Validation should prove the changed consumer contract.

Use, as applicable:

- API/export/type diff tools as navigation, not automatic breaking-change oracles;
- clean consumer fixtures that depend on the packed artifact rather than workspace source;
- minimum/current supported runtime/compiler matrices;
- old consumer -> new library tests;
- old library -> new consumer tests when bidirectional compatibility matters;
- generated-client -> old/new server contract tests;
- import/load/link smoke from every supported entrypoint/module format;
- package-content inspection;
- representative examples/docs tests;
- ABI/binary compatibility tooling for ecosystems that require it;
- performance/allocation/bundle-size checks when consumers depend on those budgets.

For breaking-change claims, keep at least one representative historical consumer or contract fixture that would fail if compatibility regresses.

Do not treat internal unit tests as the strongest boundary when the real risk is package resolution, consumer compilation, ABI loading, or server/SDK mixed versions.

## Whole-slice completion

A library change is not complete because its own repository compiles. Close the implied responsibilities: public surface, types/defaults/errors/behavior, version impact, dependency ownership, generated sources, package entrypoints/content, consumer installation, runtime/platform matrix, docs/examples, deprecation/migration, release identity, and representative old/new consumer compatibility.

Prefer additive compatible evolution and repository-native packaging conventions. Do not redesign module systems, code generators, package managers, or versioning policy without concrete pressure from the requested contract.
