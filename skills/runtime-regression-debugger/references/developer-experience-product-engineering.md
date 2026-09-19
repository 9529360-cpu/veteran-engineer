# Developer Experience Product Engineering

Use this when the product is itself consumed by developers across APIs, CLIs, SDKs, libraries, local tooling, integration setup, examples, or technical documentation. Own the **developer journey and cross-surface coherence**, not the implementation internals of every individual surface.

## Contents

- Developer-journey contract
- Recover the real entry path
- Time to first useful success
- Cross-surface language and configuration
- Error and recovery experience
- Examples, docs, and runnable truth
- Automation and non-interactive use
- Live DX verification
- Handoffs to specialist owners
- Completion boundary

## Developer-journey contract

Model DX as a real product flow:

`discover -> choose/install -> configure/authenticate -> first useful success -> integrate into real project -> diagnose failure -> recover -> upgrade/maintain`

Identify the target developer persona and the shortest realistic job they are trying to complete. Do not optimize a demo path that is unrelated to normal production use.

For a focused change, inspect only the journey stages it can affect. Do not turn every SDK bug into a complete onboarding redesign.

## Recover the real entry path

Before proposing DX changes, inspect the surfaces developers actually encounter:

- install/package/container/bootstrap commands;
- authentication and provider/config setup;
- getting-started example or first API call;
- CLI help and error output;
- SDK/public API names and defaults;
- generated snippets and sample apps;
- versioned docs, changelog, migration guide, and deprecation path where relevant;
- CI/headless/non-interactive path when the product supports automation.

Repository docs are evidence, not automatic truth. Verify commands and examples against the current package/runtime when practical.

## Time to first useful success

Prefer **time to first useful success** over vanity measures such as page count or setup-step count. Measure the path with a clean enough environment to expose hidden prerequisites, stale docs, implicit credentials, missing tools, or local state that an existing maintainer machine masks.

A useful first success should prove the product's core value, not merely print `hello world` if real users immediately need five more undocumented steps.

Treat time as comparative evidence, not a universal score. A slower but necessary security or environment step can be correct; unexplained waiting, dead ends, redundant setup, or repeated context switching is friction.

## Cross-surface language and configuration

The same concept should not silently acquire incompatible names or precedence across docs, CLI, SDK, API, dashboard, and config.

Check, when material:

- resource and action names;
- auth/provider terminology;
- environment variables, config keys, flags, and defaults;
- version/support language;
- error identifiers and troubleshooting references;
- examples and generated snippets;
- sync/async or local/remote semantics.

Do not force identical syntax where each surface has legitimate conventions. Preserve one product concept and explain intentional surface-specific representations.

## Error and recovery experience

A developer-facing failure should make the next safe action discoverable.

For material errors, verify that the developer can determine:

- what failed and which subject/config/version it applied to;
- whether anything partially succeeded;
- whether retry is safe;
- the smallest next action or diagnostic that can discriminate the cause;
- where deeper evidence lives without requiring guesswork.

Human-readable guidance and machine-readable identity can coexist. Do not replace stable exit codes/status/error identifiers with prose-only messages, and do not expose only an opaque code with no actionable path.

## Examples, docs, and runnable truth

Treat developer documentation and examples as contract projections when users are expected to copy or execute them.

- Prefer runnable examples over pseudo-code for setup-critical paths.
- Bind examples to the supported package/API shape and version when drift is plausible.
- Avoid examples that depend on maintainer-local files, implicit accounts, hidden environment state, or unreleased behavior.
- When an example is intentionally illustrative rather than executable, label that boundary.

Route deep documentation authoring to the applicable docs owner/Skill when available. DX owns whether the journey can be followed; it does not need to own every paragraph's prose style.

## Automation and non-interactive use

A developer product often has both interactive and automated consumers. When relevant, exercise:

- fresh local shell and existing configured shell;
- CI/headless/non-TTY mode;
- missing/expired credentials;
- proxy/network or dependency failure;
- idempotent rerun after partial setup;
- uninstall/cleanup or environment reset when setup mutates durable state.

Do not require prompts, browser login, colorized TTY output, or local GUI state for a path advertised as automation-safe.

## Live DX verification

For material DX work, walk the developer journey using the shipped or release-candidate artifacts rather than reviewing the plan alone.

Record enough evidence to compare intended versus actual:

`starting environment -> exact commands/actions -> elapsed/friction points -> observed output/errors -> recovery -> first useful result`

Source code can explain a failure after it is observed. It cannot prove that the onboarding or integration experience is usable.

Use representative clean-state testing where setup/state leakage can hide friction. Do not destroy a user's real environment merely to manufacture cleanliness; isolate with a temporary project/container/profile when practical.

## Handoffs to specialist owners

DX is a cross-surface product owner, not a substitute for specialist correctness:

- SDK/library compatibility -> `sdk-library-product-engineering.md`;
- CLI/TUI semantics -> `cli-tui-product-engineering.md`;
- API contracts -> `api-backend-patterns.md`;
- auth/security -> `security-multitenancy-patterns.md`;
- localization -> `globalization-product-engineering.md`;
- user/product onboarding mechanics -> `user-onboarding-activation-product-engineering.md` when the journey is not developer-specific.

Return to DX after specialist fixes and rerun the affected journey boundary.

## Completion boundary

Do not call DX complete because each component is individually correct. Close the requested journey only when the affected developer can reach the intended useful result, diagnose/recover from the material failure path, and encounter coherent concepts/configuration across the surfaces that participate in that flow.
