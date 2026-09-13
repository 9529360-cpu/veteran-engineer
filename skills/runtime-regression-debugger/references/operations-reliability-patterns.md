# Operations and reliability patterns

## Contents

- User-visible reliability contract
- Golden signals
- SLI/SLO and error budget
- Trace/log/metric correlation
- Alerting
- Canary and staged rollout
- Feature flags
- Backup and recovery readiness
- Incident handling
- Graceful degradation
- Capacity and load tests
- Reliability investment and bounded chaos
- Mature references

## User-visible reliability contract

Start with the user/operator outcome.

Examples:

- login completes within the expected window;
- message/job submission is not lost or duplicated;
- data written by the user becomes visible with defined consistency;
- updater resolves and installs a valid artifact;
- service restart does not invalidate active sessions unexpectedly.

Do not monitor infrastructure health alone when the real product can be broken while CPU and HTTP 200 rates look normal.

## Golden signals

Google SRE's four golden signals are a strong default for user-facing services:

- latency;
- traffic;
- errors;
- saturation.

Reference:
https://sre.google/sre-book/monitoring-distributed-systems/

Track success and failed latency separately. Add domain signals only when they explain user outcomes: queue age, login success, send success, replica lag, updater adoption, etc.

## SLI/SLO and error budget

Use a measurable success condition for important paths.

Example:

`successful requests completing under 500ms / valid requests`

SLOs help decide whether a release can expose more traffic and whether reliability work should outrank feature work.

Do not create dozens of SLOs that nobody uses. Start with the few user journeys that dominate product value/risk.

## Trace/log/metric correlation

Use consistent semantic names and context propagation.

OpenTelemetry provides common semantic conventions and trace context across service/process boundaries:
https://opentelemetry.io/docs/concepts/semantic-conventions/
https://opentelemetry.io/docs/concepts/context-propagation/

Useful correlation fields include:

- trace/request ID;
- service/component and instance;
- operation/job ID;
- non-sensitive tenant/account key when policy allows;
- deployment/build version;
- dependency and outcome category.

Do not put secrets or PII in baggage; propagated context can cross trust boundaries.

## Alerting

Page humans for actionable user impact or imminent exhaustion, not for every exception.

Good alert questions:

- what user contract is failing;
- how many users/tenants are affected;
- is the condition sustained;
- what operator action can improve it;
- which dashboard/log/trace/runbook provides the first discriminator.

Use tickets/dashboards for non-urgent quality debt rather than waking someone.

## Canary and staged rollout

A canary is useful only if candidate and control can be compared.

Track the candidate separately by build/version/flag cohort. Whole-fleet averages can hide a severe canary defect.

Google SRE's canary guidance explicitly recommends limiting the fraction of the error budget exposed to new code and comparing canary signals against control:
https://sre.google/workbook/canarying-releases/

## Feature flags

Flags separate code deployment from product exposure, but create state that needs ownership.

For each flag define:

- type/purpose: release, experiment, operations kill switch, or permission/entitlement;
- owner;
- safe default per environment and behavior when the flag provider is unavailable;
- cohort/tenant/subject targeting identity;
- compatibility with old schema/API/data;
- observability dimension and exposure audit;
- rollback/disable semantics;
- expiry/removal plan.

Evaluate a flag through one owned abstraction rather than scattering conditionals across unrelated layers. Test important paths in every flag state that can be live during rollout. Remove short-lived release flags after full exposure and stabilization.

OpenFeature provides a vendor-neutral model for typed flag evaluation, evaluation context, providers, and hooks; re-check the current spec when implementing a flag system:
https://openfeature.dev/specification/

Martin Fowler's feature-toggle taxonomy is a useful design reference for distinguishing release, experiment, operations, and permissioning toggles:
https://martinfowler.com/articles/feature-toggles.html

Do not leave permanent flags that make every code path unknowable, and do not put sensitive authorization solely behind a client-side flag.

## Backup and recovery readiness

Treat backup/restore as a product capability for stateful systems.

A useful recovery review asks:

- which data/config/object stores participate in one user-visible state;
- RPO/RTO expectations;
- backup encryption/access/retention;
- whether restore has actually been tested;
- how queues/events/external side effects are reconciled after point-in-time recovery;
- how secrets, sessions, tokens, and deployment metadata are restored or intentionally rotated;
- what black-box user contract proves recovery.

A successful backup job is not evidence that a restore is usable. Test restoration in an isolated environment and keep recovery procedures versioned with the system.

## Incident handling

During an incident:

1. establish exact impact and time boundary;
2. freeze speculative unrelated changes;
3. identify last known good/bad deploy/config/dependency state;
4. preserve logs/traces/runtime evidence;
5. mitigate with the smallest reversible action;
6. distinguish mitigation from root-cause repair;
7. validate recovery from user-facing black-box signals;
8. document the failed mechanism and prevention test.

A rollback that restores symptoms is evidence, not necessarily proof of the root cause when external dependencies also changed.

## Graceful degradation

When a control plane or dependency is unavailable, decide explicitly what continues.

Possible modes:

- fully fail closed for security/billing-critical actions;
- read-only last-known-good configuration;
- queue durable writes for later replay;
- disable only the dependent feature;
- use cached immutable/versioned data;
- reject new work while existing durable jobs continue.

Never invent stale authorization or entitlement decisions merely to appear available.

## Capacity and load tests

Test the real bottleneck and warm/cold regimes separately.

Measure:

- throughput;
- p50/p95/p99 latency;
- error rate;
- queue backlog/age;
- DB connection/lock pressure;
- memory/CPU;
- dependency quota;
- recovery after load stops.

Mature systems such as n8n include explicit throughput harnesses that warm runtime/DB/worker paths before measurement; this is a useful reminder that mixing cold-start and steady-state numbers can mislead. Re-check current source before copying test design:
https://github.com/n8n-io/n8n

## Reliability investment and bounded chaos

Use SLO/error-budget signals, recurring user impact, high-severity failure modes, toil, and recovery weakness to choose reliability work. Prefer eliminating a failure mode or automating recovery over adding another alert for the same manual intervention.

When failure injection is useful, start with a falsifiable steady-state hypothesis. Define blast radius, stop conditions, observation signals, recovery, and responsible operator before injection; start in test/staging or a tiny cohort unless that invalidates the hypothesis. Inject realistic faults such as latency, dependency errors, instance/leader loss, packet loss, resource pressure, stale config, or queue delay. Do not run uncontrolled chaos during an unexplained incident or before recovery is proven. A useful experiment proves the user contract or recovery objective, not merely that an alert fired.

## Mature references

- Google SRE Monitoring: https://sre.google/sre-book/monitoring-distributed-systems/
- Google SRE Canarying Releases: https://sre.google/workbook/canarying-releases/
- OpenTelemetry: https://opentelemetry.io/docs/
- AWS Builders' Library: https://aws.amazon.com/builders-library/
