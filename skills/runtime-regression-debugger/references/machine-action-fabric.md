# Veteran Machine Action Fabric

Use this reference only when the current host actually exposes `machine_inspect` and `machine_act`.

## Contract

The public surface stays deliberately small:

- `machine_inspect` is read-only. Use it for device/policy status, bounded filesystem list/stat/read/digest/search, repository status, and managed process list/status/output.
- `machine_act` is mutating and request-id protected. Use it for bounded file write/append/mkdir/move and allowlisted process start/input/stop.
- every successful `machine_act` returns a `veteran-machine-action-receipt-v1` action identity. File mutations also return before/after SHA-256 fingerprints when regular-file content participates.
- `expectedSha256` is an optimistic file-content precondition for `fs.write`, `fs.append`, and the `fs.move` source. `requireAbsent` rejects an already-present target/destination.

Treat the selected Remote Host as the machine authority. Start with `machine_inspect { operation: "status" }` when device identity, enabled state, roots, executable policy, or process limits are not already fresh. Before editing a checkout, prefer `repo.status` to bind repository root, HEAD, branch, upstream relation, and dirty-state counts to the same machine you are about to mutate.

## Security boundary

Machine Actions are opt-in per Remote Host and are restricted by application policy:

- filesystem operations must stay inside configured `allowedLocalRoots`;
- writes re-check the nearest existing parent so symlinked parents cannot silently escape the workspace;
- process execution accepts an allowlisted executable **name**, never an arbitrary executable path;
- `repo.status` invokes only fixed read-only Git commands inside an allowed workspace;
- child environments expose only a bounded host environment set;
- output, searches, sessions, and timeouts are bounded;
- destructive file delete is intentionally absent.

This is **not an OS sandbox**. An allowlisted interpreter, package manager, build tool, or shell can itself access resources beyond the workspace if the operating system permits it. Treat enabling broad interpreters/shells as a high-trust operator decision and prefer isolated/container workers for untrusted code.

## Engineering execution loop

Use:

`repo truth -> narrow read/digest -> guarded act -> receipt -> read/runtime postcondition -> refreshed repo truth`

Examples:

- edit an existing file: `repo.status` -> `fs.digest` or `fs.read` -> `fs.write expectedSha256=<observed digest>` -> compare `receipt.resultIdentity` / `afterSha256` -> `fs.digest` -> `repo.status`;
- create a new file: inspect parent -> `fs.write requireAbsent=true` -> verify returned `afterSha256` -> inspect/read;
- move an existing file: digest source -> `fs.move expectedSha256=<source digest> requireAbsent=true` -> inspect destination -> refresh repository status;
- run a bounded command: inspect/status -> `machine_act process.start persistent=false` -> retain the returned `actionId`, exit state, and `outputSha256` -> inspect resulting files/runtime;
- run a dev server or REPL: `process.start persistent=true` -> keep the returned session `actionId` -> `process.output` -> `process.input` as needed -> `process.stop` -> `process.status`;
- search before editing: `fs.search`, then narrow reads rather than scanning the whole machine.

The action receipt proves that this Machine Bridge execution produced that returned action/result identity. It does **not** prove which human or ChatGPT conversation initiated the call after context is lost. Persisted or copied receipts remain historical evidence until revalidated against live machine/repository state.

If a mutation is replayed with the same `requestId` and identical payload, the runtime idempotency layer returns the stored result instead of performing the action again; therefore the same `actionId` is a useful duplicate-execution discriminator. A different request id is a different mutation attempt even if the payload is identical.

Reuse one persistent process session when interaction benefits from preserved state. Do not start duplicate shells merely because the chat turn changed.

## Cross-host handoff

Before moving mutation authority between GitHub/web and the Machine Bridge, compare:

`repository identity -> remote/origin -> branch/ref -> exact HEAD -> dirty state -> outstanding local-only effects`

A machine-local action receipt is not repository synchronization. Integrate the intended local change through the chosen repository authority, then re-read the authoritative remote before publication or release.

## Web-first routing

On ChatGPT Web, prefer current connected GitHub/Figma/browser tools for their native authoritative surfaces. Use the Machine Bridge when the task specifically needs the user's authorized computer: local checkout state, terminal execution, local-only files, local services, desktop runtime, or machine-specific evidence.

If Machine Actions are absent or disabled, degrade explicitly to available web/CI/connectors rather than claiming local execution.
