# Python Agent System Engineering

Use this reference for Python-based Agent systems: tool-using task agents, LangChain/LangGraph/AutoGen-style applications, ReAct loops, multi-agent workflows, or custom agent runtimes.

This is an implementation discipline, not a framework preference. Preserve the repository's existing stack when it is viable.

## 1. Design before code

Before substantial implementation, write a compact design contract covering:

- requested outcome and non-goals;
- modules/files that own the change;
- key state structures and their lifecycle;
- tool/model/external interfaces;
- loop/termination behavior;
- evidence that will prove completion.

Keep this to roughly 3-6 sentences or an equally compact project-local note unless the problem genuinely needs a deeper design.

If the user explicitly asks to review the design before coding, stop at that boundary. Otherwise, once implementation is already authorized, establish the design contract first and continue in the same execution cycle; do not invent a new approval gate.

## 2. Split by real ownership

Do not build a large agent feature as one opaque loop. Separate concerns when they have different invariants or failure modes, commonly:

- tool registry/invocation;
- state/session/checkpoint ownership;
- prompt/context construction;
- planner/router/policy;
- execution loop;
- model/provider adapter;
- persistence/event log;
- evaluation/validation.

Each module should have an explicit interface to the next owner. Avoid hidden coupling through module globals, mutable singletons, or prompt text that silently acts as state.

## 3. Make state explicit

Represent durable and per-run state deliberately. For every important field, know:

- owner/source of truth;
- creation point;
- mutation authority;
- serialization/checkpoint behavior;
- lifetime and terminal cleanup;
- recovery behavior after restart/retry.

Do not rely on "the model will remember" or on implicit prior-turn assumptions. For multi-agent work, make handoff payloads explicit and versionable when they cross a durable/process boundary.

## 4. Treat tool contracts as code contracts

Tool/function-calling arguments must match the real definition exactly.

Before shipping a tool path:

1. inspect the actual tool name, input fields, types, required/optional semantics, and result shape;
2. validate structured arguments before invocation;
3. reject or repair malformed model output explicitly;
4. classify tool errors separately from model reasoning errors;
5. preserve timeout-after-commit ambiguity when a tool can have side effects;
6. keep idempotency/replay behavior explicit for retryable side effects.

Do not fabricate parameters from memory when a live schema or typed interface is available.

## 5. Bound every agent loop

Every iterative agent loop needs observable stop conditions.

Define at least:

- goal-satisfied condition;
- fatal/non-retryable failure condition;
- user/cancellation condition when applicable;
- maximum iteration/step budget;
- context/token/resource budget when the runtime exposes one.

A ReAct/AutoGPT-style loop without a bounded exit is incomplete. Repeated identical action/thought/error cycles should trigger loop-break or escalation behavior instead of consuming the full budget blindly.

## 6. Engineer external calls for failure

For model APIs, tools, files, queues, databases, HTTP services, and subprocesses, define the relevant:

- timeout;
- retry eligibility and cap;
- backoff/jitter when appropriate;
- cancellation behavior;
- fallback/degraded path;
- error classification and observability.

Never use a bare `except` to erase failures. Catch the narrowest practical exception, preserve causal context, and expose terminal failures to the state machine.

## 7. Keep Python contracts readable

For production code:

- use type hints on public/module-boundary functions and important state models;
- use docstrings where inputs, outputs, side effects, invariants, or exceptions are not obvious;
- prefer typed/dataclass/Pydantic-style state models when they improve validation and evolution;
- make dependency injection explicit for model/tool/provider adapters that need substitution in tests;
- avoid hidden process-wide mutable state.

Do not add typing ceremony where it provides no decision or safety value.

## 8. Validate the failure edges

After implementation, actively test or reason through the edges most likely to break an Agent system:

- empty or underspecified input;
- malformed structured model output;
- unknown/missing tool;
- tool result with unexpected shape;
- timeout before commit versus timeout after side effect;
- retry exhaustion;
- duplicate/replayed invocation;
- state serialization/restart;
- concurrent or multi-agent writes;
- loop exhaustion;
- context growth/truncation;
- provider/model error or rate limit.

Prefer executable tests for deterministic contracts. Use scenario/eval fixtures for model-dependent behavior and label them as probabilistic evidence.

## 9. Report evidence, not confidence

For substantial work, report:

- design/owner changes;
- state and tool-contract implications;
- loop/failure handling;
- exact validation run;
- residual unverified model behavior.

Compilation or a happy-path demo is not enough to call an Agent system reliable.
