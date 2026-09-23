# Veteran Remote Host - Merged Baseline / Continuation Checkpoint

## Product target

The user's dedicated computer should become the execution environment for engineering requests made in ChatGPT Web. Veteran must inspect and edit real projects, run builds/tests, launch browser/Electron surfaces, return inspectable evidence, and continue repairing observable mismatches. Do not reduce this to a code-generation assistant or a file-editing demo.

The desired final acceptance remains:

`clean machine -> verified install -> authorized pairing -> open/clone repo -> Mission execution -> edits -> tests/build -> real rendered app -> screenshot inspection -> intentional mismatch -> repair -> disconnect/revoke -> prior access rejected`

That entire sequence has **not** been proven on the user's spare machine.

## Source and PR topology

Repository: `9529360-cpu/veteran-engineer`.

Last behavior-bearing repository checkpoint relevant to this handoff is `82f2cfd980914362e1a699db8965a4fc801e3744` (#472). The former Remote Host stack is merged; #468 refreshed authority docs, #469 replayed the V16 Skill brain without changing Remote Host runtime ownership, #470/#471 were documentation-only, and #472 made the Windows service launcher Unicode-safe. Refresh live `main` from GitHub before consequential work rather than treating this checkpoint as a branch-head promise. There is no active non-Draft Remote Host PR from that line.

The merged implementation line was:

- #457: `feat/remote-host-control-plane-v1-final` - device/config/digest token, authenticated loopback HTTP MCP, workspace-gated project opening.
- #458: `feat/remote-host-supervised-service-v1` - Windows current-user Task Scheduler/supervisor lifecycle.
- #459: `feat/remote-host-clean-machine-bootstrap` - verified release bootstrap orchestration using the existing canonical installer.
- #460: `feat/remote-host-secure-tunnel-stdio` - local stdio entrypoint and shared remote MCP surface factory. This is not an installed/provisioned OpenAI tunnel.
- #461: Windows native Chromium execution and screenshot evidence, live token invalidation, and real supervisor restart repair.
- #464: bounded verified screenshot image delivery through existing `evidence_query`, exact-id scoped.
- #465: shared-state workspace authorization with fail-closed handling for future unclassified tools.
- #472: Unicode-safe Veteran-owned PowerShell service launcher for non-ASCII Windows paths, preserving the same supervisor/Task Scheduler ownership model.

The implementation stack is merged. Refresh live `main`, open PR/issue state, workflow outcomes, and release state before new mutation. Do not create a public release merely because the merged line is green.

## Windows startup failure and actual owner fix

Initial #461 head `12f8ea95b177300a09530ec6f099d19a155318de` removed the Windows platform block and made worktree containment compare canonical paths. Its real Windows browser integration still failed after the fixture service was ready.

`f4910c2dc0779aa7025e049ef4941cb3b64cda79` added native startup failure classification and missing child/pipe error listeners. Before that, provider failure discarded the useful cause. Missing-executable and early-exit regressions now return a bounded failed validation result instead of an unstructured stack. Keeping all standard pipe handles did **not**, by itself, fix Windows.

A temporary fixture-only probe at `938b83990fa27feb99d790ad824bd28a5d783f11` tested the same Chrome process and the same process-owned CDP pipe under two environments. Windows workflow `35167780421`, job `105032630908`, showed:

- Existing isolated environment: zero CDP bytes, handshake timeout, Chrome refused remote debugging because it could not establish a non-default data directory.
- Complete isolated Windows profile environment: successful `Browser.getVersion`, Chrome `152.0.7977.83`, no startup stderr.

`3ce5fb25b7db11b58a06fa75b87ab5ae5be700de` fixes the shared environment owner:

- `APPDATA` -> private home / AppData / Roaming;
- `LOCALAPPDATA` -> private home / AppData / Local;
- `HOMEDRIVE` and `HOMEPATH` -> the same private home;
- create the isolated application-data directories before starting providers;
- preserve protected-variable rejection and allowlist-only forwarding;
- preserve process-owned CDP pipe, browser sandbox, and origin/network restrictions.

The temporary probe was removed. Do not resurrect it as a permanent parallel launcher.

## Proof and its scope

The code checkpoint `3ce5fb2` passed real Windows browser validation in workflow `35168128781`, Windows job `105033717096`. Installer/CLI/bootstrap contract tests, browser environment/startup contracts, and the existing Windows Task Scheduler registration/removal smoke passed in that workflow too.

That Windows run produced artifact `10475442121`, named `windows-browser-evidence-3ce5fb25b7db11b58a06fa75b87ab5ae5be700de`:

- archive SHA-256: `c343e9a9e5340272f3b27458a9ddb15758a108c9ee13b6ab6e1328ca5fa79ad2`;
- screenshot: 764 x 485, 4249 bytes;
- PNG SHA-256: `172dc078f842110172336a49b56081b89494d087ab056d8cf48c6ec180254670`;
- visible inspection confirmed the fixture input contained `Ada` and the rendered API result was `saved:Ada`.

The integration test now performs health, project opening, validation, and evidence querying through an official MCP client over the authenticated Remote Host HTTP endpoint. Existing fixture, assertion, service-cleanup, PNG-header/dimension/byte-count/hash checks are retained. Consult the **latest** run for this stronger transport-level proof; the earlier artifact above predates that test strengthening.

The Windows workflow uploads only synthetic fixture PNG/proof JSON, not the runtime state directory or provider logs. `proof.json` records the checked-out runtime commit (a GitHub PR merge ref may differ from the branch head), fixture commit, evidence ID, assertions, and image hash. CI artifacts have finite retention; an old artifact ID is not a permanent distribution channel.

Local execution in the chat container established 23 passing related native/provider/session/product-service tests with no skips. Its packaged source snapshot lacked the installed official SDK graph, so local static success is not full MCP proof. Its Chromium could handshake, but loopback page navigation returned `net::ERR_BLOCKED_BY_ADMINISTRATOR`; no browser management policy was bypassed. Authorized hosted Windows/Linux CI is the real integration boundary for this task.

## Important remaining gaps

### Web connection and image delivery status

Authenticated local HTTP and local `tunnel-stdio` are machine-side boundaries. No real Web app/tunnel association or user-machine connection has been established here. Do not fabricate app IDs, tunnel commands, OAuth configuration, or public endpoints.

Image delivery is closed in the merged #464 line: `evidence_query(includeImages=true)` can return bounded standard MCP image content only for 1..4 unique exact evidence IDs. Runtime-owned realpath containment, regular-file/size checks, PNG/JPEG/WebP constraints, SHA-256 verification, per-image/total-byte caps, and metadata-only default queries are enforced. Do not replace this with an arbitrary file-read endpoint.

### Revocation and running host state — closed

The merged #461 line refreshes credential authority on each authenticated request. A live regression proves that after token rotation an already-running host rejects the old token on both `/status` and `/mcp` and accepts the replacement token. Do not rotate a real user token merely for development proof.

### Supervisor/bootstrap and physical machine proof status

The hosted Windows proof now exercises real Task Scheduler start, Remote Host readiness/health, forced child termination, same-supervisor child restart, and stop/drain. #472 additionally closed a physical Windows failure where a UTF-8 `.cmd` launcher corrupted non-ASCII paths through the active code page; the Veteran-owned PowerShell launcher passed the real lifecycle under a non-ASCII path.

On the existing developer machine `豹`, the current development runtime was installed into the normal Veteran runtime location, `doctor` passed, and the installed Task Scheduler -> supervisor -> Remote Host -> MCP -> Chrome path completed a real browser scenario with `Ada` input, `saved:Ada` rendered result, and PNG evidence. This is useful physical-machine proof, but it is not the clean-spare-machine + actual ChatGPT Web pairing/revocation acceptance sequence above.

A hosted or existing-developer-machine Chromium scenario is not arbitrary desktop control, Windows Electron proof, a full autonomous visual repair demonstration, or a clean spare-machine acceptance run.

## Continuation rules

1. Refresh current `main`, open PR/issue state, and CI truth; fix any failing runtime/integration owner first.
2. Read the current implementation before creating another subsystem or duplicating the installer, browser provider, evidence service, or Mission runtime.
3. Keep all 36 MCP tools and existing input/output authority unless a real product requirement justifies an additive change.
4. Mirror every changed runtime/test path and NEXT_CHAT_HANDOFF.md byte-for-byte in the recovery starter.
5. Keep default HTTP loopback, workspace canonicalization, secret isolation, and explicit consequential-action authority.
6. Close each product clause with its actual evidence level. Do not substitute passing unit tests, a release dry run, or an artifact pointer for a working Web-to-machine result.
