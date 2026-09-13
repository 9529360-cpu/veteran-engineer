# Cross-Surface Runtime Architecture

Use this when the same Veteran Engineer product must work across ChatGPT Web, ChatGPT Desktop, Codex, local MCP hosts, or a secure tunnel to a developer/private-network runtime.

## Core invariant

Do not fork the engineer by product surface.

Keep:

`one Skill/policy + one Mission/runtime core + one tool contract + surface capability profile + thin binding/packaging edge`

The surface is an execution constraint, not a new engineering personality.

## Capability negotiation

Route from capabilities, not brand names. Veteran currently defines `veteran-surface-capabilities-v1` with these built-in profiles:

- `local-stdio` - runtime is local to the host; caller-local repository paths and remote Git acquisition are allowed;
- `remote-mcp` - runtime is remote from the caller; caller-local paths are meaningless and must fail closed, while `repoUrl` acquisition remains available;
- `secure-tunnel` - runtime remains on a developer/private-network machine but is reachable through a remote MCP tunnel; local paths are valid on that runtime machine.

`runtime_health` must report the effective profile. Unknown profile names fail closed.

Do not persist a surface profile as repository truth. It describes the current runtime topology and can change between sessions without changing the project.

## Repository source rule

Keep `project_open` as the single intent. Do not add one tool per host.

- `local-stdio` / `secure-tunnel`: allow `repoPath` or `repoUrl` according to existing project-open rules.
- `remote-mcp`: reject `repoPath` and `file://`; require a network `repoUrl` so a remote caller cannot address arbitrary runtime-local filesystem state.

A web client path such as `C:\work\repo` is not evidence that a hosted MCP service can access that machine.

## OpenAI Web versus local packaging

Treat local MCP declaration and web app binding as different distribution concerns.

For current OpenAI plugin surfaces, a plugin that embeds `mcp.json` or `.mcp.json` can be classified Desktop-only. Therefore:

- desktop/Codex local distributions may embed `.mcp.json` and the local runtime;
- web distributions must not embed the local MCP manifest/runtime merely to reuse the same ZIP;
- a web distribution may remain Skill-only, or reference an already-configured app through caller/workspace-supplied app metadata;
- never invent an app ID, OAuth configuration, remote MCP URL, or tunnel provisioning contract.

Use `scripts/export_plugin_bundle.py --profile desktop|codex|web`.

If a web app reference is needed, pass a complete platform-managed `.app.json` with `--app-manifest`. Treat that file as opaque external configuration and preserve it byte-for-byte.

## Secure MCP Tunnel boundary

A tunnel changes transport reachability, not engineering authority.

The local/private Veteran runtime still owns repository checkout, worker execution, validation, evidence, and state. The tunnel must not become a raw remote shell or bypass Veteran's intention-level tool surface.

Tunnel provisioning, workspace association, authentication, and app publication are external platform controls. Until OpenAI exposes a stable machine-consumable provisioning contract, support the topology through `secure-tunnel` capability/profile configuration and portable MCP descriptors rather than hard-coding undocumented setup commands.

For a generic local descriptor intended to sit behind a tunnel, use the installer option:

`--surface-profile secure-tunnel`

## Distribution profiles

All profiles come from the same repository source and same Skill.

- `desktop`: Skill + local runtime + `.mcp.json`; local execution profile.
- `codex`: Skill + local runtime + `.mcp.json`; same core, Codex binding at the edge.
- `web`: Skill-first package with no local MCP/runtime. Actions require a separately approved app/remote MCP/tunnel connection.

Each exported plugin includes `veteran-distribution.json` so operators can inspect which profile they received without guessing from filenames.

## Validation contract

For cross-surface changes, prove at least:

1. one unchanged public MCP tool count/name surface;
2. profile resolution and unknown-profile fail-closed behavior;
3. local path accepted under local/tunnel topology and rejected under remote-MCP topology;
4. generic descriptor carries the selected surface profile;
5. web export contains no `.mcp.json` or local MCP server;
6. local export still contains the same runtime and Skill;
7. root runtime and bundled recovery starter remain byte-for-byte aligned.

Do not call surface portability complete merely because the same Skill file can be uploaded in several products. The execution and packaging boundary must also match the host's real capabilities.
