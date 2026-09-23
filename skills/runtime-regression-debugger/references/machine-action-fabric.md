# Veteran Machine Action Fabric

Use this reference only when the current host actually exposes `machine_inspect` and `machine_act`.

## Contract

The public surface is deliberately small:

- `machine_inspect` is read-only. Use it for device/policy status, bounded filesystem list/stat/read/search, and managed process list/status/output.
- `machine_act` is mutating and request-id protected. Use it for bounded file write/append/mkdir/move and allowlisted process start/input/stop.

Treat the selected Remote Host as the machine authority. Start with `machine_inspect { operation: "status" }` when device identity, enabled state, roots, executable policy, or process limits are not already fresh.

## Security boundary

Machine Actions are opt-in per Remote Host and are restricted by application policy:

- filesystem operations must stay inside configured `allowedLocalRoots`;
- writes re-check the nearest existing parent so symlinked parents cannot silently escape the workspace;
- process execution accepts an allowlisted executable **name**, never an arbitrary executable path;
- child environments expose only a bounded host environment set;
- output, searches, sessions, and timeouts are bounded;
- destructive file delete is intentionally absent from v1.

This is **not an OS sandbox**. An allowlisted interpreter, package manager, build tool, or shell can itself access resources beyond the workspace if the operating system permits it. Treat enabling broad interpreters/shells as a high-trust operator decision and prefer isolated/container workers for untrusted code.

## Execution pattern

Use:

`inspect -> act -> inspect postcondition`

Examples:

- edit a file: inspect/read -> machine_act fs.write -> inspect/read or repository diff;
- run a bounded command: inspect/status -> machine_act process.start persistent=false -> inspect resulting files/runtime;
- run a dev server or REPL: machine_act process.start persistent=true -> machine_inspect process.output -> machine_act process.input as needed -> machine_act process.stop -> machine_inspect process.status;
- search before editing: machine_inspect fs.search, then narrow read ranges rather than scanning the whole machine.

Reuse one persistent process session when interaction benefits from preserved state. Do not start duplicate shells merely because the chat turn changed.

## Web-first routing

On ChatGPT Web, prefer current connected GitHub/Figma/browser tools for their native authoritative surfaces. Use the Machine Bridge when the task specifically needs the user's authorized computer: local checkout state, terminal execution, local-only files, local services, desktop runtime, or machine-specific evidence.

If Machine Actions are absent or disabled, degrade explicitly to available web/CI/connectors rather than claiming local execution.
