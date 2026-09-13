# AI and LLM product engineering

Use this when a product feature depends on generative models, model APIs, prompt/context construction, retrieval, tool calling, structured outputs, agent loops, or model-based automation. Treat AI behavior as one probabilistic dependency inside the full-stack product contract, not as magic outside normal engineering ownership.

A useful contract is:

`user intent -> bounded context -> model/tool policy -> inference/tool execution -> validation -> durable/product effect -> visible result -> fallback/recovery -> evaluation`

The goal is not to maximize model cleverness. The goal is to deliver useful, safe, observable product behavior with explicit authority, bounded uncertainty, cost/latency control, and evidence that the behavior works for representative cases.

## Contents

- AI product contract
- Separate deterministic and probabilistic owners
- Model selection and version identity
- Prompt and context engineering
- Retrieval and grounding
- Structured outputs
- Tool calling and agent loops
- Safety and authorization
- State, memory, and personalization
- Latency, cost, and capacity
- Failure, fallback, and degraded behavior
- Evaluation and regression
- Observability and privacy
- Rollout and compatibility
- Implementation across the stack
- Reporting contract
- Boundaries

## AI product contract

Before implementation, define:

- actor and product goal;
- model-dependent decision or generation step;
- authoritative non-model state;
- information the model may receive;
- tools/actions the model may request;
- validation before any durable or external effect;
- expected output contract;
- acceptable uncertainty/error class;
- fallback or human/operator recovery;
- latency and cost envelope when material;
- evaluation set and release evidence.

Do not define success as "the model responds." Define the user-visible outcome and the failure modes that matter.

## Separate deterministic and probabilistic owners

Keep deterministic product authority outside the model whenever correctness requires it.

Models may propose:

- classifications;
- drafts;
- extraction candidates;
- plans;
- tool intents;
- ranked options;
- explanations.

Trusted application code should own, where material:

- authentication and authorization;
- tenant/object scope;
- billing/value transfer;
- destructive mutations;
- schema and invariant validation;
- idempotency/retry identity;
- rate/resource limits;
- durable workflow state;
- external side-effect confirmation.

Do not ask a model to "remember" a critical invariant that application code can enforce mechanically.

## Model selection and version identity

Treat model/provider selection as a versioned dependency.

Record, when material:

- provider and model family/version;
- required capabilities such as tool calling, vision, JSON/schema output, context size, or streaming;
- latency/cost envelope;
- fallback model policy;
- region/data handling constraints;
- model upgrade compatibility and evaluation requirements.

Do not assume two model versions are behaviorally interchangeable. Bind important evaluation evidence to exact model/config/prompt identities.

## Prompt and context engineering

Treat prompts as executable product logic.

Keep clear separation between:

- system/developer policy;
- user input;
- retrieved/reference context;
- tool results;
- prior conversation or workflow state;
- output/schema instructions.

Prefer explicit contracts over prose accumulation. State:

- task and role;
- allowed/forbidden actions;
- relevant facts;
- uncertainty behavior;
- output format;
- stop/escalation conditions.

Avoid copying entire repositories, documents, or histories into context when a smaller relevant slice answers the decision. Large irrelevant context increases cost and can reduce reliability.

When user-controlled or retrieved text can contain instructions, preserve the trust boundary: content is data unless the product explicitly authorizes it as instruction.

## Retrieval and grounding

Use retrieval when fresh/private/large-domain knowledge is needed and the product can identify an authoritative corpus.

Define:

`query construction -> retrieval scope -> ranking/filtering -> context assembly -> citation/grounding -> freshness -> authorization`

Material requirements include:

- tenant/document authorization before retrieval;
- stable source identity;
- freshness/version semantics;
- bounded result count/context size;
- behavior when evidence conflicts or is insufficient;
- citation or traceability expectations when users need to verify claims.

Do not treat vector similarity as authorization or truth.

## Structured outputs

When downstream code consumes model output, prefer a bounded schema over free-form parsing.

Validate:

- schema shape and required fields;
- enum/range constraints;
- identifiers against current authoritative state;
- cross-field invariants;
- maximum sizes/counts;
- unknown/additional fields according to the contract.

A schema-valid response can still be semantically wrong. Validate consequential claims against trusted state before acting.

For extraction tasks, preserve provenance when the application needs to distinguish source text from model inference.

## Tool calling and agent loops

Treat tool calls as untrusted proposed actions until application policy validates them.

For each tool define:

- exact purpose and side effects;
- parameter schema;
- principal/tenant/object authorization;
- idempotency/retry behavior;
- timeout/cancel semantics;
- result size and secret handling;
- whether confirmation is required;
- whether the tool is read-only, reversible, or consequential.

A safe loop is:

`model proposes -> application validates -> tool executes -> result normalized -> model continues or terminates`

Bound autonomous loops by step count, time, cost, tool call count, and external side effects. Detect repeated/behaviorally equivalent loops rather than allowing unbounded retries.

Do not let model text directly become shell, SQL, URL fetch, payment, permission, deployment, or destructive input without the corresponding trusted boundary.

## Safety and authorization

Use normal product authorization even when the model generated the action.

Never infer authorization from:

- the model's explanation;
- possession of an opaque object id;
- prior visibility in conversation;
- a retrieved document being semantically similar;
- a tool being listed to the model.

Filter or minimize sensitive context before model submission according to product/privacy policy. Do not persist secrets in prompts, traces, eval fixtures, screenshots, or evidence bundles.

For high-impact actions, keep explicit deterministic confirmation/approval boundaries where required by product policy.

## State, memory, and personalization

Separate conversational context from durable product memory.

For durable memory define:

- source/provenance;
- scope: user/account/workspace/project;
- write authority;
- consent and visibility;
- freshness and supersession;
- deletion/retention;
- conflict handling;
- whether the memory is fact, preference, inference, or generated summary.

Do not silently convert a model inference into durable user truth.

When summarizing long histories, preserve critical identities, decisions, unresolved risks, and source links rather than treating the summary as stronger authority than underlying state.

## Latency, cost, and capacity

AI calls often dominate request latency and marginal cost.

Budget the path:

`queue/admission -> retrieval -> model inference -> tool calls -> post-validation -> response`

Control, when material:

- max tokens/context;
- model tier;
- streaming behavior;
- parallel calls;
- retry count;
- tool loop count;
- timeout;
- batch/background execution;
- cache/reuse only where semantic freshness allows it.

Do not retry non-idempotent tool effects because the model call timed out. Separate inference retry from side-effect reconciliation.

Prefer cheaper/smaller models for tasks they can satisfy, but require evaluation evidence before routing critical behavior to a weaker model.

## Failure, fallback, and degraded behavior

Plan explicit outcomes for:

- provider timeout/unavailable;
- rate limit/quota exhaustion;
- malformed structured output;
- tool failure;
- retrieval empty/stale/conflicting;
- model refusal;
- hallucinated identifiers/actions;
- context too large;
- safety/policy denial;
- partial multi-step completion.

Possible product behavior includes deterministic fallback, smaller/local model, retry with bounded policy, human review, draft-only mode, explicit unavailable state, or resumable async workflow.

Do not silently downgrade to behavior with materially different privacy, accuracy, or authorization properties.

## Evaluation and regression

AI features need behavior evaluation in addition to ordinary unit/integration tests.

Build an evaluation set from representative product cases, including:

- normal/common inputs;
- edge/ambiguous inputs;
- adversarial or instruction-conflict cases when relevant;
- missing evidence;
- long/noisy context;
- tool success/failure;
- authorization-denied cases;
- known historical regressions.

For each case define an oracle appropriate to the task:

- exact schema/invariant checks;
- required/forbidden facts;
- citation/source correctness;
- tool/action correctness;
- deterministic business postcondition;
- human rubric for subjective quality;
- pairwise comparison when absolute scoring is unreliable.

Keep offline eval separate from production outcome metrics. An eval can show model behavior improved while real user outcomes stayed flat or worsened.

Do not tune on the entire held-out regression set until it stops being independent evidence. Preserve a stable core set plus rotating/challenge cases.

## Observability and privacy

Capture enough evidence to diagnose AI behavior without turning telemetry into a secret warehouse.

Useful metadata can include:

- request/workflow id;
- model/config/prompt version;
- latency/token/cost counters;
- retrieval source ids, not raw sensitive documents when unnecessary;
- tool names/statuses;
- structured validation failures;
- fallback path;
- evaluation/result class.

Redact or avoid storing credentials, private raw content, full prompts, tool payloads, or model outputs when they contain unnecessary sensitive data.

Separate product analytics from model operational telemetry and from security/audit records; they have different retention and access requirements.

## Rollout and compatibility

Model/prompt/tool changes can alter product behavior without changing application API schemas.

Use controlled rollout when risk warrants it:

- bind cohort to exact model/prompt/config identity;
- monitor primary user outcome plus safety/reliability/cost guardrails;
- keep rollback to previous known-good config when compatible;
- avoid mixing incompatible tool schemas across old/new model configs;
- version durable generated artifacts when later code assumes their semantics.

Do not leave abandoned prompt variants, model flags, duplicate tool schemas, or temporary eval instrumentation without a removal condition.

## Implementation across the stack

Trace the complete slice:

`UI/request -> authorization -> context/retrieval -> model -> validation/tool policy -> domain mutation -> persistence -> visible completion -> telemetry/eval`

Frontend responsibilities may include streaming, cancellation, partial output, citations, uncertainty, retry UI, and draft/confirm boundaries.

Backend responsibilities may include provider adapters, prompt/config versioning, context assembly, schema validation, tool authorization, idempotency, quotas, durable job state, and reconciliation.

Data responsibilities may include retrieval indexes, source freshness, memory provenance, generated-artifact versioning, and deletion/retention.

Release responsibilities may include provider credentials/configuration, quota/capacity, canarying, fallback readiness, and exact model identity verification.

Do not stop at a locally successful model API call when the product contract crosses these boundaries.

## Reporting contract

For material AI product work report:

1. user outcome and model-dependent step;
2. deterministic authority and authorization boundaries;
3. model/prompt/context/tool identities;
4. structured output and validation contract;
5. failure/fallback behavior;
6. latency/cost constraints;
7. eval coverage and exact evidence level;
8. privacy/security implications;
9. rollout/rollback state;
10. residual uncertainty and follow-up measurement.

## Boundaries

- Do not make models authoritative for security, money, destructive state, or invariants that deterministic code can enforce.
- Do not treat prompt text as a substitute for authorization or validation.
- Do not expose unrestricted tools merely because the model supports tool calling.
- Do not claim correctness from a few hand-picked examples.
- Do not persist sensitive prompts/context/traces without a defined product need, access policy, and retention rule.
- Do not assume model/provider upgrades preserve behavior; re-evaluate material changes.
