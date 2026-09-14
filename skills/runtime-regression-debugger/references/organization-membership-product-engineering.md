# Organization and Membership Lifecycle Product Engineering

Use this when a product has organizations, workspaces, tenants, teams, guests, invitations, roles, owner transfer, managed directory provisioning, or member offboarding.

The contract is:

`verified identity -> tenant scope -> invitation/provisioning -> membership state -> role/policy -> resource access -> change/removal -> session/cache/job convergence -> ownership recovery`

Authentication proves the principal. Membership proves whether that principal currently belongs to a tenant. Authorization proves what the current membership may do to a resource. Keep those authorities separate. For general request/object authorization, tenant isolation, sessions, secrets, and audit boundaries, also use `security-multitenancy-patterns.md`.

## Keep tenant authority explicit

Recover distinct owners for identity, organization/workspace state, tenant-scoped membership lifecycle, role/policy, externally managed directory inputs, and resource transfer/orphan behavior. Do not use email, a UI-selected workspace, cached role labels, invitation tokens, IdP group names, or old session claims as durable membership truth.

Use stable `tenant + principal` membership identity. Model materially different states such as invited, active, suspended, guest-with-expiry, managed/provisioning-pending, removed/deprovisioned, and reconciliation-required when behavior differs. Carry a membership/authorization generation when stale state can survive role or membership changes.

## Invitations are scoped capabilities

An invitation needs stable tenant-scoped identity plus generation/version, intended-recipient binding, proposed tenant/role/team/guest scope, expiry, revoke/replace semantics, and resend/accept rules.

Acceptance must re-check current tenant status, invitation generation, existing membership, role constraints, and current inviter/policy authority where relevant. A still-valid signature must not revive a revoked/stale invitation or recreate removed access. Do not log raw invitation tokens.

## Membership and role changes must fence stale access

Role changes, suspension, and removal are security-sensitive transitions. Authorize the actor and exact tenant/target/role change; enforce protected-role and last-owner invariants; invalidate authorization projections; refresh/revoke sessions/tokens where required; and re-authorize queued/background effects before they execute.

For removal/offboarding, a useful sequence is:

`authorize -> advance membership generation/state -> stop new privileged work -> converge sessions/caches/jobs -> transfer/orphan resources -> reconcile external directory -> visible completion`

A stale worker must not restore membership, recreate a role grant, or perform a privileged effect after removal. If convergence is asynchronous, expose a truthful pending/deprovisioning state rather than reporting completion early.

Multi-organization identities must remain isolated: removing Tenant A must not terminate unrelated Tenant B access; workspace switches must not carry stale resource ids, role caches, pending mutations, provider credentials, or local state across tenant boundaries.

## Preserve the last-owner and resource-ownership invariants

Do not allow the only recoverable owner to remove themselves, SCIM to deprovision the final owner without recovery, or ownership transfer to complete in only one subsystem. Prove current owner authority, successor identity/membership, and required tenant/control-plane handoffs before effective transfer. Never silently promote an arbitrary member.

Member offboarding must not implicitly delete product data. Each resource domain should own its transfer/organization-conversion/retain/archive/quarantine/delete behavior. Cross-tenant reassignment must fail closed. Data deletion, when intended, belongs to an explicit data-lifecycle contract.

Guests and temporary access need explicit scope, expiry instant, role ceiling, extension authority, and session convergence. Expiry/extension must be generation-aware so delayed expiry work cannot revoke a legitimate extension.

## Directory/SCIM inputs are evidence, not bypass authority

For managed membership keep stable external user/group identity, tenant-scoped connection identity, internal principal/membership mapping, versioned group-to-role/team mapping, manual-vs-managed source precedence, deprovision/reactivation semantics, replay/out-of-order handling, and reconciliation.

A directory deprovision must still obey last-owner, resource-transfer, audit, session/cache revocation, and tenant-isolation rules. If sync is partial or ambiguous, preserve reconciliation-required state rather than pretending offboarding succeeded.

## Close projections and mixed-version paths

Membership changes can remain stale in sessions/tokens, client caches, gateways/policy caches, jobs/queues, realtime subscriptions, search/read models, signed capabilities, and integration/service credentials. For high-risk effects, re-read current membership/policy at the trusted effect boundary; work authorized when queued is not forever authorized.

Assume old clients, jobs, token claims, role identifiers, membership schemas, and old/new directory sources can coexist. Evolve contracts additively or through explicit compatibility windows and preserve stable internal membership identity during IdP/SCIM migration.

Software rollback does not undo an invitation already accepted, a session already revoked, an external deprovision already issued, or a resource already transferred. Separate code rollback from domain reconciliation.

## Validation and observability

High-value cases include duplicate/revoked/expired invite acceptance; cross-tenant invite use; role downgrade with an old session; removal with a privileged job queued; last-owner removal/SCIM deprovision; resource-transfer failure; guest expiry racing extension; out-of-order deprovision/reactivation; group-mapping change; multi-org isolation; and stale realtime authorization.

The useful oracle is not “membership row updated.” Identity, tenant membership, role policy, active sessions/caches/jobs, external directory state, and resource ownership must converge to the intended scoped result.

Correlate actor, tenant, principal, invite/provision request, membership generation, role/policy generation, session/job/resource effects, and reconciliation outcome. Track propagation latency, stale-access denials, provisioning drift, guest expiry backlog, resource-transfer failure, and last-owner protection. Keep invitation/auth/directory secrets and unnecessary personal attributes out of logs.
