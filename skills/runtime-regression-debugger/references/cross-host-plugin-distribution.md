# Cross-host Plugin Distribution

Use this when packaging, installing, upgrading, repairing, diagnosing, or extending Veteran Engineer across agent hosts.

## Product invariant

Veteran Engineer is one product with one engineering core and one runtime distribution. Host integration is an edge concern.

Keep this boundary:

`Skill/policy + Mission/MCP runtime -> Host Adapter -> Host-specific registration`

Do not fork the Mission engine, worker scheduler, state model, evidence model, or engineering Skill per host. Do not make Codex, Hermes, or another host the authority for core project state.

## Surface capability contract

Host branding is not a core routing primitive. Resolve the runtime topology through `veteran-surface-capabilities-v1` and route by capabilities. Use `local-stdio` for direct local hosts, `remote-mcp` when the runtime is hosted away from the caller, and `secure-tunnel` when a developer/private-network runtime is exposed through an approved tunnel. Read `cross-surface-runtime-architecture.md` when Web/Desktop/Codex parity, tunnel topology, or multi-profile packaging is active.

## Shared installation model

Install one versioned runtime tree, normally under `~/plugins/veteran-engineer`, and let multiple host adapters point to that tree. Keep installer metadata outside the runtime so a runtime refresh cannot erase host ownership information.

Maintain:

- one shared runtime root;
- one installer state file recording bound hosts, installed version, and distribution digest;
- one durable project-state directory independent of any one host;
- thin host-owned config entries that can be added, repaired, or removed independently.

Uninstalling one host binding must not delete the shared runtime while another host still references it. Purge the runtime only through an explicit final-host cleanup action.

## Host Adapter contract

A host adapter must define:

- `apiVersion`: integer Host Adapter API version supported by the installed runtime;
- `id`: stable lowercase identifier matching `[a-z][a-z0-9-]{1,63}`;
- `displayName`: human-readable host name;
- optional `capabilities`: declarative metadata only;
- `install(context)`: register the shared runtime and, when supported, expose the bundled Skill;
- `status(context)`: inspect current binding without mutation;
- `doctor(context)`: prove the host can see the installed surfaces and report actionable checks;
- `uninstall(context)`: remove only Veteran Engineer-owned host surfaces.

The adapter context includes the resolved user home, shared plugin root, and operator environment. Treat those as inputs; do not silently relocate core state into a host-specific directory unless the host contract requires a projection or copy.

## Preserve host-owned state

Never rewrite an entire host config when an owned subtree or entry can be updated surgically. Before mutation:

1. parse or conservatively locate the owned section;
2. preserve unrelated entries and comments when practical;
3. back up an existing config before replacement;
4. make repeat installation idempotent;
5. make uninstall remove only the entry or files owned by Veteran Engineer.

If a host configuration format cannot be changed safely without a real parser or supported host CLI, stop at a portable descriptor rather than guessing.

## Skill delivery

If the host supports Agent Skills, install or reference the same `runtime-regression-debugger` Skill that ships inside the distribution. Do not maintain a host-specific rewritten copy. Detect drift when a host requires a copied Skill directory and let `repair` restore the packaged version.

## MCP delivery

Prefer stdio for local host bindings and keep the public MCP surface intention-level. A host adapter should register the existing Veteran Engineer MCP server, not reimplement its tools. Generic MCP support should emit a portable descriptor when the target host's exact config contract is unknown.

Do not use one local-MCP plugin archive as the universal Web/Desktop artifact. Current ChatGPT web distribution treats imported plugins that declare `.mcp.json`/`mcp.json` as Desktop-only. Export local Desktop/Codex profiles with the runtime and MCP manifest, and export the Web profile without them. If Web actions are backed by an existing app, reference only caller/workspace-supplied app metadata; never fabricate app IDs, OAuth configuration, or tunnel setup.

## Lifecycle semantics

### Install

For an already-present distribution, synchronize the distribution first, then bind the requested host, then persist installer state. Repeated install must converge rather than duplicate entries.

For a fresh machine, use the standalone verified bootstrap release asset instead of requiring a repository clone. Bootstrap must refuse to overwrite an existing runtime, verify its own selected-release asset digest, verify the stable release identity/manifest/canonical runtime/checksums, materialize only into a sibling staging directory, and prepare the pinned base dependency graph there with lifecycle scripts disabled. Verify the required MCP SDK packages after package-manager completion because optional-dependency failure can otherwise be reported as a successful install. Only after those checks pass may bootstrap atomically promote the runtime and invoke the installed Veteran CLI to bind the selected built-in host.

Failures before promotion must leave no active runtime. A host-binding failure after promotion is different: preserve the verified runtime for explicit repair instead of deleting it beneath potentially partial host-owned configuration. Preflight known host CLI requirements before release download when practical.

### Doctor

Check both layers:

- distribution/runtime: Node/runtime requirements, manifests, MCP handshake, distribution drift;
- host binding: config entry, Skill projection, host CLI visibility or protocol probe when safely available.

Warnings may describe drift or missing optional CLIs; hard failures must identify a broken required surface.

### Repair

Re-synchronize the packaged distribution and reapply the host adapter. Repair must restore owned files without deleting unrelated host configuration.

### Upgrade

Refresh the shared runtime once, then reapply every host currently recorded as installed. Record per-host success or failure; never report a partial upgrade as globally successful.

For public release upgrades, treat the release as a verified source, not merely a download URL. Require a public/non-prerelease release bound to an exact commit, validate release-asset SHA-256 metadata, the release manifest/checksum, and every canonical runtime-bundle file before touching the active runtime. Materialize into installer-owned staging, then use the existing staged/atomic distribution swap and rebind hosts with the target release version as context authority. Reject downgrades. Preserve an existing dependency tree only when the target dependency graph is equivalent; if the dependency graph changed, fail closed and require an explicit dependency-migration path rather than carrying stale packages forward.

### Uninstall

Unbind one host without affecting other host bindings. Delete the shared runtime only when explicitly requested and no installed host remains.

## External adapters

Load third-party host adapters only from explicitly trusted directories. Do not recursively discover arbitrary modules from the user's machine, current repository, package cache, or PATH.

Validate every loaded adapter before invoking it. A malformed adapter should appear as invalid in host discovery and must not block healthy built-in adapters from operating.

Prefer a filename equal to the adapter id, such as `acme-agent.mjs` for `id: "acme-agent"`. Keep adapter code thin: host detection, config registration, diagnostics, and removal belong there; engineering behavior belongs in the shared core.

## Compatibility rule

A new host should normally require:

`new adapter + adapter tests + documentation`

not:

`changes to Mission engine + changes to MCP tools + changes to worker scheduler + host-specific Skill fork`

If onboarding a host requires core engineering behavior to branch on the host name, first ask whether the capability belongs in a generic core contract instead.
