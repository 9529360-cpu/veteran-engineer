# Veteran Engineer - Next Chat Handoff

## Active outcome

Continue **Veteran Remote Host**, not the older generic audit workstream.

The user wants:

`ChatGPT Web -> approved authenticated MCP connection -> dedicated Windows development machine -> inspect/edit/run/test the real project -> launch browser/Electron -> inspect rendered evidence -> repair mismatches -> report the validated result`

Layout, theme, and workflow requirements remain separate acceptance dimensions. A color change is not a structural redesign. A screenshot filename is not visual inspection. A local MCP entrypoint is not a configured Web connection.

Read `REMOTE_HOST_HANDOFF.md` in the repository for the detailed checkpoint.

## Current repository line

- Repository: `9529360-cpu/veteran-engineer`
- Active branch: `feat/remote-host-windows-visual-validation`
- Active PR: **#461**, based on `feat/remote-host-secure-tunnel-stdio` / #460.
- Stack: #457 HTTP control plane -> #458 supervised Windows host -> #459 clean-machine bootstrap -> #460 local tunnel stdio boundary -> #461 Windows browser proof.
- These are implementation PRs, not evidence of a merged or released product. Refresh their actual state before editing.
- Last production-code change when this checkpoint was prepared: `3ce5fb25b7db11b58a06fa75b87ab5ae5be700de`. Subsequent test/documentation changes strengthen the proof; fetch the current PR head and workflow results rather than assuming this SHA is current.

## What the current slice established

Windows Chromium startup previously timed out despite an explicit temporary `--user-data-dir`. A controlled Windows probe showed that the incomplete isolated Windows profile environment triggered Chrome's non-default-data-directory refusal. The same browser and same CDP pipe completed the handshake when isolated Windows profile variables were supplied.

The fix belongs to `createBrowserIsolatedEnvironment` in `src/browser-validation-provider.mjs`: APPDATA, LOCALAPPDATA, HOMEDRIVE, and HOMEPATH are derived from the private temporary home, never inherited from the caller's profile. No sandbox, browser management policy, workspace gate, or network restriction was disabled.

At `3ce5fb2`, the real Windows UI-to-API scenario passed and produced a verified PNG. The test now drives the same scenario through authenticated Remote Host HTTP MCP (`runtime_health`, `project_open`, `validation_run`, `evidence_query`) rather than directly invoking application services. The latest CI determines whether this stronger transport proof is green.

The Windows job exports only the synthetic fixture's `fullstack.png` and `proof.json`, with source identity and SHA-256. Download and inspect that image before making a visual-completion claim. Root and starter copies of changed runtime/tests remain identical.

## Next safe work

1. Refresh #461 and all latest CI jobs. Fix any failing owner without weakening the real browser or screenshot oracle.
2. Complete bounded, opt-in screenshot/artifact retrieval through the existing evidence/MCP surface. Currently evidence metadata contains pointers; that alone does not let ChatGPT inspect image bytes. Preserve scope, containment, MIME/size limits, and stored hash verification.
3. Test live credential revocation/rotation against an already-running HTTP host. The existing host captures config at startup; do not trust the CLI's immediate-invalidation wording without a real old-token rejection test. Do not rotate a user's actual credentials as part of development.
4. Strengthen the supervised-host and clean-machine proof beyond Task Scheduler registration: real start/readiness, stop/pause, restart/recovery, repair, and cleanup.
5. Perform the first authorized spare-machine/Web workflow only when the actual tunnel/app association, installation, and machine access are available.

## Invariants and boundaries

- One Skill/policy and one Mission/MCP runtime. Remote transport is not another engineering engine.
- Keep the existing 34 intention-level MCP tools unless a demonstrated product requirement demands a contract change.
- Root runtime is the handwritten owner; mirror changed runtime/tests and this file under `skills/runtime-regression-debugger/assets/plugin-runtime-starter/`.
- Default HTTP bind stays loopback; stdio opens no network listener. Neither provisions a tunnel, app ID, OAuth flow, or public URL.
- Preserve local workspace canonicalization, caller-secret isolation, process cleanup, and evidence source identity.
- Merge, release, deploy, external publication, actual credential rotation, and machine/security-policy changes are not implied by implementation work.
- Continue ordinary repository-answerable work without asking the user to select files, libraries, or test names.

Do not call Remote Host end-to-end complete until the user's machine proves installation/pairing, real Mission edits and tests, rendered inspection, mismatch repair, and disconnect/revocation. Hosted-runner proof is valuable but is not that final acceptance.
