# Privileged Operator and Support Product Engineering

Use this when employees, administrators, support engineers, incident responders, or other privileged operators can inspect or act on customer accounts, tenants, resources, credentials, billing, security state, or production controls.

The product contract is:

`verified operator -> explicit support/incident purpose -> policy and approval -> scoped temporary capability -> attributable action -> expiry/revocation -> audit/customer visibility/recovery`

This is not ordinary RBAC. Privileged support access crosses a trust boundary from the service operator into customer-controlled state and can bypass normal user paths if it is designed carelessly.

## Contents

- Separate operator identity from customer identity
- Bind access to purpose and scope
- Distinguish view, assist, impersonate, and mutate
- Make grants explicit and temporary
- Design approvals and break-glass paths
- Keep impersonation honest
- Protect secrets and private data
- Control irreversible and high-risk actions
- Preserve tenant and object isolation
- Close async and retry boundaries
- Make revocation converge
- Build complete audit evidence
- Define customer visibility and control
- Design safe operator UX
- Observe abuse and operational drift
- Plan rollout, compatibility, and removal
- Validate adversarially

## Separate operator identity from customer identity

Never collapse the employee/operator principal into the customer principal.

Keep distinct authorities for:

- authenticated operator identity;
- customer/user/tenant subject identity;
- policy deciding which support capabilities are allowed;
- approval or escalation authority;
- issued privileged grant/session;
- audit evidence and immutable attribution.

Every privileged action should be attributable to both the operator and the affected customer scope. If an operator temporarily acts with customer-like capabilities, downstream authorization and audit must still know that the actor is an operator acting on behalf of a subject.

Do not replace the normal user session cookie/token with an indistinguishable support session.

## Bind access to purpose and scope

Require a reason that is useful after the fact, not a free-form string added only for compliance theater.

Useful purpose bindings include:

- support case or incident identifier;
- customer-requested troubleshooting task;
- abuse/security investigation;
- emergency production recovery;
- regulated operational procedure.

Bind the issued grant to the narrowest practical combination of:

`operator -> purpose -> tenant/account -> object set -> allowed actions -> time window`

Do not grant broad cross-tenant search or mutation simply because the operator belongs to an internal admin group.

## Distinguish view, assist, impersonate, and mutate

These are different products with different risk.

- **View-only diagnostics**: inspect redacted state, configuration, logs, or derived support summaries.
- **Assisted action**: prepare a change that the customer confirms or executes.
- **Impersonation/delegation**: act through product flows while preserving operator attribution.
- **Direct privileged mutation**: change authoritative state outside the customer path.

Prefer the lowest privilege mode that can solve the support task.

A read-only support console should not silently inherit mutation endpoints. An impersonation session should not automatically gain internal-only administration APIs.

## Make grants explicit and temporary

Privileged access should be issued, not inferred from long-lived ambient membership.

Define:

- who may request access;
- what policy evaluates the request;
- required step-up authentication;
- approval requirements by risk class;
- grant/session identity;
- exact scope/capabilities;
- absolute expiry and idle expiry where relevant;
- revocation authority;
- renewal rules;
- emergency override rules.

Use bounded grants. Do not rely on the operator remembering to log out of a powerful support mode.

## Design approvals and break-glass paths

Approval is a state transition, not a comment field.

For high-risk actions define whether the system requires:

- independent approver or quorum;
- separation of requester and approver;
- customer confirmation;
- incident commander/security approval;
- delayed execution window;
- reason code and evidence.

Break-glass must not mean "skip authorization". It should use a separate, tightly bounded path with stronger authentication, explicit emergency reason, narrow scope, short expiry, immediate audit/alerting, and mandatory post-event review.

If the product cannot safely perform the action without normal approvals, fail closed rather than silently downgrading to one-person approval.

## Keep impersonation honest

Impersonation is especially dangerous because it can make operator activity look like customer activity.

Require:

- explicit entry and exit from impersonation mode;
- persistent visible indicator to the operator;
- original operator identity preserved server-side;
- subject account/tenant shown prominently;
- capability narrowing relative to the real customer session when appropriate;
- prevention of sensitive identity/security changes unless separately authorized;
- no reuse of customer secrets, recovery factors, or session tokens;
- independent expiry/revocation from the customer's own sessions.

Do not emit audit events that claim the customer performed an action when the actual actor was support staff.

## Protect secrets and private data

Support access is not permission to expose raw secrets.

Prefer purpose-built support projections that redact or transform:

- passwords, API keys, tokens, recovery codes, private keys;
- payment instrument details beyond necessary support display;
- highly sensitive personal data not needed for the case;
- signed URLs and reusable credentials;
- internal security controls that create unnecessary attack leverage.

Downloads, exports, clipboard actions, screenshots, and bulk search need explicit policy because they can move data outside the normal audit boundary.

Use `privacy-data-lifecycle-engineering.md` for minimization, retention, export, deletion, and sensitive-data propagation.

## Control irreversible and high-risk actions

Actions such as these deserve stronger treatment than ordinary support reads:

- disabling MFA or recovery factors;
- changing account ownership or primary contact;
- granting organization admin/owner roles;
- issuing credits/refunds or altering entitlements;
- deleting tenants/data;
- rotating/revealing credentials;
- exporting customer data;
- changing production/security configuration.

Keep monetary value under the payment/ledger authority and security state under the relevant identity/organization authorities. The support tool may request those transitions, but it should not become a shadow source of truth.

For every high-risk action define the normal authority, approval level, idempotency/retry behavior, audit evidence, and recovery or forward-repair path.

## Preserve tenant and object isolation

Privileged tooling still needs exact authorization.

Verify:

`operator O with grant G for purpose P wants action A on subject S / tenant T / resource R`

Do not accept tenant or account scope from an editable UI field without server-side validation against the issued grant.

Cross-tenant switching should create an explicit boundary event. Cached data, browser tabs, realtime subscriptions, downloads, background jobs, and search results must not retain scope from the previous tenant.

## Close async and retry boundaries

Support actions often enqueue work: exports, reprocessing, bulk repair, email delivery, entitlement reconciliation, or data restoration.

Carry operator identity, support grant identity, subject tenant/account, purpose/case, and request identity into async work.

Before execution, re-check the authorization model required by product semantics. Decide whether queued work may continue after grant expiry/revocation; do not let this happen accidentally.

For non-idempotent effects, handle timeout-after-commit and retries without duplicating money movement, credential changes, messages, or destructive operations.

## Make revocation converge

Revoking the UI session is not enough if privileged state survives elsewhere.

Define convergence across:

- access grants and session tokens;
- browser tabs and cached operator state;
- API tokens or temporary credentials;
- queued/background work;
- realtime subscriptions;
- downloaded/exported artifacts when revocation is meaningful and technically possible;
- delegated/impersonated sessions.

When policy, employment status, incident status, or customer consent changes, stale privileged access must not remain valid simply because its token is cryptographically well formed.

## Build complete audit evidence

Audit the full lifecycle, not just successful mutations:

- access requested;
- approved/denied;
- grant issued/renewed/revoked/expired;
- impersonation started/stopped;
- tenant/account/object scope entered;
- sensitive view/export/download;
- mutation attempted/succeeded/failed;
- break-glass invoked;
- approver identity and decision;
- queued work created/completed/cancelled;
- post-event review where required.

Useful audit fields include operator, subject, tenant, grant/session id, purpose/case id, action, target, result, timestamp, correlation/request id, and approval/break-glass metadata.

Do not put secrets or unnecessary sensitive payloads into audit records.

## Define customer visibility and control

Customer notification/consent is a product and policy decision, but it must be explicit.

For each privileged mode decide:

- whether customer consent is required before access;
- whether the customer is notified immediately, later, or not at all under defined exceptions;
- whether customers can see an access history;
- whether enterprise admins can restrict or disable support access;
- how emergency/security exceptions are represented;
- whether revocation requested by the customer is immediate or bounded by an active incident contract.

Do not silently mix "customer-visible support" and "security investigation" policies.

## Design safe operator UX

The operator interface is part of the security boundary.

Use strong visual context for:

- current environment;
- current tenant/account;
- current grant mode and expiry;
- impersonation state;
- read-only versus mutation capability;
- destructive/high-risk actions;
- break-glass state.

Require deliberate confirmation for dangerous cross-tenant or irreversible operations. Prefer typed identifiers or secondary confirmation when a mistaken click could affect the wrong customer.

Do not let multiple customer contexts in tabs inherit one mutable global support scope without independent binding.

## Observe abuse and operational drift

Track without leaking sensitive data:

- privileged grants issued, denied, expired, and revoked;
- break-glass frequency and duration;
- impersonation duration and cross-tenant switching;
- sensitive views/exports and high-risk mutations;
- unusual operator/customer pairings;
- repeated approval overrides or failed step-up authentication;
- stale grants/sessions rejected after policy or employment changes;
- queued privileged work executed after access state changed.

Alerting should be based on meaningful risk and operational baselines, not merely the existence of admin activity.

## Plan rollout, compatibility, and removal

When replacing an older admin path, define:

- how legacy ambient permissions coexist with scoped grants;
- which old endpoints/tools are still reachable and by whom;
- how audit semantics compare across old and new paths;
- how long old support sessions remain valid;
- how operators are migrated without widening privilege;
- the explicit trigger for disabling/removing the legacy path.

Do not ship a safer console while leaving an unaudited legacy endpoint as a permanent bypass.

Rollback of UI/code does not revoke already-issued grants or undo completed privileged mutations. Treat durable/security effects separately from software rollback.

## Validate adversarially

At minimum cover the product-relevant subset of:

- support access without a case/purpose;
- operator without step-up authentication;
- expired or revoked grant reuse;
- cross-tenant scope switch;
- read-only grant attempting mutation;
- impersonation audit attribution;
- impersonation attempting credential/MFA change;
- approver equals requester when separation is required;
- break-glass without emergency reason;
- queued job after grant revocation;
- duplicate high-risk mutation after timeout/retry;
- sensitive export/download outside allowed scope;
- customer revokes consent during an active support session;
- operator role/employment revoked while session is active;
- legacy admin path bypassing new scoped controls.

The oracle is not "the admin UI showed the right button." The oracle is that operator identity, purpose, approval, scope, effect authority, revocation, and audit/customer evidence remain consistent under the same exact action.
