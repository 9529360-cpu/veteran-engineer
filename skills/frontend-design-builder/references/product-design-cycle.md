# Product Design Cycle

Use this reference when the task is broader than direct implementation: redesign, UX improvement, product-flow work, exploratory design, audit-driven improvement, or a new product surface without an accepted visual target.

The goal is a lightweight evidence loop, not ceremony.

## Choose the entry point

Start at the earliest phase that can still change the outcome:

- **Existing flow needs critique or redesign** → audit the current state first.
- **Problem is unclear or user pain needs grounding** → research before designing.
- **Problem is clear but visual/interaction direction is unresolved** → explore concepts.
- **Accepted visual target already exists** → skip exploration and go directly to implementation.
- **Design system/library work** → use the Figma/design-system workflow rather than generic ideation.
- **Tiny local change** → do not force the full cycle.

## Minimum brief

Before deep design work, establish only:

- the product/surface;
- the primary user and intended outcome;
- hard constraints that materially change the solution;
- prototype versus production intent.

Infer these from the prompt and repository when possible. Ask only when the target or intended outcome is genuinely missing.

## 1. Audit current reality

For redesigns or UX reviews, inspect the real experience before proposing changes.

Prefer a flow-level audit over isolated aesthetic commentary:

1. identify the task/journey;
2. walk the actual flow;
3. capture stable visual states when tools allow;
4. tie findings to specific states or steps;
5. separate visible evidence from inference;
6. call out accessibility risks that need interaction or assistive-technology verification.

Inspect:

- clarity of next action;
- information hierarchy;
- navigation and orientation;
- feedback and system status;
- loading/empty/error/recovery states;
- form validation;
- keyboard/focus behavior;
- responsive pressure;
- trust, permissions, billing, or destructive-action friction when relevant.

Do not redesign from memory when the existing product can be inspected.

## 2. Research only when it can change the design

Run source-grounded UX research when the problem itself is uncertain or external patterns materially matter.

Useful sources may include:

- support/community complaints;
- GitHub issues/discussions;
- reviews/forums;
- internal tickets/notes when authorized;
- Mobbin-style pattern libraries;
- competitor/product flows.

Separate:

- observed evidence;
- inferred cause;
- frequency signal;
- severity;
- confidence.

Do not mistake one loud anecdote for a common problem. Cluster recurring friction and tell a product story instead of dumping complaints.

## 3. Explore distinct directions

When the visual or interaction direction is unresolved, explore meaningfully different concepts before deep implementation. For substantial visual work, read `visual-design-authority.md`: the concept phase is a blocking design gate, not optional brainstorming.

Different directions should vary at least one of:

- information architecture;
- interaction model;
- hierarchy;
- density;
- navigation model;
- task framing;
- content emphasis.

Do not present three recolors of the same layout as three concepts.

When the user explicitly asks for alternatives, default to three distinct directions. If the user did not ask for a review gate and one direction is clearly supported by constraints/evidence, choose it and proceed. Ask for a decision only when the fork materially changes product semantics, scope, or irreversible design-system direction.

Generated concepts are proposals until selected or adopted.

When Figma, image generation, or another capable visual provider exists, materialize the competing directions visually. Text-only descriptions are insufficient for a visual-quality decision when real visual evidence can be produced.

## 4. Lock the active design contract

Before production implementation, record the compact contract:

```text
user_goal:
visual_target:
primary_flow:
required_states:
component_authority:
token_authority:
responsive_strategy:
interaction_constraints:
required_verification:
```

This can live in working notes; do not create bureaucracy for tiny tasks.

Once locked, stop silently changing the product structure during implementation. If new evidence invalidates it, update the contract explicitly.

For substantial new/redesigned surfaces, the contract is not lockable until one active visual target exists and passes the anti-generic rejection test in `visual-design-authority.md`.

## 5. Implement from system primitives

Use the repository's component and token system. For reference-led work, keep the active source visible and compare in coherent slices.

A prototype may use bounded shortcuts for learning. Production work must close those shortcuts or identify them clearly.

## 6. Design QA is a blocking evidence step

For substantial visual work, compare the implementation against the active design target at the same state and viewport.

Normalize before judging:

- viewport and breakpoint;
- theme/mode;
- auth/data state;
- interaction state;
- crop and device frame;
- image density/scale when material.

Use both:

- full-view comparison for composition/hierarchy;
- focused comparison for typography, icons, assets, dense controls, and exact spacing when needed.

Classify findings:

- **P0** — broken core task, severe accessibility failure, or unusable layout.
- **P1** — major visual/interaction mismatch.
- **P2** — noticeable fidelity/responsive/state drift.
- **P3** — minor polish.

Do not hand off substantial reference-led work with actionable P0/P1/P2 issues when the environment allows them to be fixed. P3 can remain as follow-up polish.

## 7. Handoff with evidence

Report:

- what changed;
- which source was the active design authority;
- which states/viewports were verified;
- what evidence was captured;
- intentional deviations;
- unresolved gaps and why.

A build result is not a design result. Completion language must match the evidence gathered.
