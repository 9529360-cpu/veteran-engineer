# Privileged Operator and Support Product Engineering

Use this when employees, administrators, support engineers, incident responders, or other operators can inspect or mutate customer accounts, tenants, resources, credentials, billing/security state, or production controls.

`verified operator -> explicit purpose -> policy/approval -> scoped temporary capability -> attributable action -> expiry/revocation -> audit/recovery`

Privileged support is not ordinary RBAC: it crosses from service-operator authority into customer-controlled state. For ordinary request/object authorization use `security-multitenancy-patterns.md`; for privacy propagation use `privacy-data-lifecycle-engineering.md`.

## Keep operator and customer identity distinct

Never collapse the operator principal into the customer principal. Preserve separate authorities for workforce/operator identity, customer subject/tenant identity, privileged policy, approval, issued grant/session, and audit attribution.

Every privileged effect must remain attributable to the real operator and affected subject. Impersonation may borrow customer-like capabilities, but it must not become an indistinguishable customer session or emit audit claiming the customer acted.

## Grants are purpose-bound, scoped, and temporary

Bind access to the narrowest practical tuple:

`operator -> purpose/case/incident -> tenant/account/object -> allowed action -> bounded time`

Step-up authentication, grant issuance, absolute/idle expiry, renewal, and revocation belong to explicit policy. Long-lived internal-group membership is not itself a permanent customer-data capability.

Separate view-only diagnostics, assisted actions, impersonation/delegation, and direct privileged mutation. Prefer the least powerful mode that completes the support task. Read-only mode must not silently reach mutation endpoints, and impersonation must not imply internal-only administration authority.

## Approval and break-glass are state transitions

High-risk actions may require independent approval, quorum, customer confirmation, or incident/security authority according to product policy. When requester/approver separation is required, the requester cannot approve their own action.

Break-glass does not mean “skip authorization.” It is a separate, tightly bounded path with stronger proof, explicit emergency purpose, narrow scope, short expiry, immediate audit/alerting, and review. If required approval cannot be satisfied safely, fail closed.

## Scope exact actions at a trusted boundary

Authorize the exact operator, grant, purpose, tenant/account, object, and action server-side. Editable UI fields, hidden controls, or being in an internal admin group are not scope authority.

Cross-tenant switching is a real boundary: cached state, tabs, realtime subscriptions, downloads, jobs, and search results must not retain the prior tenant. Multiple support tabs must not share one mutable global subject scope accidentally.

Sensitive identity/security, destructive, monetary, entitlement, export, and production-control operations stay under their normal authoritative owners. Support tooling requests those transitions; it must not become a shadow source of truth.

## Impersonation remains visibly and technically honest

Impersonation needs explicit entry/exit, persistent operator-facing context, independent expiry/revocation, and server-side retention of both operator and subject identity. Do not reuse customer secrets, recovery factors, or customer session tokens to manufacture support access.

Credential/MFA changes, ownership transfer, exports, or other high-risk effects during impersonation require whatever separate authorization/approval those effects normally demand.

## Async work and retries keep the same authority

Queued exports, repairs, reprocessing, notifications, restores, or entitlement work carry stable request identity plus operator, grant, subject/tenant, and purpose identity.

Define what happens when the grant expires or is revoked before execution. “Was authorized when queued” is not automatically authorization to execute later. Re-check current authority when the product contract requires it.

For non-idempotent effects, timeout-after-commit is an unknown outcome. Reconcile before retry so support tooling cannot duplicate money movement, credential changes, destructive effects, or messages.

## Revocation must converge beyond the UI

Revocation covers grants, support sessions/tokens, impersonated sessions, browser/tab state, temporary credentials, realtime subscriptions, and queued work as applicable. A cryptographically valid stale token is not sufficient authority after policy, employment, incident, customer-consent, or grant state changes.

Do not ship a scoped new console while an ambient legacy admin endpoint remains an indefinite bypass. Legacy paths need bounded compatibility and an explicit removal trigger.

## Protect secrets and audit the lifecycle

Purpose-built support projections should minimize/redact passwords, API/session tokens, recovery codes, private keys, reusable signed URLs, payment details, and unrelated sensitive data. Export/download/clipboard/bulk-search surfaces need explicit policy and audit because they can move data outside the normal UI boundary.

Audit request, approval/denial, grant issue/renew/revoke/expire, impersonation start/stop, subject/tenant scope entry, sensitive view/export, mutation attempt/result, break-glass, queued work, and review when required. Preserve operator, subject, tenant, grant, purpose, action, target, result, request/correlation and approval metadata without logging secrets.

Customer consent, notification, access history, and enterprise restrictions are product/policy decisions, but each privileged mode must define them explicitly rather than silently mixing ordinary support and security-investigation semantics.

## Compatibility, observability, and validation

Track grant issue/denial/expiry/revocation, break-glass, impersonation, cross-tenant activity, sensitive exports/high-risk effects, failed step-up/approval, stale access rejection, and queued work after access changes without sensitive payloads.

When migrating legacy support paths, preserve or strengthen attribution and scope during old/new overlap. Software rollback does not resurrect revoked grants or undo completed privileged/customer effects.

Use tests that can falsify the changed mechanism: missing purpose, step-up required, expired/revoked grant reuse, cross-tenant scope, read-only mutation, impersonation attribution, requester=approver, break-glass without emergency authority, queued work after revocation, duplicate high-risk retry after ambiguous outcome, sensitive export scope, operator revocation during an active session, and legacy bypass.

The useful oracle is not “the admin UI showed the right button.” Operator identity, subject scope, purpose, approval, effect authority, revocation, and audit evidence must agree on the same exact privileged action, and stale privilege must not survive behind another path.
