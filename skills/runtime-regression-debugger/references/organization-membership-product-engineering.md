# Organization and Membership Lifecycle Product Engineering

Use this reference when a product has organizations, workspaces, tenants, teams, guests, invitations, roles, owner transfer, managed directory provisioning, or member offboarding.

The product contract is:

`verified identity -> organization scope -> invitation/provisioning -> membership state -> role/policy -> resource access -> change/removal -> session/cache/job convergence -> ownership recovery`

Authentication proves who the principal is. Membership proves whether that principal currently belongs to a specific organization. Authorization proves what the current membership may do to a specific resource. Keep those authorities separate.

For object/action authorization, tenant isolation, sessions, secrets, and audit fundamentals, also read `security-multitenancy-patterns.md`.

## Separate identity, organization, membership, and policy

Name the owner of each fact:

- **Identity authority** owns the person, service account, or machine principal independent of tenant membership.
- **Organization/workspace authority** owns tenant existence, status, domains, ownership invariants, and organization-level policy bindings.
- **Membership authority** owns the tenant-scoped relationship and lifecycle state.
- **Role/policy authority** maps active membership context to allowed actions.
- **Directory/provisioning authority** owns externally managed inputs such as SCIM users/groups when the tenant enables them.
- **Resource-domain authority** owns transfer, archive, retention, and orphan behavior for resources created by a departing member.

Do not use email address, UI-selected workspace, cached role label, invitation token, IdP group name, or an old session claim as the durable membership authority.

## Membership identity and state

Use stable `tenant + principal` identity rather than mutable email/display name.

Model materially different states explicitly, for example:

- invited;
- active;
- suspended;
- guest with expiry;
- managed/provisioning-pending;
- removed/deprovisioned;
- provisioning-error or reconciliation-required when external state is ambiguous.

Do not treat deletion of one row as enough when sessions, caches, jobs, resources, and external directory state can outlive it.

Carry a membership or authorization generation/version when stale state can survive a role or membership change.

## Invitations are scoped capabilities

An invitation should have a stable tenant-scoped identity and explicit generation/version.

Define:

- intended recipient binding and identity verification;
- tenant/workspace scope;
- proposed role/team/guest policy;
- inviter authority at creation;
- expiry;
- revocation/replacement;
- resend behavior;
- single-use or repeat-accept semantics;
- existing-account versus new-account behavior;
- audit and redaction.

Acceptance must re-check current tenant status, invitation generation, current inviter/policy authority where relevant, existing membership, and current role constraints. A validly signed but revoked or stale invitation must not recreate removed access.

Do not log raw invitation tokens.

## Multi-organization identity

A user account may belong to multiple organizations with different roles.

- Keep tenant selection separate from identity authentication.
- Re-authorize the selected tenant on every trusted request boundary.
- Namespace caches, local state, object lookups, jobs, exports, and provider credentials by verified tenant.
- Removing a user from Tenant A must not terminate unrelated Tenant B access unless the product explicitly closes the whole identity.
- Switching workspaces must not carry stale resource ids, role caches, filters, or pending mutations across tenant boundaries.

## Role and policy changes

Treat role changes as versioned security-sensitive transitions.

- Authorize who may grant/revoke each role.
- Prevent privilege escalation through client-supplied role names or stale role-edit forms.
- Re-check invariants such as protected system roles, last owner, or domain-managed roles.
- Invalidate authorization caches and refresh/revoke affected sessions/tokens as required by the security model.
- Re-authorize queued/background work before privileged effects.
- Audit actor, target membership, tenant, old/new policy state, result, time, and correlation identity.

A successful role-update API call is not complete until user-visible and enforcement projections converge.

## Suspension and removal

Define whether suspension blocks login, existing sessions, API tokens, background jobs, shared links, service credentials, notifications, and resource mutations.

For removal/offboarding:

`authorize removal -> mark membership generation/state -> stop new privileged work -> revoke/refresh sessions and caches -> re-authorize pending jobs -> transfer/orphan resources -> reconcile external directory -> visible completion`

Stale workers must not restore membership, recreate role grants, or perform privileged effects after removal.

If removal is asynchronous, expose a truthful pending/deprovisioning state instead of reporting completion while durable access paths remain active.

## Ownership transfer and the last-owner invariant

Products with organization owners need an explicit last-owner rule.

Prevent states where:

- the only recoverable owner removes themselves;
- SCIM deprovisions the final owner without a recovery path;
- ownership transfer succeeds in one subsystem but fails in another;
- a suspended/removed owner remains the only principal allowed to administer the tenant.

A transfer should identify current owner authority, successor identity/membership, effective time, and required resource/control-plane handoffs.

Use a recovery/admin process only when the product explicitly owns one; do not silently promote an arbitrary member.

## Resource ownership during offboarding

Member removal can affect projects, documents, automation, API keys, dashboards, scheduled jobs, repositories, private drafts, integrations, or other domain resources.

Each resource domain should define one of:

- transfer to another authorized member/team;
- convert from personal to organization ownership;
- retain under the organization with restricted administration;
- archive/quarantine pending recovery;
- delete only under an explicit product/data-lifecycle contract.

Do not silently reassign cross-tenant, and do not make entitlement/membership removal an implicit data-deletion mechanism.

## Guests and temporary access

Guest access should carry explicit scope and expiry rather than relying on a cleanup script that may never run.

Define invitation constraints, accessible resource set, role ceiling, expiry timezone/instant, extension authority, session convergence after expiry, and notification behavior.

Expiry and extension must be idempotent and generation-aware so a delayed expiry worker cannot revoke a legitimately extended guest.

## SCIM, IdP groups, and managed membership

External directory state is another authority boundary, not a reason to bypass internal invariants.

For SCIM/group sync define:

- connection/tenant scope;
- stable external user/group ids;
- mapping to internal principal and membership identity;
- group-to-team/role mapping version;
- source precedence between manual and managed memberships/roles;
- create/update/suspend/deprovision semantics;
- duplicate/out-of-order/replayed events;
- reactivation;
- missing-group or mapping-change behavior;
- partial failure and reconciliation.

A directory deprovision must still honor last-owner, resource-transfer, audit, session/cache revocation, and cross-tenant isolation rules.

If a directory call times out or sync is incomplete, keep reconciliation-required state explicit rather than guessing that offboarding succeeded.

## Session, cache, and async convergence

Authorization can remain stale after the membership row changes.

Close all relevant projections:

- access/refresh tokens and server sessions;
- browser/mobile/desktop local caches;
- API gateway or policy caches;
- background jobs and queues;
- websocket/realtime subscriptions;
- search/read-model projections;
- signed URLs/capabilities with material remaining lifetime;
- integration credentials or service-account bindings.

For high-risk effects, re-read current membership/policy at the trusted effect boundary. A job created while the actor was an admin is not forever authorized.

## Organization deletion and closure

Organization deletion is broader than member removal.

Coordinate membership freeze, owner/admin confirmation, exports if required, integrations/credentials, billing/entitlements, jobs, resources, retention/deletion, audit evidence, backups, and external directory/provider cleanup.

Use `privacy-data-lifecycle-engineering.md` for personal-data/export/deletion propagation and `subscription-billing-entitlements-product-engineering.md` when billing access must terminate independently.

## Observability

Correlate transitions by stable ids:

`actor -> tenant -> principal -> invitation/provisioning request -> membership generation -> role/policy generation -> session/job/resource effects`

Track invite acceptance/revocation conflicts, membership propagation latency, stale-session/job authorization denials, provisioning lag/drift, duplicate external identities, group-mapping changes, guest expiry backlog, resource-transfer failures, and last-owner protection events.

Keep invitation secrets, auth tokens, directory credentials, and unnecessary personal attributes out of logs and support bundles.

## Mixed versions and migrations

- Evolve role/membership schemas additively or with explicit compatibility windows.
- Assume old sessions/clients/jobs can carry older membership generations.
- Preserve legacy role identifiers until all readers and queued work migrate.
- During IdP/SCIM migration, preserve stable internal identity/membership and reconcile old/new directory sources explicitly.
- A software rollback does not undo invitations already accepted, sessions already revoked, external deprovisioning already issued, or resources already transferred.

## Validation shape

High-value cases include:

- duplicate invitation acceptance;
- revoked and expired invitation;
- cross-tenant invitation/token use;
- role downgrade while an old session is active;
- member removal while a privileged job is queued;
- last-owner self-removal or SCIM deprovision;
- resource transfer failure during offboarding;
- guest expiry racing with extension;
- out-of-order SCIM update/deprovision;
- SCIM reactivation after removal;
- group-to-role mapping change;
- identity belonging to two organizations with one membership removed;
- stale realtime subscription after role change.

The strongest oracle is not “membership row updated.” It is that identity, membership, role policy, active sessions/caches/jobs, external directory state, and resource ownership all converge to the intended tenant-scoped result.

## Common failed approaches

Avoid treating authentication as membership; authorizing by workspace id supplied by the client; encoding a role forever in a long-lived token; accepting a revoked invite because its signature remains valid; deleting membership without fencing old jobs; letting SCIM bypass last-owner/resource-transfer rules; using email as membership identity; silently promoting another member when the last owner leaves; deleting user-owned data implicitly on role downgrade/removal; or assuming webhook/directory delivery order is authoritative.
