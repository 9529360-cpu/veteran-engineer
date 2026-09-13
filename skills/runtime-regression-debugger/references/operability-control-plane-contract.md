# Operability and Control-Plane Contract

Use this for changes that add a long-lived runtime mechanism, external dependency, background process, release path, or failure mode that an operator may need to understand or control.

## Operability is part of correctness

A feature is not production-ready merely because the happy path works. For a consequential mechanism define how operators can tell whether it is healthy, how failure is bounded, and how the mechanism can be stopped or degraded safely.

## Define observable success and failure

Prefer direct user/operator outcomes over infrastructure proxies.

For the changed path identify:

- success signal;
- failure signal;
- saturation/backlog signal when applicable;
- candidate/build/cohort dimension;
- correlation identity such as request/job/operation ID;
- expected normal range or comparison baseline.

Do not add high-cardinality labels blindly. Do not log secrets or sensitive user content to make debugging easier.

## Define the stop mechanism before needing it

A stop control can be:

- feature flag at the authoritative decision point;
- consumer pause;
- read-only mode;
- traffic drain/routing change;
- concurrency/admission reduction;
- provider disable/fallback;
- canary rollback or exposure halt.

The stop mechanism must be narrower than the failure whenever practical. A global shutdown is a poor kill switch for a tenant-scoped defect.

## Define fail behavior

When dependencies or control planes fail, decide explicitly whether the path:

- fails closed;
- serves last-known-good immutable data;
- becomes read-only;
- queues bounded work for replay;
- disables only the affected feature;
- rejects new work while preserving committed state.

Security, billing, authority, and irreversible effects usually require safer defaults than cosmetic or read-only features.

## Bound recovery load

Recovery is traffic. Replays, retries, cache warm-up, backlog drain, failover, and reconciliation can overload the system that just recovered.

Define:

- concurrency/rate cap;
- priority relative to user traffic;
- abort/stop threshold;
- progress signal;
- restart/resume semantics.

## Give the mechanism an owner

Every new long-lived mechanism needs:

- accountable owner;
- observable normal/degraded states;
- runbook or first discriminator;
- capacity bound;
- recovery method;
- safe stop control where appropriate;
- lifecycle/removal condition if temporary.

If nobody can operate the mechanism at 03:00 without the original author, the design is incomplete.

## Validate controls, not only business logic

Where risk warrants it, test that:

- the stop control actually stops the intended scope;
- fail behavior is safe when the control plane itself is unavailable;
- telemetry distinguishes candidate from control;
- degraded mode does not silently violate the user contract;
- re-enabling does not replay work without bounds.

Use `scripts/operability_contract.py` as a planning gate for explicit operability manifests.
