# Execution Contract

Apply this contract to substantial frontend work.

## Before implementation

1. Establish the requested product surface, primary user goal, and required states.
2. Inspect the existing system before changing it.
3. Decide whether the task is prototype, production, reference-led, or concept-first.
4. Identify the design-system source of truth.
5. Decide what evidence will prove completion: build, tests, screenshots, interaction checks, responsive checks, or direct comparison.
6. For substantial new/redesigned UI without an accepted reference, do not begin deep implementation until a real visual target and compact design contract have been selected under `visual-design-authority.md`.

## During implementation

- Preserve working architecture unless a change is necessary for the requested result.
- Make changes in coherent slices and keep the app runnable.
- Reuse primitives and semantic tokens; do not scatter one-off styling.
- Implement loading, empty, error, disabled, hover, focus, and active states when they are part of the visible workflow.
- Keep visual decoration subordinate to information hierarchy and interaction clarity.
- Do not turn prototype shortcuts into hidden production debt. If a shortcut is intentionally used, identify it.

## Completion evidence

A task is complete only to the level supported by evidence actually gathered.

Prefer this order:
1. syntax/type/build succeeds;
2. relevant tests succeed;
3. primary interaction path works;
4. target viewport renders correctly;
5. responsive viewport renders correctly;
6. reference-led work has a direct visual comparison;
7. remaining deviations are documented.

Never convert an unverified assumption into a completion claim.
