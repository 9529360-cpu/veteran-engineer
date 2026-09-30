# Mutation Audit Contract

Before repository writes, the full-stack owner should record:

- target mutation operation
- affected path or ref
- engineering reason
- expected validation evidence
- rollback boundary

A mutation is considered ready only when it has a reason and a verification path.

This audit is lightweight and works with PR, CI, and release closure workflows.
