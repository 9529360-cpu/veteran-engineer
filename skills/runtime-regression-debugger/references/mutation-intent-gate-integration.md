# Mutation Gate Integration

The mutation intent gate should run before:

- creating repository files
- updating existing implementation files
- moving refs or branches
- preparing automated fixes

It does not replace tests, CI, reviews, or release checks. It prevents avoidable unsafe writes before those stages.
