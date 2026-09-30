#!/usr/bin/env python3
"""Validate planned repository mutations before write operations.

The gate is intentionally small: it catches unsafe repository writes before they
reach the GitHub control plane.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import PurePosixPath


@dataclass(frozen=True)
class Mutation:
    operation: str
    path: str
    reason: str


FORBIDDEN_PATH_PARTS = {
    ".tmp",
    "no-op",
    "noop",
    "__do_not_create__",
}


ALLOWED_OPERATIONS = {
    "create_file",
    "update_file",
    "delete_file",
    "update_ref",
}


def validate_mutation(mutation: Mutation) -> list[str]:
    errors: list[str] = []

    if mutation.operation not in ALLOWED_OPERATIONS:
        errors.append(f"unsupported operation: {mutation.operation}")

    path = str(PurePosixPath(mutation.path))
    lowered = path.lower()

    if any(part in lowered for part in FORBIDDEN_PATH_PARTS):
        errors.append("mutation path looks like temporary or probe-only content")

    if not mutation.reason.strip():
        errors.append("mutation requires a non-empty engineering reason")

    return errors


def validate_batch(mutations: list[Mutation]) -> list[str]:
    errors: list[str] = []
    for mutation in mutations:
        errors.extend(validate_mutation(mutation))
    return errors


if __name__ == "__main__":
    raise SystemExit(0)
