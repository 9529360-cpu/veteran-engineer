# Infrastructure and deployment patterns

## Contents

- Deployment contract
- Build artifact and runtime configuration
- Containers and images
- Health probes
- Graceful shutdown and draining
- Rolling deployment compatibility
- CI/CD identity and environment controls
- Infrastructure changes and drift
- Serverless runtime versioning
- Backup, restore, and disaster recovery
- Mature references

## Deployment contract

Treat deployment as a state transition, not a file-copy command.

A useful contract is:

`exact source -> reproducible artifact -> environment config -> compatible migration -> start -> readiness -> bounded traffic exposure -> public verification -> rollback/recovery`

For each stage define:

- immutable identity or version;
- owner and authorization;
- precondition;
- failure/timeout behavior;
- evidence of success;
- recovery action.

Do not infer production success from a green build job that never exercised the production endpoint or workload.

## Build artifact and runtime configuration

Prefer building an immutable artifact once and promoting that same identity between environments when practical.

Separate:

- application bytes/image;
- runtime configuration;
- secrets;
- database/schema migration;
- mutable feature exposure.

Do not rebuild from the same Git commit independently for validation and production if byte identity matters and promotion can reuse the proven artifact.

Record enough provenance to map:

`source revision -> dependency lock -> build -> artifact digest -> deployment revision -> running instance`

## Containers and images

For containerized systems:

1. use multi-stage builds to keep build tools out of the runtime image;
2. copy only runtime-required files into the final stage;
3. use `.dockerignore` and avoid copying repository secrets/build junk;
4. prefer a non-root runtime user where the application permits it;
5. choose and update base images deliberately;
6. pin or otherwise make base provenance auditable according to repository policy;
7. scan final artifacts/images, not only source manifests;
8. never pass build secrets using Dockerfile `ARG` or `ENV` when they would persist in image history/metadata; use build secret/SSH mounts.

Docker documents multi-stage builds and build-secret mounts as standard patterns:
https://docs.docker.com/build/building/best-practices/
https://docs.docker.com/build/building/secrets/

A smaller image is not automatically a more secure system; runtime privileges, dependencies, patching, and exposed attack surface still matter.

## Health probes

Keep three contracts distinct:

- **startup**: has this process completed initialization enough for normal health checks?
- **readiness**: should this instance receive new traffic/work now?
- **liveness**: is this process wedged such that restart is likely to improve it?

Kubernetes explicitly separates startup, readiness, and liveness probes:
https://kubernetes.io/docs/concepts/workloads/pods/probes/

Do not make liveness depend on every remote dependency. A database or SaaS outage can otherwise trigger a restart storm that amplifies the incident.

Use readiness for temporary inability to serve new work when removing the instance from traffic is appropriate.

## Graceful shutdown and draining

Assume deployments, autoscaling, maintenance, and crashes can replace instances.

A graceful termination path should, where relevant:

1. stop advertising readiness / stop accepting new work;
2. stop acquiring new queue leases/jobs;
3. allow bounded in-flight requests/jobs to finish or checkpoint;
4. release leases/locks safely;
5. flush durable telemetry only within a bounded budget;
6. close DB/network resources;
7. exit before the platform hard-kill deadline.

Do not hold shutdown forever waiting for a dependency. Define what happens to unfinished work and make replay safe.

## Rolling deployment compatibility

During a rolling deployment, old and new instances can run simultaneously.

Therefore validate compatibility for:

- request/response schemas;
- database schema;
- queue/event payloads;
- caches;
- feature-flag state;
- auth/session tokens;
- file/object metadata;
- generated links/callbacks.

Prefer:

`expand -> deploy compatible code -> migrate/backfill -> switch behavior -> verify -> contract`

A migration that only the new binary understands can make rollback unsafe before the rollout is complete.

## CI/CD identity and environment controls

Production deployment credentials are a security boundary.

Prefer short-lived federated credentials such as GitHub Actions OIDC when the target supports them, with trust conditions scoped to the intended repository/workflow/environment. GitHub documents that OIDC can remove long-lived cloud credentials from repository secrets:
https://docs.github.com/en/actions/concepts/security/openid-connect

Use environment protection and deployment concurrency for high-impact targets where appropriate:
https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments

Also:

- set workflow/job permissions to least privilege;
- pin or otherwise govern third-party actions according to supply-chain policy;
- separate PR validation from production deployment credentials;
- do not expose environment secrets before required protection gates;
- ensure only one incompatible production migration/promotion runs at a time.

## Infrastructure changes and drift

Treat infrastructure-as-code as a stateful control plane, not ordinary text configuration. This applies to Terraform/OpenTofu, Pulumi, CloudFormation/CDK, and comparable systems.

Before applying a high-impact change:

- identify current live resources and the authoritative state/backend, not only desired config;
- confirm workspace/stack/account/region and provider/plugin versions;
- refresh or otherwise reconcile live state according to repository policy before trusting a plan;
- inspect the exact plan/diff and classify create/update/replace/destroy/import/adopt/move operations;
- verify state lock/lease ownership and never bypass locking casually;
- treat IAM, network routes/firewalls, DNS, encryption keys, databases, storage, and identity federation as high-blast-radius surfaces;
- preserve data/backup/recovery requirements before replacement or destruction;
- separate intentional drift reconciliation from unrelated application fixes;
- bind approval and apply to the reviewed plan/commit/environment identity when the toolchain supports it.

Use import/adoption and state-move mechanisms deliberately when bringing existing resources under management or renaming ownership. Avoid manual state surgery unless the normal migration mechanism cannot express the required change and recovery is understood.

Treat targeted apply, forced replacement, ignore-change/lifecycle exceptions, and manual console edits as exceptional tools, not normal convergence strategy. Record why the exception is safe and what restores normal declarative ownership.

Do not blindly "apply until green" when the provider reports replacement or deletion of stateful resources. A clean plan after a destructive apply does not prove the product contract or data survived.

## Serverless runtime versioning

Managed/edge runtimes evolve independently of application source.

If the platform exposes compatibility dates, runtime flags, language/runtime versions, or deployment generations, treat them as versioned dependencies. Upgrade them deliberately with contract tests rather than silently following latest behavior.

Cloudflare Workers compatibility dates are one concrete example:
https://developers.cloudflare.com/workers/configuration/compatibility-dates/

Never freeze current provider limits into a long-lived skill or architecture assumption; re-read current limits before implementation or scaling work.

## Backup, restore, and disaster recovery

A backup is not proven until a restore has been tested.

For stateful production systems define:

- what data/config/artifacts are backed up;
- retention and encryption;
- ownership and access controls;
- recovery point objective (RPO) when applicable;
- recovery time objective (RTO) when applicable;
- restore ordering across DB/object store/config/secrets;
- whether queues/events need replay or reconciliation;
- integrity checks after restore;
- how credentials/tokens behave after recovery.

Test restoration into an isolated environment periodically or before relying on a new backup mechanism. A code rollback is not a database restore, and a DB restore can invalidate external side effects that happened after the recovery point; plan reconciliation.

## Mature references

- Docker build best practices: https://docs.docker.com/build/building/best-practices/
- Docker build secrets: https://docs.docker.com/build/building/secrets/
- Kubernetes probes: https://kubernetes.io/docs/concepts/workloads/pods/probes/
- Kubernetes Deployments: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- GitHub Actions deployments: https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments
- GitHub Actions OIDC: https://docs.github.com/en/actions/concepts/security/openid-connect
- Cloudflare Workers compatibility dates: https://developers.cloudflare.com/workers/configuration/compatibility-dates/
- SLSA supply-chain framework: https://slsa.dev/
