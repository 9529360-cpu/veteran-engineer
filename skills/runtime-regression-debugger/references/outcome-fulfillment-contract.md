# Outcome Fulfillment Contract

Use this reference when the user describes an outcome in natural language and expects the engineer to turn that description into a completed product change. It is especially important for broad requests such as "make this better", "redesign the desktop app", "make it like X", "finish this feature", or requests that combine several visible/product requirements.

## Preserve the user's clauses

Compile the request into a short set of independently testable requirement clauses before editing. Preserve every material noun, qualifier, comparison target, non-goal, and requested behavior that changes what success looks like.

Do not silently compress distinct requirements into a vague umbrella goal. Related work is not substitute work.

Examples:

- `Codex-style workspace layout` and `OS-style liquid-glass theme` are two requirements. A color/token change cannot satisfy the layout requirement.
- `Add search and keep keyboard navigation` is two requirements. A working search box cannot satisfy the keyboard-navigation requirement.
- `Fix login refresh loops without breaking existing sessions` includes both the bug fix and the compatibility obligation.
- `Make the workflow faster` is not satisfied by a refactor unless the relevant workload is measured and improved.

For each material clause, capture:

`requirement id -> statement -> product dimension -> observable acceptance -> strongest practical validation boundary`

Useful product dimensions include `functional`, `layout`, `visual_style`, `interaction`, `workflow`, `integration`, `architecture`, `data`, `performance`, `reliability`, `security`, `accessibility`, `responsive`, `copy`, and `delivery`.

## Recover implementation details instead of bouncing them back

The user owns product intent. The repository should answer ordinary reversible implementation questions.

Do not ask the user to choose filenames, component boundaries, state libraries, test files, CSS architecture, IPC wiring, or similar repository-answerable details. Inspect the active path, recover precedent, and choose the smallest complete implementation that satisfies the outcome contract.

Ask only when a real product decision cannot be recovered safely from the request, repository, or current runtime evidence.

## Reject cheap substitutes

Before declaring success, compare the delivered change against each requirement clause. Treat these substitutions as failures unless the user explicitly changed the request:

| Requested outcome | Not an acceptable substitute |
| --- | --- |
| layout/workspace redesign | colors, spacing, typography, or theme tokens only |
| functional capability | placeholder UI, mock data, disabled controls, or documentation only |
| integration | local component behavior with no real backend/IPC/API wiring |
| workflow change | isolated helper/refactor that leaves the user journey unchanged |
| architecture ownership change | wrapper/adapter added while the old authority remains live |
| performance improvement | code cleanup without comparable measurement |
| reliability fix | swallowing errors, retries without bounds, or masking the failing state |
| accessibility requirement | visual similarity without keyboard/semantic/focus verification |
| desktop/native behavior | browser-only proof when the desktop runtime is available |

A patch that is relevant but incomplete is still incomplete.

## Inspect enough of the real product before editing

For non-trivial product/UI work, recover the active execution path before mutation:

`entry -> shell/layout -> state/IPC/API -> authoritative owner -> visible effect -> validation path`

Do not pick the first easy stylesheet or component and stop. Verify that edited files are on the live path. For desktop apps, identify the actual renderer/shell, window chrome, navigation, state boundary, tool/terminal panes, IPC/native bridges, and packaging/runtime path when they are material to the request.

## Implement by requirement, validate by requirement

Keep a coverage map while working. Every required clause must end in one of these states:

- `done`: implemented and backed by concrete evidence plus validation;
- `deferred`: only when the user explicitly accepts deferral or a real external blocker prevents completion;
- `not_applicable`: only when repository/runtime evidence proves the clause does not apply.

A required clause must not disappear because another clause was completed.

For multi-clause or high-risk work, use `scripts/outcome_contract_gate.py` to fail closed on missing requirement coverage. The gate is a claim/completeness aid, not a substitute for real repository and runtime evidence.

## Run the product when the request is visible

When a browser, desktop runtime, simulator, preview, or comparable visual boundary is available, use it for layout, visual-style, interaction, responsive, accessibility-presentation, and workflow changes.

A successful compile does not prove that the requested interface exists. A screenshot does not prove real state or integration. Combine visible proof with the strongest relevant functional/runtime evidence.

If the real visual/runtime boundary is unavailable, keep implementing to the strongest practical lower boundary and explicitly lower the completion claim. Do not call the design "finished" while rendered behavior is unobserved.

## Reopen the task after a weak first pass

After the first implementation:

1. Run the changed surface or strongest practical boundary.
2. Compare actual behavior against every requirement clause.
3. Mark clauses with weak/missing evidence as still open.
4. Continue implementation instead of reporting partial relevance as completion.
5. Repeat until all required clauses are done or a real blocker remains.

Do not treat the first plausible patch as the default stopping point.

## Review failure is a continuation state

A failed deterministic, semantic, visual, integration, or outcome-contract review means the implementation loop is still open. Do not turn a review failure into a final report while ordinary authorized engineering actions remain available.

Use the finding as new product evidence:

`failed requirement -> inspect owning path -> derive bounded repair task -> apply repair to current source authority -> execute -> rerun focused proof -> rerun whole-change review -> re-check every original clause`

When the Veteran runtime exposes `remediation_plan`, treat proposal creation and remediation application as different states:

- `apply=false` is diagnosis/proposal only. It does not modify source, reopen execution, or satisfy the user.
- When current repository/review evidence is sufficient to derive explicit `contract`, `owner`, `writeSet`, risk, and validation authority, call `remediation_plan` with `apply=true` and those bounded task specs. Do this without asking the user to approve ordinary reversible implementation details that the repository already answers.
- After an applied remediation returns the Mission to `execution`, continue through `mission_execute` / `mission_advance`, validation, deterministic review, semantic review, and outcome coverage again. Do not stop merely because remediation was accepted.
- Do not apply guessed owner/writeSet or invented findings. If source ownership cannot be recovered safely, inspect more evidence first. Stop only for a genuine product/authorization/environment blocker.

A failed review plus an available safe remediation path is therefore not a handoff condition. It is another implementation iteration.

If the host also provides authorized repository mutation/execution tools outside the Veteran runtime, use them only when they preserve the same current source authority and proof chain. Do not fork the repair into an unrelated checkout or a new Mission that loses the in-progress integrated state.

For acceptance failures, preserve the original requested clause in the repair packet. A generic instruction such as `resolve review finding` is weaker than `implement the missing Codex-style workspace layout and prove it in the running desktop app`.

## Hermes desktop example

Request:

`Make Hermes Desktop use a Codex-like workspace layout and an OS-style liquid-glass theme.`

Minimum outcome contract:

1. `layout`: the running desktop shell visibly adopts the requested workspace structure; validate in the real desktop runtime.
2. `glass`: the running shell surfaces consistently use the requested liquid-glass material system, including relevant hover/active/focus/dialog states; validate in the real desktop runtime.

If only theme colors, opacity, blur, or tokens changed, requirement 1 is still open and the task is not complete. If semantic review reports the layout clause missing and repository evidence identifies the shell owner/write scope, apply a source-bound remediation task for that layout gap and continue execution; do not return the finding to the user as if the requested redesign were finished.

## Completion language

Report the strongest level actually proven:

`implemented -> focused-validated -> integration-validated -> runtime-validated -> production-verified`

Do not upgrade the claim because the change looks plausible. Missing clauses, unobserved visible behavior, failed review without exhausted remediation, or fake/inactive wiring keep the task open.