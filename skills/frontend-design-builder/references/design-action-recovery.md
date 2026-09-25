# Design Action Recovery

Use this reference whenever a design-provider action mutates a canvas, library, mapping, asset, generated resource, or other external design state.

The goal is to make retries boring: never duplicate user work, never guess what partially succeeded, and never turn an uncertain failure into a second mutation.

## Before mutation

For every mutating phase:

1. lock the exact target identity: provider, file/resource, page/frame/component/node, and active repository revision when code is involved;
2. load any provider prerequisite workflow required for the action;
3. inspect the smallest relevant existing structure;
4. record exact IDs/keys returned by prior successful writes in the design session ledger;
5. decide the evidence that will prove the write succeeded.

Prefer check-before-create when an operation can be retried. Reuse an exact existing entity from the ledger or deterministic scoped identity instead of creating a duplicate.

## Retry contract

Honor provider retry metadata when it exists.

- If the provider explicitly says the failed action is safe to retry without reading state, fix the request and retry once.
- If the provider says the action may have partially succeeded, or provides no reliable retry guarantee, stop writes and inspect the affected target first.
- If inspection proves the intended mutation already happened, continue from validation rather than replaying the write.
- If inspection proves a clean miss, retry the smallest idempotent action.
- If the result is structurally inconsistent, repair or clean up only the exact entities created by the failed phase, then restart that phase.

Unknown write outcome means **inspect first**, never "probably failed."

## Exact identity over fuzzy cleanup

Never authorize destructive cleanup from a name prefix, visual similarity, or broad search result.

Safe cleanup requires one of:
- exact provider entity IDs returned by the failed/successful write;
- an exact deterministic identity plus expected parent/type and a read-back confirmation;
- a repository path/revision that belongs to the current mutation authority.

If exact identity cannot be established, leave the uncertain entity in place and report it rather than risking user-owned work.

## Partial success

When a multi-step mutation fails after some work succeeded:

1. keep the successful entities in the ledger;
2. mark only the failed/pending substep incomplete;
3. read back the smallest affected scope;
4. resume from the first unmet postcondition.

Do not restart the entire design task because one write failed.

Examples:
- component created, screenshot failed -> resume at visual validation;
- variables created, component binding failed -> keep variables and resume binding;
- Code Connect write timed out -> read the mapping before submitting again;
- live-page capture returned an error after import -> inspect target file before recapturing.

## Structural corruption

Treat these as phase-level failures rather than patch-in-place work:
- broken component cycles;
- stale/deleted variable collections whose IDs are referenced elsewhere;
- malformed variant/component-set structure;
- duplicated generated resources with ambiguous ownership;
- a write that moved or replaced unrelated user-owned content.

Recover by exact-ID cleanup or rollback of the affected phase, then rebuild that phase from the last verified checkpoint.

## Evidence after mutation

A mutation is not complete when the provider returns success. Close the phase only when its required postconditions pass.

Use the router's `success_evidence` as the minimum provider-side evidence, then add runtime evidence when production code is affected.

Typical evidence:
- structural read-back for created/mutated IDs, names, parentage, bindings, or mappings;
- one visual review after the coherent phase;
- Code Connect/read mapping round-trip after mapping writes;
- asset existence and geometry after transfer;
- real product render when design-to-code or code-to-design work changes production behavior.

Do not repeat passing evidence when nothing relevant changed.

## Resume

For long workflows, combine this recovery contract with `design-session-ledger.md`.

On resume:
- reacquire exact identities;
- invalidate only stale evidence;
- verify entities still exist;
- continue from the first unmet postcondition.

The ledger is a cache of verified state, not permission to skip verification after a relevant source mutation.
