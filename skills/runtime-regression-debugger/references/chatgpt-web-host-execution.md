# ChatGPT web host execution

Use this only for long or tool-heavy engineering missions inside ChatGPT web or another streamed interactive host where connector availability, response streaming, context pressure, or partial tool outcomes affect reliability. Do not load it for ordinary short repository tasks.

## Contents

- Preserve model reasoning room
- Discover capabilities just in time
- Prefer authoritative tool surfaces
- Maximize information gained per call
- Adapt batching to host pressure
- Bound evidence returned to the model
- Recover interrupted turns
- Reconcile uncertain mutations
- Keep a replaceable working set
- Carry a bounded mission frontier
- Treat host UI symptoms as evidence
- Drive the foreground mission until a real stop

## Preserve model reasoning room

Give the model the objective, authority, invariants, strongest evidence, and exposed tools; do not micromanage valid local sequencing. Fixed process rules should protect real boundaries such as authorization, freshness, idempotency, source-of-truth ownership, compatibility, or completion evidence.

Use:

`objective -> next decision frontier -> best evidence/action -> observe -> update -> continue`

not a tool ritual or transcript-maximizing checklist.

## Discover capabilities just in time

Treat only tools actually exposed to the current session as callable. An installed browser extension, desktop app, community plugin, local MCP server, shell utility, or account integration does not count unless the current host exposes a callable action.

Discover a capability when the next material decision needs it or a stronger oracle would materially change evidence. Reuse established capability state until connection, credential, sandbox, repository, runtime, or host state changes.

`need -> capability class -> exposed tool -> evidence level -> fallback`

Current tool responses outrank the cached map. With `chatgpt-web-host` and no explicit override, keep the router at 4 active references / 48 KiB; expand only for a distinct current-stage owner.

## Prefer authoritative tool surfaces

Use structured repository/CI connectors for remote branch/PR/commit/workflow state; source/history/terminal for checkout implementation; browser/render/desktop GUI for user-visible claims; design-canvas tools for editable design boundaries; public web for external facts. Prefer stronger authority, fresher identity, lower ambiguity, and lower context cost. Cross-check with a second surface only when it materially strengthens a consequential claim.

Before creating a remote branch/PR/release or addressing one by name, resolve existing authoritative state when cheap. Reuse an existing resource and exact returned identifiers instead of guessing names or duplicating remote effects. If the base moves, compare the live intended delta before creating a replacement; reuse/retarget the existing remote artifact and reacquire only invalidated proof when that remains truthful.

## Maximize information gained per tool call

Favor calls that can change the next engineering decision. Know which materially different result would alter the next action; if all outcomes lead to the same action, the call is probably low value.

Prefer exact files/symbols/callers, bounded multi-question reads, one discriminating experiment, one authoritative post-mutation read, and concise artifacts over broad scans or repeated raw output. Optimize information gained per host/context cost, not minimum call count.

## Adapt batching to host pressure

Batch only independent, bounded, already-needed reads. Keep dependent steps, ordered/shared writes, non-idempotent mutations, speculative searches, and potentially huge outputs serial.

Treat host failures as dynamic execution-envelope evidence. After a tool-call ceiling, reduce fan-out/batch size for the remaining session. After a connector endpoint denial, active-workflow rejection, or other state-dependent failure, cache that limitation and do not retry the same unchanged error class until capability or authoritative state changes. A fallback should become narrower and more authoritative, not merely repeated.

## Bound evidence returned to the model

Raw tool output is temporary evidence, not memory. For verbose logs/builds/tests/diffs: retain the complete artifact when useful, inspect summary/error signatures first, then read only discriminating ranges while preserving artifact/path/identity.

If output is truncated, do not repeat the same broad operation only to obtain a complete transcript. Use targeted ranges, filters, exact failing tests, or stored artifacts. Re-run only when state may have changed or the missing portion is decision-critical.

## Recover interrupted turns

A streamed reply can fail after actions already occurred. Treat host-response interruption separately from engineering outcome. On `continue`, preserve mission/contract/last proof, identify only facts that could have changed, refresh those authorities, then continue from the newest proven boundary.

Do not restart takeover, reload reference families, rescan the repository, or rerun broad tests just because the response stream ended.

## Reconcile uncertain mutations before retry

If a write may have succeeded but the host lost its response, classify it as **unknown outcome**, not failure. Before retrying a consequential or non-idempotent action, inspect the authoritative state that proves whether it happened: diff/tree state, remote SHA/PR/workflow, release/tag, deployed artifact, database version, provider operation ID, or visible runtime result.

Reconcile that state against the current mission's initiated-action ledger before narrating causality. A changed remote state or stale-write conflict does not prove that another session/agent performed the change. Preserve self-initiated downstream automation as a plausible cause until actor-specific evidence excludes it.

Retry only after proving the effect did not occur or when the operation is safely idempotent under the same identity.

## Keep a replaceable working set

Long sessions should preserve decisions and evidence, not every path used to obtain them.

`goal | accepted contract | current owner | authoritative identities | decisions | strongest evidence | open risks | next action`

Retire superseded specialist detail at stage changes and refresh dynamic evidence selectively. A checkpoint is a recovery cache, not a stop signal. `scripts/engineering_journal.py <journal> resume` emits compact current state; use it after interruption instead of replaying the transcript. Do not force the user to send `continue` at arbitrary tool-count/time thresholds; continue autonomously while a safe next action exists and the session remains usable.

## Carry a bounded mission frontier

For broad foreground ownership, keep a small ordered queue of already-evidenced next outcomes instead of rediscovering the project after every slice. A useful row is `key -> action -> basis -> owner -> rank -> dependencies -> state`; the queue is a cache over current truth, not a roadmap or authority.

Keep **one active frontier lease**. Work it through an **evidence-producing work quantum** that reaches a new observable result, decision, or blocker. Do not switch for marginal rank changes. Preempt only when fresh evidence invalidates the work or exposes materially higher consequence such as security/data loss, incident, blocking authority change, or explicit user redirection.

After a slice closes, re-rank only candidates whose evidence, dependency, owner, or impact changed. Re-scan only when the queue is exhausted, stale/blocked, or material product/authority/topology change invalidates its ordering. `engineering_journal.py` persists frontier state and `assess` detects the simple three-checkpoint stall loop.

## Treat host UI symptoms as evidence

The model may not observe spinner/jank/reconnect/frozen-stream symptoms. Treat user reports as host evidence and correlate them with stage, tool volume, output size, connector errors, or repeated loads. Do not assign root cause without discriminating evidence.

## Drive the foreground mission until a real stop

Treat broad instructions such as `take over`, `keep improving`, or `continue working` as an open **foreground mission** for authorized ordinary reversible work. Intermediate milestones are continuation signals: while the current response/tool execution remains active, a completed patch, green focused test, checkpoint, stage change, or convenient summary point is not a handoff.

Do not ask ritual `continue?` questions for already-authorized reversible work. Stop only when the done definition is closed, stewardship finds no material evidence-backed work in scope, required semantics cannot be recovered safely, the next action needs missing authorization/credentials/consent, a mandatory environment/tool boundary is unavailable after useful fallback work, or the host itself prevents further execution.

Do not manufacture low-value work merely to stay busy. If the host forces a response boundary, preserve the compact checkpoint and exact next action; do not claim background execution after the active turn has ended. On the next `continue`, resume from that proven boundary instead of re-planning.

Web-host optimization should yield **more validated work per active turn, fewer redundant calls, smaller context, stronger evidence, and cheaper recovery** while preserving model judgment.
