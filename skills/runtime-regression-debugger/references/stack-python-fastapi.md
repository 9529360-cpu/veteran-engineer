# Python and FastAPI backend playbook

## Contents

- Recover Python/runtime/environment truth
- Keep FastAPI boundary semantics explicit
- Use async only where the dependency path supports it
- Manage dependencies and lifespan as owners
- Validate persistence and transaction behavior with real infrastructure
- Bound background work and process assumptions
- Test sync/async paths correctly
- Package and deploy the exact runtime

## Recover Python/runtime/environment truth

Inspect:

- exact Python version and deployment image/runtime;
- `pyproject.toml`, lockfile, environment manager, and application entrypoint;
- FastAPI/Starlette/Pydantic versions;
- ASGI server and worker/process configuration;
- sync versus async DB driver/session ownership;
- migrations and queue/background worker processes;
- repository-native lint/type/test commands.

Do not infer behavior from a globally installed package or a different virtual environment. Run commands in the repository's intended environment.

FastAPI docs: https://fastapi.tiangolo.com/

## Keep FastAPI boundary semantics explicit

Trace protected mutations as:

`request -> dependency/authentication -> object authorization -> input validation -> domain invariant -> transaction -> external/async effect -> response`

Dependency injection is a composition mechanism, not proof of authorization. Ensure authorization is evaluated against the exact resource/action.

Pydantic/schema validation handles structure; domain invariants and concurrent data constraints still belong at the appropriate service/DB boundary.

Return stable error semantics. Avoid exposing exception text, SQL details, secrets, or internal stack traces to clients.

## Use async only where the dependency path supports it

`async def` does not make blocking libraries non-blocking.

Confirm whether DB clients, filesystem calls, external SDKs, crypto/compression, and model inference are sync or async. Blocking work inside the event loop can degrade unrelated requests.

Do not convert an application wholesale to async to solve one slow endpoint. Measure the blocking owner and choose an appropriate async client, thread/process offload, job queue, or architectural boundary.

Bound concurrency against DB pools, downstream quotas, CPU, and memory.

## Manage dependencies and lifespan as owners

Use application lifespan/startup/shutdown boundaries to own long-lived resources such as:

- DB engines/pools;
- Redis/cache clients;
- HTTP clients;
- telemetry exporters;
- model/resource loaders.

Avoid creating expensive clients per request unless their contract requires it. Avoid module-import side effects that make tests, migrations, CLI tools, or worker startup unsafe.

For request-scoped DB sessions or resources, guarantee cleanup on success, exception, and cancellation.

## Validate persistence and transaction behavior with real infrastructure

Mocks cannot prove Postgres isolation, locking, unique constraints, connection pool behavior, or Alembic migrations.

Use real/fidelity infrastructure for:

- concurrent writes;
- serialization/deadlock retry;
- migration upgrade/downgrade where supported;
- old/new schema coexistence;
- async driver transaction behavior;
- query plan/index performance.

Keep ORM unit tests for domain mapping where useful, but do not mock away the failing database mechanism.

## Bound background work and process assumptions

FastAPI in-process background work is not automatically durable across crashes, deploys, or process restarts.

Use it only when losing/repeating the work is acceptable under the product contract. For durable workflows, use a queue/workflow system with explicit job identity, retry, idempotency, and terminal state.

Never rely on process-local memory for cross-worker locks, durable progress, rate limits, or authoritative cache state when multiple processes/instances can exist.

## Test sync/async paths correctly

Exercise the same concurrency style as production when it affects semantics.

FastAPI documents async testing with HTTPX/AnyIO for async test functions; use the repository's established harness and version-specific guidance.

Current reference: https://fastapi.tiangolo.com/advanced/async-tests/

Test:

- auth and negative object/tenant scope;
- validation/domain conflicts;
- DB rollback/retry;
- dependency timeout/cancellation;
- duplicate mutation;
- async DB persistence verified after the request;
- startup/shutdown resource cleanup;
- production ASGI server configuration where relevant.

## Package and deploy the exact runtime

Validate the same dependency lock, Python version, environment variables/config schema, worker command, and container/system packages used in production.

Do not call a Python backend production-ready because `pytest` passes in a developer environment if packaging, migrations, process count, or native dependencies differ materially.
