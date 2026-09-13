# Runtime failure patterns

## Contents

- Candidate/build mismatch
- Stale UI handle after rerender or owner replacement
- Async owner-generation race
- Event interception and replay
- State inferred from DOM instead of owner
- Duplicate feature concepts
- Persistence/UI split brain
- Saved-audience/tag case study
- Green tests that miss the bug
- Required evidence after repeated failure

## Candidate/build mismatch

A surprisingly common "the fix is in the code but the client is still broken" case is that the real process is not running the candidate being reviewed.

Prove:

`source/head -> built bundle/package -> installed location -> running process -> loaded renderer/preload -> active profile/session`

Useful Electron evidence includes application version, `app.getAppPath()`, `process.resourcesPath`, executable path, `app.isPackaged`, and an existing build/commit marker when available. Do not add a release/version bump merely to debug provenance.

A successful artifact on disk is not proof that the user launched it.

## Stale UI handle after rerender or owner replacement

Modern UIs preserve labels and IDs while replacing underlying nodes. `innerHTML`, `cloneNode`, `replaceWith`, framework rerenders, virtualization, WebView navigation, modal transitions, hot reload, and parent-window replacement can invalidate a captured handle.

Risky:

`find target -> unrelated state change/rerender -> use old handle`

Prefer:

`semantic query -> actionability check -> action -> fresh query -> postcondition`

If a fresh query is ambiguous, fail closed. Do not use `first()`/`nth()` or a same-looking replacement unless owner identity is proven.

## Async owner-generation race

A correct write can render into the wrong owner when identity changes while async work is in flight.

Capture a generation before the operation, such as:

`account/profile + window/tab/WebView/document generation + request/version token`

Require it to match before committing. Do not rely only on a reusable account/profile name because A -> B -> A can make a stale request appear current again.

## Event interception and replay

A fragile pattern is:

`capture listener -> preventDefault/stopImmediatePropagation -> custom persistence -> monkey-patch prompt -> replay owner.onclick -> wrapper onchange`

It can fail because listener order changes, the owner is not installed yet, replay guards are wrong, or an exception occurs before the first visible effect. Replace it with one owner handler whenever possible.

For a dead button, search all loaded renderer scripts for the element ID and delegated selectors. Capture listeners deserve special scrutiny because they run before target/bubble handlers.

## State inferred from DOM instead of owner

Rendered chips, checkboxes, and `data-id` attributes are projections, not authoritative state unless the application explicitly defines them that way.

If a module owns `const selected = new Set()`, keep mutation in that module or expose a narrow read/replace bridge. Do not reconstruct private state from DOM and then try to synchronize the owner indirectly.

## Duplicate feature concepts

Names such as "label", "tag", "saved list", and "group collection" can describe different products. Before implementing, write the requested user workflow in one sentence and map existing features to it.

Do not reuse a similarly named feature unless its data and behavior match the requested workflow.

## Persistence/UI split brain

A frequent failure is durable data written in one module while another module keeps an independent in-memory list. Persistence succeeds, but UI does not update, or a late stale write overwrites current state.

Prefer one mutation owner. If durable storage is authoritative, rehydrate the owner from the durable write or have the owner perform the write itself. Await writes and guard account/profile/window/document generations.

## Saved-audience/tag case study

The feature that originally motivated this skill had this minimum contract:

1. select one or more contacts/groups;
2. visible save action;
3. click opens a custom-name input;
4. reject empty name/selection;
5. successful save immediately renders one clickable tag with count;
6. clicking the tag **replaces** current selection with the saved audience;
7. missing chats are skipped with visible warning/count;
8. tag persists across close/reopen/restart for the same account;
9. other accounts cannot see/mutate it;
10. delete persists durably.

The important reusable lesson is not the product itself. It is the one-owner chain:

`current selection owner -> save action -> durable account-scoped write -> owner state commit -> render -> exact restore`

The broken implementation used interception/replay and a second persistence/state path. Preserve this case as architecture archaeology, not as a universal UI design.

## Green tests that miss the bug

String/regex tests can prove code exists but cannot prove a click enters the handler, IPC reaches the intended process, or a rerender invalidates a handle.

After a real-client failure, add a regression at the failed boundary. Where relevant, deliberately replace the target, remount the component, delay an old async response, reload the renderer, or switch owner generation so the previous candidate would fail the test.

## Required evidence after repeated failure

After one apparently successful candidate still fails in the real client, prove runtime provenance before the next patch. After two failed candidates, do not claim completion from CI alone.

Require at least one of:

- real-client regression run on a proven exact candidate;
- user confirmation on the exact validation build;
- runtime trace showing candidate/build identity plus the failed transition chain;
- interaction-level regression reproducing the stale generation/rerender/reload mechanism.

Keep traces free of personal/user data. Record IDs only when synthetic or otherwise non-sensitive.
