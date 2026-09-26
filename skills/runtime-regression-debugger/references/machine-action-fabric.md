# Veteran Machine Action Fabric

Use this reference only when the current host actually exposes `machine_inspect` and `machine_act`.

## Contract

The public surface stays deliberately small:

- `machine_inspect` is read-only. Use it for device/policy status, bounded filesystem list/stat/read/digest/search, repository status/command planning/diffs, and managed process list/status/output.
- `machine_act` is mutating and request-id protected. Use it for bounded file write/append/mkdir/move and allowlisted process start/input/stop.
- every successful `machine_act` returns a `veteran-machine-action-receipt-v1` action identity. File mutations also return before/after SHA-256 fingerprints when regular-file content participates.
- `expectedSha256` is an optimistic file-content precondition for `fs.write`, `fs.append`, `fs.replace`, and the `fs.move` source. `fs.replace` requires a fresh digest plus an exact expected match count so a narrow code edit fails closed when either the file or intended replacement site drifted. `requireAbsent` rejects an already-present target/destination. `expectedRepoHead` binds filesystem mutations and `process.start` to the exact Git HEAD observed by `repo.status`.

Treat the selected Remote Host as the machine authority. Start with `machine_inspect { operation: "status" }` when device identity, enabled state, roots, executable policy, or process limits are not already fresh. Before editing a checkout, prefer `repo.status` to bind repository root, HEAD, branch, upstream relation, and dirty-state counts to the same machine you are about to mutate. Use `repo.commands` when repository-declared Node scripts should drive startup or focused validation: it derives only script names plus safe argument-vector invocations from repository metadata, current changed paths, package-manager authority, the Machine Bridge executable allowlist, and read-only PATH presence. Authorization alone is not treated as executable availability; it never returns or persists the script bodies.

## Security boundary

Machine Actions are opt-in per Remote Host and are restricted by application policy:

- filesystem operations must stay inside configured `allowedLocalRoots`;
- writes re-check the nearest existing parent so symlinked parents cannot silently escape the workspace;
- process execution accepts an allowlisted executable **name**, never an arbitrary executable path;
- `repo.status`, `repo.commands`, and `repo.diff` invoke only fixed read-only Git/filesystem inspection inside an allowed workspace; `repo.commands` may check whether an allowlisted executable name exists on PATH but never executes a discovered script;
- child environments expose only a bounded host environment set;
- output, searches, sessions, and timeouts are bounded;
- destructive file delete is intentionally absent.

This is **not an OS sandbox**. An allowlisted interpreter, package manager, build tool, or shell can itself access resources beyond the workspace if the operating system permits it. Treat enabling broad interpreters/shells as a high-trust operator decision and prefer isolated/container workers for untrusted code.

## Engineering execution loop

Use:

`repo.status + repo.commands -> narrow read/digest -> guarded edit (repo HEAD + file preconditions) -> process.start(minimal validation, same repo HEAD) -> action receipt/result -> repo.diff/read postcondition -> refreshed repo.status`

Examples:

- edit an existing file: `repo.status` -> `fs.digest` or `fs.read` -> prefer `fs.replace expectedRepoHead=<observed HEAD> expectedSha256=<observed digest> expectedOccurrences=<exact count>` for a narrow textual change, falling back to guarded `fs.write` only when whole-file replacement is intentional -> compare `receipt.resultIdentity` / `afterSha256` -> `repo.diff` -> `fs.digest` -> `repo.status`;
- create a new file: inspect parent -> `fs.write requireAbsent=true` -> verify returned `afterSha256` -> inspect/read;
- move an existing file: digest source -> `fs.move expectedSha256=<source digest> requireAbsent=true` -> inspect destination -> refresh repository status;
- run a repository-declared focused validation: `repo.commands` -> choose the bounded `validation.minimal` invocation only when policy and PATH presence both mark it runnable -> pass its executable/argv to `machine_act process.start persistent=false` with `expectedRepoHead=<repo.commands repository.head>` -> retain the returned `actionId`, exit state, and `outputSha256` -> `repo.diff` -> refreshed `repo.status`. Do not reinterpret or copy the package-script body into the tool call;
- run another bounded command when repository metadata has no suitable plan: inspect/status -> `machine_act process.start persistent=false` with an independently justified allowlisted executable -> retain the returned `actionId`, exit state, and `outputSha256` -> inspect resulting files/runtime;
- run a dev server or REPL: `process.start persistent=true` -> keep the returned session `actionId` -> `process.output` -> `process.input` as needed -> `process.stop` -> `process.status`;
- search before editing: `fs.search`, then narrow reads rather than scanning the whole machine;
- inspect machine-local source delta: `repo.diff` for working-tree changes or `staged=true` for the index. Treat the bounded patch as review evidence, not remote-repository synchronization.

The action receipt binds the Machine Bridge action to its `requestId`, action/result identity, device projection, and any enforced repository HEAD precondition. It proves that this Machine Bridge execution produced that returned action/result identity. It does **not** prove which human or ChatGPT conversation initiated the call after context is lost. Persisted or copied receipts remain historical evidence until revalidated against live machine/repository state.

If a mutation is replayed with the same `requestId` and identical payload, the runtime idempotency layer returns the stored result instead of performing the action again; therefore the same `actionId` is a useful duplicate-execution discriminator. A different request id is a different mutation attempt even if the payload is identical.

On Windows, keep `process.start` shell-free. npm/pnpm/yarn commonly resolve through `.cmd` shims, which this Machine Bridge intentionally does not invoke by enabling a shell. `repo.commands` therefore marks those package-manager invocations unavailable instead of weakening the executable boundary. Use another already-safe runnable command or a future explicitly trusted adapter rather than setting `shell=true` as a workaround.

Reuse one persistent process session when interaction benefits from preserved state. Do not start duplicate shells merely because the chat turn changed.

## Cross-host handoff

Before moving mutation authority between GitHub/web and the Machine Bridge, compare:

`repository identity -> remote/origin -> branch/ref -> exact HEAD -> dirty state -> outstanding local-only effects`

A machine-local action receipt is not repository synchronization. Integrate the intended local change through the chosen repository authority, then re-read the authoritative remote before publication or release.

## Web-first routing

On ChatGPT Web, prefer current connected GitHub/Figma/browser tools for their native authoritative surfaces. Use the Machine Bridge when the task specifically needs the user's authorized computer: local checkout state, terminal execution, local-only files, local services, desktop runtime, or machine-specific evidence.

If Machine Actions are absent or disabled, degrade explicitly to available web/CI/connectors rather than claiming local execution.
