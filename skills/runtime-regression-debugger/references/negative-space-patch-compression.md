# Negative-Space Review and Patch Compression

Use this after a candidate works locally or tests pass, especially when the change crosses state, protocol, persistence, lifecycle, or deployment boundaries.

## Contents

- Review what is missing from the change
- Derive expected companions
- Detect incomplete lifecycle work
- Compress after correctness
- Delete investigation scaffolding
- Preserve explanatory structure
- Reject false minimalism

## Review what is missing from the change

A diff can be wrong because something that should exist is absent. Review expected companion changes from the mechanism, not from style conventions.

Examples:

- public API/schema change but no compatibility handling;
- retry added but no idempotency or unknown-outcome reasoning;
- durable field added but no migration/backfill/read compatibility;
- cache added but no invalidation/expiry/ownership;
- resource created but no teardown/recovery path;
- listener/subscription added but no lifecycle cleanup or reattachment;
- feature flag added but no default/owner/removal condition;
- new async side effect but no duplicate, ordering, or terminal-state handling;
- release behavior changed but no rollback/forward-repair analysis;
- new observability dimension but no cardinality bound where volume is material.

Absence is evidence only when the mechanism requires the missing companion. Do not demand boilerplate for local, reversible changes.

## Derive expected companions

For each changed boundary, ask:

`what new responsibility was created -> who owns its failure -> who closes its lifecycle -> what evidence should now exist`

If the answer is "nothing changed," verify that the change truly remains inside the old ownership boundary.

## Detect incomplete lifecycle work

Check closure pairs where relevant:

`create/delete`, `subscribe/unsubscribe`, `open/close`, `allocate/release`, `publish/consume`, `write/reconcile`, `flag-introduce/flag-retire`, `migration-expand/migration-contract`.

Missing closure often creates slow operational debt rather than an immediate test failure.

## Compress after correctness

Once the mechanism is proven, run a second pass whose goal is to reduce accidental complexity without weakening evidence.

Ask:

- can one state owner replace two synchronized representations;
- can a database/protocol invariant replace defensive application branches;
- can temporary logging/probes/scaffolding be removed;
- can an adapter remain local instead of spreading compatibility logic;
- can duplicated checks collapse into the authoritative boundary;
- can a new abstraction be deleted because it has only one real responsibility/caller.

## Delete investigation scaffolding

Remove speculative branches, debug output, temporary sleeps, test-only production hooks, duplicate listeners, broad retries, and stale comments unless they became intentional observability or compatibility mechanisms.

## Preserve explanatory structure

Do not compress away names, tests, guards, comments, or explicit state transitions that carry important reasoning. The goal is minimum accidental complexity, not minimum line count.

## Reject false minimalism

A smaller diff is not better if it hides migration, compatibility, recovery, authorization, or lifecycle obligations. Prefer the smallest complete mechanism, not the fewest changed lines.
