# Project Takeover Engineering

Use this when entering an unfamiliar, large, polyglot, generated-code-heavy, or troubled repository, or when asked to own a system without a guided tour. If an authorized Git URL and bounded project-acquisition runtime are available, acquire it there instead of asking for a manual clone; the checkout is source authority, not durable architectural memory.

## Contents

- Start from the operating contract
- Prove repository identity before mutation
- Build the minimum project model
- Maintain a compact Project Intelligence Snapshot
- Recover project language without inventing a glossary
- Navigate by questions and high-value anchors
- Recover the active path and source authority
- Locate authoritative state and hidden consumers
- Use history for hidden coupling
- Separate code, build, and runtime topology
- Recover validation and release topology
- Rank unknowns by decision impact
- Hand broad stewardship to the product-quality owner
- Gate the first consequential mutation
- Rescue before redesign
- Know when the model is good enough

## Start from the operating contract

Do not read the repository top to bottom. Recover the smallest contract needed now:

`actor -> intent -> authoritative transition -> durable/external postcondition -> failure/recovery -> compatibility`

For a bug, narrow to the failing transition; for a feature, the shortest complete slice; for a rescue, the contracts whose failure creates the most user, data, money, or operational harm.

## Prove repository identity before mutation

Before the first write, prove the inspected repository is the one currently authorized using the strongest available combination of explicit owner/name or URL, checkout root, remote/repository ID, and live default branch/HEAD.

Conversation carry-over is only a navigation hint. Branch names, PRs, SHAs, CI runs, ownership assumptions, and release state from another checkout remain untrusted until re-established. If the explicit target and active checkout/connector disagree, switch to the correct repository before mutation.

## Build the minimum project model

Prefer six compact maps over a giant architecture document:

1. **Entry** - routes, commands, handlers, jobs, consumers, processes.
2. **Authority** - who may authoritatively mutate each important fact.
3. **Data** - stores, schemas, projections, caches, queues, external systems.
4. **Runtime** - deployables, processes, workers, shells, regions, version overlap.
5. **Validation** - cheapest focused oracle through real integration/E2E/production proof.
6. **Delivery** - artifacts, migrations, flags, promotion, rollback/forward repair.

Each map must change an implementation, validation, rollout, or risk decision; otherwise do not build it.

## Maintain a compact Project Intelligence Snapshot

For broad takeover/autopilot work, keep one refreshable snapshot as a cache over current evidence, never authority over source/runtime truth. Keep only decision-relevant fields:

- repository identity and freshness boundary;
- product brief: product type, actors/jobs, major surfaces, core journeys;
- the six maps above summarized by live owners rather than directory trees;
- stack/design/dependency/deployment posture only when current;
- current execution envelope across source, shell, browser/render, repo/CI, design, DB/runtime, observability, cloud, persistence, credentials;
- open risks/unknowns and the small current attention queue;
- evidence identities/paths likely to need refresh, not copied dumps.

Use `scripts/repo_surface_map.py <repo> --json` and stack/style fingerprints only as structural seeds. Replace file-presence hints with active-path/runtime evidence before treating them as facts.

Refresh only the slices invalidated by new evidence. Repository/default-branch changes, schema/manifest or design-contract changes, runtime/deployment changes, and material capability changes invalidate affected fields, not the whole project model. Persist the snapshot only when the repository already owns such an artifact or the user requests one.

## Recover project language without inventing a glossary

Resolve ambiguous domain terms from active schemas/enums, public/API names, tests, maintained docs, CLI/UI labels, and current owners. A code name is an observed term, not automatically a definition, and the same word may differ across bounded contexts.

If a term such as `workspace`, `session`, `project`, `run`, `mission`, `account`, or `owner` changes the contract, establish its actor, identity/state, allowed operations, and observable result before using it in architecture/UI decisions. Prefer repository evidence over generic meaning or stale conversation memory.

Passive vocabulary recovery is takeover; inventing a new glossary/domain model is not. Change a durable language artifact only when the project already owns it, the user asks, or the task changes the domain itself.

## Navigate by questions and high-value anchors

Every search should answer a live decision. Follow:

`user-visible entry -> registration/binding -> active caller -> authoritative owner -> durable/external effect -> projection -> validation -> delivery`

Useful anchors include route/command/event/RPC/UI names, public fields or error codes, table/event/job names, flags/config keys, failing stack/log/trace/test identities, and symbols from relevant recent commits. Search outward one ownership hop at a time.

Classify paths as **active**, **conditional**, or **background/dead**. Promote a candidate only when evidence can change the current owner, hypothesis, or validation plan.

## Recover the active path and source authority

Architecture docs describe intent; active callers and runtime behavior describe current truth. Prove:

`entry -> caller -> owner -> state transition -> persistence/side effect -> projection -> visible result`

Use registration/import/wiring, callers, runtime config, tests, exact-build traces/logs, then history when ownership changed. Treat orphaned files, old service names, disabled paths, and similarly named implementations as hypotheses until liveness is proven.

Before editing a matching file, classify it as authoritative handwritten source, generated output, vendored dependency, artifact, schema/client copy, migration snapshot, or fixture. Patch the generator/schema/source when output is derivative, regenerate with project tooling, and review both source and derived diff.

## Locate authoritative state and hidden consumers

For each important fact ask who creates, mutates, deletes/expires, derives/caches, fences stale generations, resolves concurrency, and reconciles partial failure. Multiple uncoordinated writers or a projection silently acting as truth are takeover hotspots.

After finding a writer/public contract, search sideways for workers/jobs, other clients, subscribers/webhooks, caches/indexes/analytics/CDC, generated SDKs/schema bindings, migrations/backfills, compatibility readers, tests/fixtures, and deployment/config/flag definitions. Search by stable contract names/IDs/events/error codes, not only class names.

## Use history for hidden coupling

Use Git history as triage evidence when age, repeated fixes, deletion risk, compatibility, or ownership drift matters. Look for files that change together, recurring fixes around one transition, unexplained compatibility code, never-retired flags/migrations, manual runbooks, ordering/global-state test setup, and temporary adapters that became permanent.

History should recover pressure and contract, not provide a patch to copy or a person to blame. Escalate to `scripts/repo_archaeology.py` or `scripts/change_hotspot.py` only when it can change the next decision.

## Separate code, build, and runtime topology

Folder shape is not a failure-domain map. Recover what builds together, deploys independently, overlaps at different versions, shares DB/cache/queue/filesystem/identity/quota/network boundaries, and can fail or roll back independently.

For workspaces/monorepos, map only affected package roots, build/task graph and cache boundaries, source versus generated targets, public/internal contracts, deployables, affected-test/build selection, codegen edges, and wide-fan-out shared packages. Repository-native graph tooling is evidence, not architecture authority.

Separate compile-time fan-out from runtime/deployment fan-out. Prefer affected targets and representative boundary tests before expensive whole-repository work when they can falsify the change; still run project-required final gates.

## Recover validation and release topology

Before implementation is deep, know the fastest owner-level test, real integration boundary, representative E2E/black-box check, exact build/artifact identity, release/version authority, automation that may create/publish follow-up artifacts, migration/flag ordering, required versus optional gates, rollback limits after durable state changes, and production signal that proves the user contract.

Do not discover late that the needed oracle is unavailable. For release work, each consequential remote mutation invalidates the affected release snapshot; refresh authoritative state before the next mutation.

## Rank unknowns by decision impact

Classify unknowns as **blocking**, **high-value**, **deferrable**, or **irrelevant**. Resolve only blocking/high-value unknowns with the cheapest evidence that can change owner, behavior, security/data/money, compatibility, or validation. Do not ask the user to answer repository-discoverable mechanics.

## Hand broad stewardship to the product-quality owner

For broad authorization, takeover owns **truth recovery and the refreshable project model**; `proactive-product-stewardship.md` owns **candidate ranking and Product Health Scan policy**.

Hand off only evidence-backed seeds:

`signal/evidence -> consequence -> confidence -> cheapest falsifier -> likely write/validation boundary`

Keep a few live candidates, not a cleanup backlog. TODO count, file size, dependency age, coverage, or awkward architecture are leads until tied to a live consequence. A hypothesis should produce a probe, not a speculative rewrite. Evidence-backed no-change is valid.

## Gate the first consequential mutation

When takeover uncertainty is material, run `python3 scripts/takeover_readiness_gate.py <takeover.json> --json` with repository identity, live path/authority, material consumers, decision-changing unknowns, bounded write set, falsifier/integration oracle, recovery, and collision handling bound to current evidence.

A pass checks structure, not truth; repository/runtime evidence still owns correctness.

## Rescue before redesign

When ownership is unclear, incidents recur, or changes break unrelated paths, stabilize first: preserve the few contracts that must survive, freeze unrelated churn, map state/write paths/queues/manual jobs/external effects/deployables, characterize dangerous seams, then remove the highest-amplification failure mechanism.

Prefer `characterize -> contain -> establish authority -> create seam -> migrate one cohort -> compare -> move ownership -> delete old path -> simplify operations`. Measure success by fewer incidents/change failures/manual steps, faster recovery, and fewer unnecessary state/ownership edges—not rewrite percentage.

Avoid takeover anti-patterns: broad file reading without a question, README over callers, reorganization before compatibility is known, TODO-as-defect, deleting weird code without history/consumer checks, parallel architecture maps, preferred-framework vocabulary, user-driven navigation, or context collection mistaken for progress.

## Know when the model is good enough

Start acting when you can answer with risk-appropriate evidence:

- exact contract changing/failing;
- live path and authoritative mutation owner;
- material consumers/companion responsibilities;
- independent failure/deployment boundaries and compatibility window;
- cheapest falsifier and strongest practical validation boundary;
- what is reversible versus hard to reverse after state change.

Search is complete enough when remaining unknowns cannot change the next safe action. Takeover is not complete when every subsystem is understood; it is complete when unbounded exploration is no longer needed.
