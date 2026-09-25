# Veteran Engineering Studio

Veteran Engineering Studio is one cross-host engineering plugin with two cooperating Skills, one shared Mission/MCP runtime, one durable control plane, and thin host adapters for Codex, Hermes, generic MCP hosts, and future integrations.

- `runtime-regression-debugger` is the Veteran Full-Stack Engineer control plane for repository takeover, architecture, backend/data, debugging, migrations, release, operations, and cross-host engineering execution. It now includes a routed Python Agent engineering profile for explicit state lifecycles, strict tool schemas, bounded execution loops, resilient external calls, and Agent-specific boundary validation.
- `frontend-design-builder` is the specialist UI/frontend design and implementation layer for visual direction, design-system reuse, design-to-code, responsive behavior, motion, accessibility, and rendered visual QA.

The Full-Stack Engineer keeps end-to-end ownership. Material UI/UX work routes into Frontend Design Builder, and broader backend/data/infrastructure/release concerns route back to the Full-Stack Engineer.

The GitHub repository `9529360-cpu/veteran-engineer` is the implementation source of truth. Current repository/runtime evidence and executable gates outrank old exported artifacts, historical claims, or remembered checkpoints.

## Visual Design Authority

Substantial new UI, major redesigns, and explicit visual-quality recovery work now pass a blocking design gate before deep implementation. Frontend Design Builder must inspect the current product and system, materialize a real visual direction when capable tools exist, compete meaningfully different directions when the target is unresolved, reject generic AI-template patterns, lock one visual target/design contract, and only then proceed into deep frontend code.

The gate is intentionally not a numeric beauty score. It rejects process and evidence failures that repeatedly produce weak AI UI: code-first design, card soup, meaningless badges/gradients, generic dashboard shells, weak hierarchy/typography, text-only concepts despite available visual tools, and handoff without direct rendered comparison.

## Design Action Fabric

Frontend Design Builder now uses a provider-neutral Design Action Fabric instead of hard-wiring design execution to one vendor. The current Figma provider can supply structured design context, screenshots, variables, libraries, Code Connect, motion, canvas writes, live URL capture, asset import/export, FigJam diagrams, Slides, shaders, and generative tools when those host capabilities are actually connected.

The routing contract is capability-first: the Skill inventories what the current host can really do, loads only the workflow required for the active design phase, executes through the strongest provider, and degrades to repository/browser/image/code-native evidence when a design provider is unavailable. Figma remains the richest current provider, but it is not the permanent architecture of Veteran.

## Veteran Machine Bridge

Veteran Remote Host now includes an opt-in cross-device Machine Action Fabric for web-first engineering. It exposes only two intention-level MCP tools: `machine_inspect` for read-only device/files/process evidence and `machine_act` for request-id protected filesystem/process actions. Operators must explicitly enable the bridge and configure workspace roots plus executable policy; it is an application-level policy boundary, not an OS sandbox.

The bridge is designed for ChatGPT Web and other remote MCP-capable hosts that need local checkout state, terminal execution, persistent process sessions, local services, or desktop/runtime evidence without depending on a third-party desktop-control provider.

## Studio contract and versioning

This repository has two intentionally separate version domains:

- `plugin.json` versions the portable/workspace **Veteran Engineering Studio** plugin.
- `package.json` plus `.codex-plugin/plugin.json` version the **Veteran runtime/MCP** compatibility surface and must stay aligned with each other.

Do not force these numbers to match unless the same change actually releases both domains. The Studio plugin may evolve its Skills and packaging without pretending the runtime protocol changed; runtime releases may evolve independently while preserving the Studio composition contract.

The Studio keeps one accountable delivery path. `runtime-regression-debugger` owns whole-product/repository engineering and integration. `frontend-design-builder` owns material UI/frontend design and implementation phases, then returns implementation evidence, intentional deviations, and unresolved UI gaps to the full-stack owner. CI validates this composition and both Skill packages together.

Skill discovery is metadata-driven: both packaged Skills expose interface metadata, while their frontmatter descriptions define the routing boundary. `runtime-regression-debugger` is the whole-product/full-stack owner and `frontend-design-builder` is the bounded UI/frontend specialist. Do not reintroduce unsupported ChatGPT/Codex/API/Atlas product-policy values or `allow_implicit_invocation`; the Workspace registry must discover both Skills without a second invocation-policy block.

## Design intelligence stack

The frontend specialist uses a source-aware design workflow rather than treating every reference as equivalent:

- **Figma + Code Connect** for structured design intent, variables, component properties, libraries, and mapping to production components.
- **Storybook / component labs** for implemented APIs, state coverage, interaction checks, accessibility checks, and visual regression when the repository already has those systems.
- **Mobbin-style reference research** for mature screens, flows, and web sections; these sources are inspiration until explicitly promoted to a target.
- **Live product + browser renders** for current behavior and final implementation evidence.
- **Screenshots/mockups/exports** for accepted visual targets when structured design data is unavailable.
- **Image-generated concepts** for new visual directions before a target is selected.
- **Product-design cycle** for evidence-first audit, targeted research, distinct concept exploration, implementation, and blocking visual QA when the work is broader than direct coding.
- **Cross-tool design-system sync** for reconciling Figma variables/components, code tokens/APIs, Storybook states, Code Connect mappings, and the rendered product without creating parallel authorities.
- **Figma capability routing** for design-to-code, code-to-design, component libraries, Code Connect, motion, SwiftUI, FigJam diagrams, and specialized effects/automation only when those modes are actually requested.
- **Live URL reconstruction** for authorized evidence-first desktop/mobile capture, interaction/asset inventory, code-native recreation, and same-state visual comparison; redesign requests stay separate from clone mode.

The design-source authority model prevents accidental mixing of "what exists", "what should exist", and "what merely inspired the direction".

## Current checkpoint

Current development version is `0.5.0`; the latest public release is `v0.4.0`. State schema remains `3`. The public MCP surface remains exactly **36 tools**.

Protocol support is intentionally split:

- official TypeScript SDK path: modern `2026-07-28` and legacy `2025-11-25`;
- standalone fallback: legacy `2025-11-25` only;
- a modern pin never silently falls back;
- `VETERAN_MCP_REQUIRE_SDK=1` fails closed when the pinned official SDK graph is unavailable or invalid.

The pinned base dependency graph is:

- `@modelcontextprotocol/client@2.0.0`
- `@modelcontextprotocol/server@2.0.0`
- `@modelcontextprotocol/core@2.0.0`
- `zod@4.2.0`

Current integration gates prove:

1. `npm run check`: exact **36-tool** surface, protocol constants, pinned SDK lock integrity, syntax, runtime-starter mirror parity, and the full Node regression suite;
2. a real Docker engine-backed confined `WorkerAdapter` smoke;
3. a real PostgreSQL engine-backed state-backend contract/durability integration gate, followed by the real modern MCP handshake while PostgreSQL is the active state backend;
4. profile-aware Desktop/Codex/Web plugin artifact export with reproducibility and package-boundary checks;
5. release-candidate reproducibility for the canonical runtime asset plus public release checksum verification before and after publication.

The bundled recovery seed under `skills/runtime-regression-debugger/assets/plugin-runtime-starter/` is part of the product contract. The main validation gate now compares the mirrored runtime file set and file contents against the repository runtime so root/starter drift fails CI instead of becoming a future recovery surprise.

## Remote repository onboarding

`project_open` now accepts exactly one source: an existing local `repoPath` or an authorized `repoUrl`. A remote URL is cloned into the runtime-managed project area under the execution-local state root, so an operator can hand Veteran a repository address without manually preparing a checkout first. The public MCP surface remains 36 tools; this extends the existing project intent instead of adding a raw Git primitive.

Remote acquisition is deliberately conservative:

- credential-free HTTPS, SSH, SSH scp-style, and local `file://` Git URLs are accepted; embedded HTTPS credentials, query strings, fragments, and unsupported remote-helper protocols are rejected;
- private repositories must authenticate through the operator's normal Git credential helper or SSH agent, so secrets are not placed in tool arguments or durable project state;
- clone runs with hooks disabled and does not recurse into submodules automatically;
- the managed checkout path is deterministic for the normalized remote and concurrent opens serialize through a local acquisition lock;
- a reused managed checkout fetches origin and advances only by fast-forward; dirty, detached, or locally diverged source checkouts fail closed instead of being reset;
- `refreshRemote=false` is an explicit opt-out for intentional offline/stale reuse;
- local repositories with credential-bearing origin URLs are stored only with a sanitized remote URL.

The managed source checkout is still outside the worker mutation surface. Mission and task changes continue to occur only in runtime-owned worktrees.

## Mission and authority model

The runtime keeps the user checkout outside the multi-agent mutation surface. Mission and task work occurs in isolated Git worktrees. Workers may propose writes, but the runtime owns task identity, packet identity, HEAD authority, actual-write verification, task commits, deterministic serial integration, proof binding, and final candidate identity.

The mission lifecycle is:

`execution -> validation -> deterministic review -> semantic review -> immutable candidate -> finalize`

Finalize does not merge or push. A proof-fresh candidate produces a durable merge proposal containing candidate/source/proof identity with:

- `automaticMerge:false`
- `automaticPush:false`
- `requiresOperatorAction:true`

Source or mission drift supersedes the proposal and forces candidate refresh plus revalidation/re-review. Stable retries reuse the same proposal; missing finalize evidence after a partial failure is repaired rather than inventing a new authority.

## Worker execution boundaries

The built-in Codex preset uses `codex exec --sandbox workspace-write --ephemeral` and rejects dangerous sandbox/approval bypass flags.

The built-in `container` worker is fail-closed and requires Docker or Podman, a digest-pinned image, disabled network, read-only root filesystem, all Linux capabilities dropped, `no-new-privileges`, bounded resources, bounded `noexec,nosuid` `/tmp`, controlled mounts, and allowlist-only environment forwarding.

Only the isolated task worktree is writable. The task packet and `.git` control file are read-only from the container. Confined containers default to the host numeric UID:GID when available so private `0600` task packets remain readable without producing root-owned worktree output. An explicit operator `user` remains authoritative.

Container isolation is defense-in-depth. Post-execution HEAD, symlink containment, declared write scope, commit ownership, and serial integration checks remain mandatory. `custom-unconfined` still requires explicit operator opt-in and remains blocked for high/critical/broad-write tasks.

## Durable state contracts

Veteran now has three explicit internal state-backend contracts:

- `veteran-state-backend-v1`: base runtime state surface;
- `veteran-state-transaction-v1`: opaque revisions plus `readSnapshot()` / `compareAndCommit()`;
- `veteran-state-durability-v1`: durable commit-outcome reconciliation plus `reconcilePendingAudit()`.

`createVeteranApp` fails closed unless an injected backend satisfies all three contracts.

### Local JSON

Local JSON remains the default backend. It retains cross-process locking, atomic state-file replacement, backup recovery, append-only audit hash chain, requestId idempotency, commit/audit reconciliation, and startup conversion of orphaned `started` request outcomes to `unknown`.

A state mutation carries a durable `stateCommitId`. If state replacement succeeds but audit append/acknowledgement becomes ambiguous, Veteran reports an unknown durable outcome rather than pretending normal success or failure. Startup and the next mutation reconcile the latest state commit against the verified audit chain. Missing audit is repaired exactly once; an already-appended entry is accepted without duplication; malformed/tampered/mismatched history fails closed.

### PostgreSQL hosted backend

PostgreSQL is the first hosted transactional backend. It is opt-in; Local JSON remains the default.

Select it with either programmatic `stateBackendConfig` or these environment variables:

```bash
export VETERAN_ENGINEER_STATE_BACKEND=postgres
export VETERAN_ENGINEER_POSTGRES_URL='postgresql://user:password@host/database'
export VETERAN_ENGINEER_STATE_INSTANCE='stable-runtime-instance-key'
# optional, 1..32; default 4
export VETERAN_ENGINEER_POSTGRES_POOL_MAX=4
```

The hosted backend requires the exact runtime capability `pg@8.23.0`. The base package/lock graph deliberately remains the already-verified MCP dependency graph; operators enabling PostgreSQL must install that exact driver in the shared runtime before launch. CI proves the hosted path by installing `pg@8.23.0`, starting a digest-pinned real PostgreSQL container, running backend conformance/durability/concurrency tests, then running the real modern MCP handshake with PostgreSQL selected.

PostgreSQL state and audit append commit in one SQL transaction. Each durable state identity is serialized at the database boundary, state rows use `FOR UPDATE`, CAS revisions remain explicit, and post-COMMIT acknowledgement loss is reconciled by durable commit identity before Veteran decides whether replay is safe. Integration proof includes two independent backend instances/connection pools targeting the same `instanceKey` without lost updates or audit divergence.

## Request idempotency and unknown outcomes

Every mutating MCP operation requires a `requestId`. Reuse with a different operation/payload is rejected. Completed requests replay their recorded result; failed requests replay failure; `unknown` outcomes are never replayed blindly. New request identities store a SHA-256 payload fingerprint rather than the raw request JSON, so idempotency does not become a durable copy of goals, paths, repository URLs, or future sensitive arguments. Legacy raw fingerprints remain replay-compatible.

Admission carries an internal attempt identity. If request admission itself becomes ambiguous, only the invocation that owns the durable reservation may continue after reconciliation. If a handler mutation may already have committed, the request becomes `unknown`, not falsely `failed`. If only completion acknowledgement is ambiguous, Veteran returns success only after durable state proves the request is already `completed`.

## Cross-surface runtime profiles

Veteran Engineer now separates the engineering core from the product surface through `veteran-surface-capabilities-v1`. The built-in runtime profiles are:

- `local-stdio`: direct local hosts; local repository paths and remote Git takeover are available;
- `remote-mcp`: hosted/remote MCP; caller-local paths and `file://` URLs are rejected and project takeover must use a network `repoUrl`;
- `secure-tunnel`: the runtime remains on a developer/private-network machine but is reachable through a secure MCP tunnel, so paths on that runtime machine remain valid.

`runtime_health` reports the effective surface profile. Unknown profiles fail closed. Generic MCP descriptors can select a topology with `--surface-profile`, including `secure-tunnel`. Tunnel provisioning itself remains an external OpenAI/workspace control rather than an undocumented command embedded in Veteran.

Distribution is now profile-aware. `export_plugin_bundle.py --profile desktop|codex|web` builds all surfaces from the same Skill source. Desktop/Codex profiles include the local runtime and `.mcp.json`; the Web profile intentionally excludes local MCP/runtime files so it is not made Desktop-only by its package contents. A Web package may reference a complete caller/workspace-supplied `.app.json`, but Veteran never invents app IDs, OAuth settings, remote MCP URLs, or tunnel configuration.

## Cross-host installation

The default shared runtime root is `~/plugins/veteran-engineer`. Durable runtime state is separate at `~/.veteran-engineer/state`, and installer ownership metadata lives at `~/.veteran-engineer/installer.json`.

For a fresh machine, download `veteran-engineer-bootstrap.mjs` from the desired stable GitHub Release (or the latest release) and run it directly with Node 20+:

```bash
node veteran-engineer-bootstrap.mjs install generic
# local host integrations
node veteran-engineer-bootstrap.mjs install codex
node veteran-engineer-bootstrap.mjs install hermes
# pin the bootstrap to an exact stable release when required
node veteran-engineer-bootstrap.mjs install generic --release v0.4.0
```

The bootstrap refuses to overwrite an existing runtime. Before promotion it self-verifies against the selected GitHub Release asset digest, verifies the release manifest and canonical runtime checksum, validates every runtime file, prepares the pinned base dependency graph with `npm ci --include=optional --omit=dev --ignore-scripts`, verifies the required MCP SDK packages actually installed, and only then atomically promotes the runtime and binds the selected host. Network, digest, bundle, or dependency failures leave no active runtime. If host binding itself fails after promotion, the verified runtime is deliberately left in place for explicit repair rather than being removed underneath a potentially partial host-side mutation.

For an existing installation, use the lifecycle CLI:

```bash
node bin/veteran-engineer.mjs hosts
node bin/veteran-engineer.mjs status
node bin/veteran-engineer.mjs doctor
node bin/veteran-engineer.mjs upgrade --release latest
# or pin an exact stable release
node bin/veteran-engineer.mjs upgrade --release v0.4.0
```

Codex, Hermes, generic MCP, and trusted external adapters bind the same shared runtime; hosts do not fork the engineering core. Local repair still re-synchronizes the caller's distribution. Remote upgrade resolves only a public, non-prerelease GitHub Release, requires an exact release commit, verifies GitHub asset SHA-256 metadata plus the release manifest/checksum, validates every file in the canonical runtime bundle, stages it outside the active runtime, then atomically swaps the shared runtime and rebinds every recorded host. Existing `node_modules` capabilities are preserved only when the target dependency graph is identical; dependency-graph changes fail closed instead of reusing stale packages. Downgrades are rejected.

The canonical runtime and standalone bootstrap release assets are separate from the Desktop/Codex/Web plugin archives, so lifecycle management does not depend on a product-specific ZIP layout or an external unzip/tar binary.

## Development validation

Base gate:

```bash
npm ci --include=optional
npm run check
```

Real container worker proof:

```bash
VETERAN_CONTAINER_SMOKE_IMAGE='registry/image@sha256:<digest>' npm run test:container-smoke
```

Real PostgreSQL backend proof requires `pg@8.23.0` plus `VETERAN_TEST_POSTGRES_URL`:

```bash
npm install --no-save --package-lock=false pg@8.23.0
VETERAN_TEST_POSTGRES_URL='postgresql://...' npm run test:postgres
```

Protocol checks:

```bash
node scripts/mcp-handshake.mjs --mode legacy --force-fallback
node scripts/mcp-handshake.mjs --mode modern-pinned --require-sdk --require-server-sdk
node scripts/mcp-handshake.mjs --mode auto --require-sdk --force-fallback
```

Fallback results are never counted as modern-protocol proof.

## Convergence status

The current architecture has been reviewed across Mission finalize, worker isolation/process ownership, adaptive Mission execution, provider boundaries, interruption/restart reconciliation, durable state, remote onboarding, cross-host packaging, and real Docker/PostgreSQL execution boundaries.

The convergence pass has closed concrete authority and lifecycle defects rather than expanding the public surface:

- root/runtime-starter synchronization is executable CI policy, not a documentation promise;
- remote project onboarding no longer requires a manual local clone, while managed checkout refresh remains credential-safe and fast-forward-only;
- hosted PostgreSQL has cross-instance concurrency and durable-outcome evidence, not only same-process/same-pool coverage;
- adaptive Mission strategy now preserves explicit risk intent through planning and execution-capacity policy without growing the public MCP surface;
- planner/reviewer provider configuration fails fast and provider evidence redacts allowlisted secret values before durable persistence;
- interruption recovery preserves unresolved task authority across repeated resume and partial retry;
- Mission status/readiness cannot outrun authoritative execution task state: failed/cancelled/interrupted work stays blocked, while admitted/dispatched/executing/cancelling work keeps next-transition readiness false;
- current capacity/lease and multi-Mission contention behavior remains unchanged where existing reservation/reconciliation tests already prove the contract.

No convergence review found a reason to weaken the 36-tool compatibility surface, change state schema 3, relax fail-closed behavior, or move merge/push/deploy authority into the runtime.

## Deliberate deferrals

`v0.3.0` was the first durable public release; the latest public release is `v0.4.0`, and `0.5.0` is the current development line. Packaging the PostgreSQL driver into the base dependency graph remains a separate distribution/versioning decision; today it is an explicit hosted capability prerequisite. Managed database migrations beyond the current v1 schema bootstrap and automatic operator merge/push remain intentionally out of scope.
