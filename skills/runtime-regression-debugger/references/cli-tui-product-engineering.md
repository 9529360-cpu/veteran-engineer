# CLI and TUI product engineering

Use this for command-line tools, developer CLIs, administrative/operator commands, terminal applications, and TUIs across JavaScript/TypeScript, Python, Go, Rust, and comparable runtimes. Treat a CLI as a public protocol between humans/scripts and a process, and a TUI as a lifecycle-sensitive interactive application—not as a thin wrapper around internal functions.

## Contents

- Compile the command contract
- Recover command/config authority
- Arguments, subcommands, and compatibility
- Configuration and precedence
- stdout, stderr, structured output, and exit status
- stdin, TTY, pipes, and non-interactive mode
- Signals, cancellation, retries, and partial effects
- Filesystem, cwd, platform, and environment
- Secrets, auth, and sensitive output
- TUI lifecycle and terminal restoration
- Progress, concurrency, and long-running operations
- Extensibility, plugins, and completions
- Packaging, installation, and updates
- Validation shape
- Whole-slice completion

## Compile the command contract

Start from the externally observable transition:

`argv/stdin/environment -> parse -> resolve config/context -> authorize/validate -> effect -> stdout/stderr + exit status + durable/external result`

Capture only constraints that can change implementation:

- command/subcommand names and public option syntax;
- interactive versus script/CI use;
- text versus machine-readable output;
- exit-code compatibility relied on by scripts;
- stdin/stdout/stderr behavior and whether output may be piped;
- working-directory and filesystem assumptions;
- configuration/env/profile authority;
- authentication/credential source and account/tenant scope;
- cancellation and timeout behavior;
- retry/idempotency for effectful commands;
- supported operating systems, shells, terminals, runtimes, and packaging channels;
- old/new CLI and server/API coexistence.

Do not treat implementation function signatures as the public CLI contract. The stable interface is what callers can observe from process invocation, output, exit status, files, and external effects.

## Recover command/config authority

Before editing, find the real command registration and configuration owners.

Trace:

`binary/entrypoint -> parser/command registry -> middleware/hooks -> config/profile resolver -> service/domain owner -> formatter -> process exit`

Inspect package/project entrypoints, generated command manifests, shell wrappers, plugin registries, config schemas, completion generators, and installer/package metadata where relevant.

Framework-generated command metadata or completions may be projections. Patch the command/config source of truth rather than generated artifacts unless repository conventions say otherwise.

Keep parsing, validation, business authority, output formatting, and process termination separable. A parser callback should not become an accidental owner of durable business state merely because it is close to `argv`.

## Arguments, subcommands, and compatibility

Arguments are a versioned API.

- Distinguish positional arguments, flags/options, repeated options, mutually exclusive choices, required values, and passthrough arguments deliberately.
- Fail closed when an option requiring a value receives EOF or another flag unless the parser contract explicitly permits it.
- Preserve `--` passthrough semantics where commands wrap other processes.
- Avoid silent fallback when malformed input could select a different environment/account/project.
- Keep defaults observable in help or machine-readable metadata when they materially change behavior.
- Do not reuse an old flag name for unrelated semantics.
- Deprecate before removing commonly scripted flags/subcommands; preserve explicit compatibility windows.
- Prefer additive output/option evolution when older automation can remain active.

For destructive or high-impact commands, make target/environment identity explicit enough to resist cwd/profile mistakes. A confirmation prompt is not a substitute for authorization or correct target resolution.

## Configuration and precedence

Define one precedence chain, for example:

`explicit flag -> command-scoped env -> selected profile/config file -> repository/user config -> default`

The exact order may differ, but it must be deterministic and testable.

- Track provenance for material resolved values so diagnostics can explain where a setting came from without leaking secrets.
- Distinguish “unset” from explicit false/zero/empty values when those are valid settings.
- Validate config shape before fallback; malformed explicit configuration should not silently select another environment.
- Resolve relative paths against a documented owner, not whichever cwd happens to be active deep in the stack.
- Keep machine/user config migrations compatible and restart-safe when the CLI writes durable config.

## stdout, stderr, structured output, and exit status

Treat process channels as protocol surfaces.

- stdout: requested result/data intended for the caller or pipeline;
- stderr: diagnostics, warnings, progress/logging that must not corrupt piped stdout;
- exit status: coarse machine-readable success/failure classification.

For `--json` or equivalent machine modes:

- emit one documented schema or stream framing model;
- never mix progress spinners, ANSI escapes, banners, or human prose into structured stdout;
- keep diagnostics on stderr unless the machine contract explicitly embeds them;
- use stable identifiers/error codes for automation rather than requiring callers to parse English text;
- define behavior for partial success and multi-item operations.

Avoid calling `process.exit()` from deep library layers. Return/throw typed outcomes to the process boundary so cleanup, buffered output, tracing, and tests can complete predictably.

## stdin, TTY, pipes, and non-interactive mode

A command can run under a human terminal, CI, cron, an IDE, a pipe, or another process.

- Detect interactivity from the real stdin/stdout TTY boundary rather than assuming a terminal exists.
- Never block indefinitely on a prompt when stdin is non-interactive.
- Provide explicit non-interactive behavior for commands used in automation.
- Define precedence when the same data may come from stdin and arguments/files.
- Handle closed/broken pipes without dumping irrelevant stack traces when a downstream consumer exits normally.
- Respect terminal width/color capability; support `NO_COLOR` or repository convention where appropriate.
- Avoid ANSI/progress output when stdout is redirected unless explicitly requested.

If secrets can arrive through stdin, avoid echoing or persisting them accidentally.

## Signals, cancellation, retries, and partial effects

SIGINT/Ctrl-C and termination are state transitions, not generic exceptions.

- Establish one owner for signal handling; avoid accumulating handlers across repeated command execution in tests/embedded usage.
- Propagate cancellation to child processes/network work when safe.
- Give cleanup a bounded opportunity to restore terminal/files/locks without hanging shutdown indefinitely.
- Use exit status that distinguishes cancellation when the product contract needs it.
- Treat “signal after remote commit but before local acknowledgement” as an unknown-outcome case for effectful operations.
- Do not blindly retry non-idempotent commands after timeout, disconnect, or interrupted acknowledgement.
- Preserve stable request/effect identity when a CLI command may safely resume or retry.

For multi-step commands, define whether failure leaves no effect, partial effect, resumable state, or an explicit recovery command.

## Filesystem, cwd, platform, and environment

CLI correctness frequently depends on launch context.

- Resolve repository/workspace roots deliberately instead of assuming cwd is the project root.
- Normalize and contain user-supplied paths before privileged/destructive filesystem operations.
- Preserve symlink semantics intentionally; lexical containment alone is not proof of realpath containment.
- Treat PATH executable discovery as runnability, not just file existence.
- Keep Windows/POSIX path, quoting, executable suffix, signal, and shell differences explicit.
- Prefer direct argv process spawning over shell interpolation when a shell is not part of the contract.
- Bound inherited environment; do not pass every secret/environment variable to child tools by convenience.

## Secrets, auth, and sensitive output

Credentials can arrive from env vars, config files, OS stores, stdin, browser/device login, or an external credential helper.

- Keep credential lookup and account/profile selection under one explicit authority.
- Never include secrets in argv when a safer channel exists: process listings, shell history, CI logs, and crash reports may expose them.
- Redact authorization headers, tokens, passwords, private keys, signed URLs, and sensitive config values from diagnostics and traces.
- Do not print full environment/config snapshots as support output.
- Bind destructive/monetary/administrative commands to the exact authenticated principal, tenant/account, resource, and action at a trusted boundary.

## TUI lifecycle and terminal restoration

A TUI owns terminal state and must restore it under success, failure, resize, cancellation, and unexpected exceptions.

- Pair alternate-screen, raw-mode, cursor visibility, mouse capture, paste mode, and other terminal mutations with deterministic cleanup.
- Keep rendering state separate from authoritative domain/process state.
- Handle resize events without corrupting layout or losing current operation identity.
- Guard async results against stale screen/view generations.
- Define suspend/resume behavior where supported.
- Provide a usable fallback or clear error when required terminal capabilities are unavailable.
- Do not assume Unicode width, color depth, key sequences, or terminal emulator behavior is identical across environments.

TUI keybindings are product interaction contracts. Avoid trapping standard cancellation/navigation conventions unless the product deliberately documents the difference.

## Progress, concurrency, and long-running operations

Progress display must not become the owner of work.

- Derive progress from durable/current operation state where practical.
- Separate status/progress stderr from result stdout.
- Bound worker concurrency and queues by the downstream bottleneck.
- Keep per-item identity when rendering parallel operations so output cannot attribute one result to another task.
- Make logs/progress deterministic enough that CI/non-TTY mode can switch to stable line-oriented output.
- If reconnect/resume is supported, persist the operation identity outside the TUI process lifetime.

## Extensibility, plugins, and completions

Commands that load plugins or external executables create a supply-chain and compatibility boundary.

- Version the plugin/extension contract.
- Distinguish trusted in-process plugins from isolated external commands.
- Prevent one malformed plugin from taking down unrelated built-ins unless identity/conflict rules require fail-closed behavior.
- Do not allow external plugins to shadow privileged built-ins accidentally.
- Generate shell completions from the same command authority when possible; avoid a second hand-maintained option tree.
- Keep completion scripts side-effect-free and fast.

## Packaging, installation, and updates

Validate the artifact users actually invoke.

- Verify executable entrypoints/shebangs/shims and file permissions.
- Confirm packaged resources/config/templates are present from installed locations, not only a source checkout.
- Test runtime discovery through expected PATH/package-manager locations.
- Keep CLI/server compatibility across staggered upgrades.
- Treat self-update/package-manager update as a release mechanism with version identity, rollback/forward repair, and signature/provenance concerns where material.
- Validate shell completion/manpage generation as part of packaging when shipped.

A source-level test does not prove the installed binary resolves the same runtime, resources, config paths, or credentials.

## Validation shape

Choose evidence from the changed boundary:

- parser/config rules -> table-driven unit tests plus real process invocation for ambiguous argv cases;
- stdout/stderr/exit status -> process-level tests that capture channels independently;
- JSON/machine mode -> schema/golden tests with ANSI/progress absence assertions;
- stdin/non-interactive behavior -> pipe/closed-stdin/CI-style process tests;
- signals/cleanup -> subprocess tests sending real signals when the environment supports them;
- child-process wrappers -> argv/env/cwd/timeout/cancellation integration tests;
- filesystem/root discovery -> temporary repositories/directories, symlink and cross-platform path cases;
- TUI behavior -> state/model tests plus pseudo-terminal or representative terminal integration where practical;
- packaging -> installed/package artifact invocation rather than source-entrypoint-only tests.

When a platform/terminal cannot be executed in the current environment, state that validation boundary and preserve platform-specific negative-space review.

## Whole-slice completion

A CLI change is not complete because one command prints the expected happy-path text. Close the implied responsibilities: help/completion, malformed argv, config precedence, auth/target identity, machine output, stderr/exit status, non-TTY use, cancellation/partial effects, filesystem/cwd, child-process cleanup, secrets/redaction, compatibility, packaging, and tests.

A TUI change additionally closes terminal restoration, resize/input lifecycle, stale async work, non-supported-terminal behavior, and process cancellation.

Prefer the repository's existing parser, config authority, output conventions, and packaging channel. Do not migrate CLI/TUI frameworks merely for style or convenience.
