# Containers and Kubernetes delivery playbook

## Contents

- Build immutable reproducible artifacts
- Separate image build, config, and promotion
- Model startup, readiness, liveness, and shutdown correctly
- Budget resources and overload behavior
- Roll out with compatibility and observable gates
- Handle jobs, migrations, and one-off work safely
- Keep secrets and service identity scoped
- Validate from the client-visible path

## Build immutable reproducible artifacts

For containerized systems:

- build from an exact source/lockfile identity;
- use deterministic/reproducible dependency installs where the ecosystem supports them;
- minimize unnecessary build context and secret exposure;
- keep runtime image contents deliberate;
- record image digest/build identity;
- scan dependencies/images as evidence, then evaluate reachability and risk;
- prefer building once and promoting the same image bytes across environments.

Do not rebuild "the same version" separately for production if artifact identity matters to validation.

## Separate image build, config, and promotion

Distinguish:

- immutable image/artifact;
- environment configuration;
- secret material;
- feature exposure;
- deployment manifest;
- mutable traffic/promotion state.

A config-only change can still be production code. Validate it with the same ownership and rollback discipline when it can alter security, routing, data, or external behavior.

## Model startup, readiness, liveness, and shutdown correctly

Use probes for their intended meanings:

- startup: application has initialized enough for normal health checking;
- readiness: this instance should receive traffic/work now;
- liveness: this process is unrecoverably unhealthy and restart may help.

Do not make liveness depend on every downstream dependency; a dependency outage can otherwise restart healthy instances and amplify the incident.

During shutdown, become unready/stop claiming work before final process termination, then drain/cancel within the configured grace period.

Current Kubernetes probe docs: https://kubernetes.io/docs/concepts/workloads/pods/pod-lifecycle/#container-probes
https://kubernetes.io/docs/concepts/workloads/pods/probes/

## Budget resources and overload behavior

Set requests/limits/autoscaling from measured workload, not copied defaults.

Observe:

- CPU throttling;
- memory working set/OOM kills;
- request concurrency;
- queue age;
- DB/dependency saturation;
- startup time;
- node/pod scheduling constraints.

Autoscaling cannot compensate for a saturated shared DB or third-party quota indefinitely. Bound per-instance concurrency and enforce backpressure at the real bottleneck.

Test behavior when resources are constrained rather than assuming the orchestrator will make overload safe.

## Roll out with compatibility and observable gates

Before deployment establish:

- source/image digest;
- schema/config prerequisites;
- old/new coexistence;
- readiness signal;
- user-facing SLI/canary metric;
- rollout pause/abort threshold;
- previous stable image/config;
- rollback constraints.

A Deployment reports rollout state, but platform rollout success is not the same as user-visible correctness. Verify from the same ingress/API/client path real users use.

For high-risk changes, compare candidate versus control cohorts instead of fleet-wide averages.

## Handle jobs, migrations, and one-off work safely

Do not hide destructive or long-running data migration inside application startup for every replica.

Use an explicit migration/job owner when work must run once/logically once, be resumed, or be observed.

For Kubernetes Jobs/CronJobs or external job systems define:

- idempotency;
- concurrency policy;
- retry/backoff;
- timeout/deadline;
- resource limits;
- terminal state and operator evidence;
- tenant/data authorization where applicable.

Ensure app rollout does not race ahead of prerequisite schema/data state.

## Keep secrets and service identity scoped

Do not bake production secrets into images, build layers, logs, command-line arguments, or public config.

Use the platform/organization's approved workload identity and secret mechanism. Scope service accounts/RBAC/network access to required capabilities.

Treat pod-to-service authentication and authorization as separate from network reachability.

## Validate from the client-visible path

Use layered evidence:

1. manifest/IaC validation and diff/plan;
2. image/package smoke test;
3. startup/readiness/shutdown test;
4. integration with real dependencies where semantics matter;
5. rollout/canary observation;
6. ingress/client-visible functional verification;
7. rollback exercise for high-risk delivery paths.

Do not claim production success from `kubectl rollout status` alone.

## Mature references

- Kubernetes probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- Kubernetes Jobs: https://kubernetes.io/docs/concepts/workloads/controllers/job/
- Google SRE Workbook, canarying releases: https://sre.google/workbook/canarying-releases/
