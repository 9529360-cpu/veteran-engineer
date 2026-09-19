# AI and LLM product engineering


## Contents

- Keep deterministic authority outside the model
- Bind behavior to exact identity
- Keep context small and trust-aware
- Validate structured output semantically
- Tool calls are proposed actions
- Make agent actions controllable, not merely visible
- Memory is durable product state only when explicitly owned
- Make latency, cost, failure, and fallback product behavior
- Evaluate behavior, not demos
- Observe without building a secret warehouse
- Whole-stack completion

Use this when a product depends on generative models, retrieval, tool calling, structured output, agent loops, or model-based automation. Treat the model as a probabilistic dependency inside an ordinary product contract:

`user intent -> bounded trusted context -> model proposal -> deterministic validation/tool policy -> product effect -> visible result or recovery -> evaluation`

The goal is not “the model answered.” The goal is a useful product outcome with deterministic authority where correctness matters, bounded execution, truthful failure states, and evidence tied to the exact model/config that produced them.

## Keep deterministic authority outside the model

Models may draft, classify, extract, rank, explain, plan, or propose tool calls. Trusted application code owns material authentication/authorization, tenant/object scope, money, destructive state, schemas/invariants, idempotency identity, resource limits, durable workflow state, and required confirmation.

Prompt text, retrieved text, prior conversation, model explanation, possession of an object id, or a listed tool never grants authority. Validate consequential claims/actions against current trusted state immediately before the effect.

## Bind behavior to exact identity

Treat provider, model id/version, prompt/config version, tool schema version, and retrieval/index/source version as dependencies when they can change behavior. Do not assume model upgrades are equivalent. Bind important evidence, rollout cohorts, durable generated artifacts, and regressions to enough exact identity to explain what was evaluated.

Keep model/config selection simple. Add fallback models, routers, prompt variants, or provider abstraction only when a real reliability, cost, compliance, capability, or migration pressure requires them; remove temporary variants after cutover.

## Keep context small and trust-aware

Separate system/developer policy, user input, retrieved/reference material, tool results, and prior workflow state. Retrieved or user-controlled text is data unless explicitly authorized as instruction.

Use retrieval only when the product needs fresh/private/large-domain knowledge and has an authoritative corpus. Authorization happens before retrieval or exposure. Vector similarity is neither authorization nor truth. Preserve stable source identity/freshness and define behavior for missing, stale, conflicting, or insufficient evidence.

Send only context needed for the decision. Large irrelevant context increases cost and can reduce reliability. Do not place credentials, unrelated tenant data, or unnecessary sensitive raw content into prompts, traces, eval fixtures, screenshots, or evidence.

## Validate structured output semantically

Prefer bounded schemas when downstream code consumes model output. Validate shape, enum/range/count bounds, referenced identifiers against current state, and cross-field invariants.

Schema-valid output can still be wrong. Before a durable/external effect, validate the product meaning at the deterministic owner. Preserve provenance when the product must distinguish source fact from model inference.

## Tool calls are proposed actions

A tool loop is:

`model proposes -> application authorizes/validates -> tool executes -> result is normalized -> continue or terminate`

Give every tool stable identity and a real purpose. Define its trusted authorization boundary, side-effect class, retry/idempotency behavior, timeout/cancel behavior, secret handling, and whether explicit confirmation is required.

Consequential actions do not become safe because the model requested them confidently. Shell, SQL, URL fetches, payments, permission changes, deployments, destructive mutations, and similar effects stay behind their normal trusted boundaries.

Bound loops by positive time, step, and tool-call budgets. Stop repeated or behaviorally equivalent loops instead of retrying indefinitely. A model timeout never justifies blind replay of an ambiguous non-idempotent tool effect; reconcile the existing operation first.

Use `ai_product_gate.py` only for machine-checkable execution structure: exact model/config identity, unique tool ids, required confirmation for consequential tools, and positive execution limits. Do not treat that gate as proof of prompt quality, safety, privacy, fallback, or rollout completeness.


## Make agent actions controllable, not merely visible

For an agent that can change the world, use an explicit action-trust contract:

`intent/subject -> proposed action + effect -> trusted authorization/approval -> execution -> completion evidence -> recovery or escape`

Keep these boundaries separate:

- **recommendation/draft** - the agent may propose, preview, or prepare an action without implying execution authority;
- **authorization/approval** - trusted product policy decides whether this principal may perform this exact action on this exact subject now;
- **execution** - the tool/runtime performs the effect under bounded identity, scope, timeout, cancellation, and retry semantics;
- **completion** - evidence proves what actually happened; a tool-call event, optimistic UI state, or model narration is not the durable/external postcondition;
- **recovery/escape** - cancel, undo, compensate, reconcile, detach, retry, or human takeover has explicit semantics where the effect allows it.

Approval UX must describe the decision the user is making, not merely the tool name. For a consequential action, surface enough of the current proposal to understand the target/subject, action and material effect, critical parameters/scope, important irreversible or monetary consequences, and whether the action can be undone or safely retried. Re-check current trusted state before execution when the proposal can go stale between preview and approval.

Tool metadata, model confidence, MCP annotations, a tool's name, or a framework `requires_approval` flag are policy inputs or hints, not authority by themselves. Authorization remains at a trusted application boundary. A tool labeled read-only still requires the same tenant/object authorization as the underlying read. A broad shell or browser tool must not silently bypass a product approval boundary that a dedicated action would have exposed.

Treat **Stop**, **Cancel**, **Interrupt**, **Undo**, and **Detach** as different contracts. Never render a Stop/Cancel affordance that only closes a stream or hides progress while the executor continues an effect the user reasonably believes stopped. Propagate cancellation to the owning executor when cancellation is supported, fence stale work from committing after cancellation, and wait for a trustworthy terminal/idle boundary before showing stopped. If an irreversible/external action may already have committed, show the outcome as unknown/needs-reconciliation until authority is re-read; do not pretend cancellation rewound it.

Give users an escape hatch proportional to the stakes. Reversible work should expose undo/revert where the product genuinely owns one. Long-running work should expose cancel, detach/background, or human takeover as appropriate. Irreversible actions should not advertise fake undo; instead use stronger preview/approval plus visible confirmation and repair/compensation guidance.

When durable memory, hidden project context, or previous-session state materially changes the proposed action, make enough of that dependency legible that a surprising action can be understood and corrected. Do not use stale hidden context to silently broaden scope or infer authorization.

Represent uncertainty through evidence and state, not decorative probability. If the agent lacks a required fact or authority, prefer `needs-input`, `blocked`, `unknown-outcome`, or a bounded draft/recommendation state over guessing a high-consequence semantic choice.


### Keep capability, intent, and approval honest across agent surfaces

Define an intentional capability map for every materially different execution surface: foreground chat, background session, delegated worker, scheduled run, webhook/job, or other autonomous entry. For each required product action, either provide a supported structured action/tool path or expose the limitation explicitly. Do not promise one product capability while silently provisioning a weaker tool/context set on another surface. Exact one-to-one parity is not required when the difference is intentional, but the delta must not produce invisible amnesia, missing actions, or different authority semantics.

Prefer tools at meaningful product transitions. A giant `do_everything` action hides partial failure and approval scope; only low-level shell/browser primitives can hide the business action inside opaque commands. Use action-specific typed tools when they create a real authorization, staleness, audit, retry, or review boundary, while keeping lower-level primitives for work that genuinely belongs at that level.

Use an **intent handshake** when both are true: (1) the agent inferred material scope/meaning rather than receiving it explicitly, and (2) acting on that inference could create consequential, broad, external, destructive, costly, or hard-to-review effects. At that decision point, make the target, intended outcome, material scope, and important non-goals/consequences visible and resolve the ambiguity before action. Do not turn this into confirmation theater for explicit, ordinary, reversible work the current contract already authorizes.

Interactive approval does not automatically cover unattended execution. For cron/webhook/background/batch entry points where nobody can answer a prompt, use an explicit pre-authorized policy envelope, defer the action for human review, downgrade to draft/read-only work, or block visibly. Never convert `no human is present` into implicit approval. Keep the same principal/tenant/object/action boundary across interactive and unattended paths.

Treat completion signals as product protocol, not absence of activity. A stream ending, model turn ending, client disconnect, or worker silence is not by itself proof that all delegated/tool effects reached their intended terminal state. Use explicit terminal/blocked/needs-input/reconciling state plus the relevant authoritative evidence.

## Memory is durable product state only when explicitly owned

Conversation context is not automatically durable memory. If the product stores memory/personalization, define subject/project scope, provenance, write authority, visibility/consent, freshness/supersession, retention/deletion, conflict handling, and whether the item is fact, preference, inference, or generated summary.

Do not silently promote model inference to user truth. Summaries are projections of underlying evidence, not stronger authority than the evidence they summarize.

## Make latency, cost, failure, and fallback product behavior

Budget the real path: admission/retrieval/model/tool calls/post-validation/response. Bound tokens/context, parallelism, retry count, model tier, queueing, time, and tool loops by the user-facing latency/cost contract and downstream capacity.

Plan explicit visible behavior for provider timeout/unavailability, quota/rate limit, malformed output, retrieval gaps, tool failure, refusal/policy denial, hallucinated identifiers, oversized context, and partial multi-step completion. Use deterministic fallback, bounded retry, human review, draft-only mode, explicit unavailable state, or resumable async work only when the product contract supports it.

Do not silently fall back to a model/provider/path with materially different privacy, authorization, or quality properties.

## Evaluate behavior, not demos

AI features need ordinary integration tests plus representative behavior evaluation. Cover common, ambiguous, missing-evidence, adversarial/instruction-conflict, tool-denied/failure, authorization-denied, long/noisy-context, and known regression cases when relevant.

Use the strongest available oracle: deterministic invariants, required/forbidden facts, source/citation correctness, tool/action correctness, business postconditions, or a reviewed human rubric for subjective quality. Keep a stable regression core and independent challenge cases; do not tune against the entire held-out set until it stops being evidence.

Offline eval is not production outcome. Monitor the user outcome plus reliability, safety, latency, cost, fallback, and failure guardrails under exact model/config identity. Roll back configuration separately from reconciling durable/external effects already produced.

## Observe without building a secret warehouse

Correlate request/workflow id, exact model/config identity, latency/token/cost counters, bounded retrieval source ids, tool names/status, validation failures, fallback path, and result class when useful.

Avoid raw prompts, documents, tool payloads, model outputs, credentials, tokens, or sensitive user content unless a defined product need and access/retention policy justify them. Product analytics, model operations, and security/audit logs have different authorities and retention needs.

## Whole-stack completion

Trace material changes through:

`UI/request -> authorization -> context/retrieval -> model -> validation/tool policy -> domain mutation -> persistence -> visible completion -> telemetry/eval`

Frontend may own streaming/cancel/partial-state/citations/uncertainty/confirmation UX. Backend may own provider calls, context assembly, schema validation, tool authorization, quotas, durable jobs, and reconciliation. Data owners handle retrieval freshness, generated artifacts, memory provenance, and deletion. Release owners handle credentials/config, capacity, rollout, fallback, and exact deployed model identity.

Do not stop at a locally successful model API call when the product contract crosses these boundaries.
