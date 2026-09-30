# Mutation Intent Gate

Purpose: prevent unsafe repository writes before they reach the GitHub control plane.

Checks:

- Every mutation has an engineering reason.
- Temporary probes and no-op artifacts are blocked.
- Only recognized repository mutation operations are accepted.
- Write actions should be tied to a declared implementation goal.

The gate is a reliability layer, not a replacement for review or CI.
