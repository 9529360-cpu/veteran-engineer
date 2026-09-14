# Security, authentication, and multi-tenancy patterns

## Contents

- Trust-boundary inventory
- Authentication and sessions
- Account and identity lifecycle
- OAuth/OIDC
- Authorization
- Multi-tenant isolation
- Organization and membership lifecycle
- Secrets and credentials
- Files, object storage, URLs, parsers, and SSRF
- Audit and sensitive operations
- Security review workflow
- Mature references

## Trust-boundary inventory

For every feature, identify what crosses from a less trusted context into a more privileged one:

- browser/client -> API;
- external webhook -> backend;
- tenant/user input -> database query;
- user URL -> server-side fetch;
- uploaded file -> parser/renderer;
- remote page -> desktop main/preload;
- queue producer -> privileged worker;
- CI job -> production secret/deploy target;
- adapter/plugin -> host runtime.

Validate and authorize at the boundary that actually grants capability.

## Authentication and sessions

Authentication answers who the actor is; authorization answers what that actor may do.

For sessions/tokens define:

- issuance authority;
- expiry/idle expiry;
- refresh/rotation;
- revocation semantics;
- device/session list if product requires it;
- logout behavior;
- password/reset or passkey interaction;
- tenant membership version changes;
- sensitive-operation reauthentication.

Do not put long-lived secrets in localStorage merely because frontend access is convenient.

## Account and identity lifecycle

When the product owns registration, contact verification, passwords/passkeys/MFA, recovery, linked identity providers, credential replacement, session/device security changes, or account closure, read `account-identity-lifecycle-product-engineering.md`.

Keep stable account identity separate from contacts, credentials, recovery proofs, provider links, sessions, and tenant memberships. Treat recovery, factor removal, provider linking/unlinking, and account closure as security-sensitive state transitions whose stale tokens, sessions, and callbacks must converge rather than relying on signature validity alone.

## OAuth/OIDC

Use current provider guidance and current IETF best practice for every integration.

RFC 9700 is the current OAuth 2.0 Security Best Current Practice and requires exact redirect URI matching in redirect-based flows, among other hardening guidance:
https://www.rfc-editor.org/rfc/rfc9700.html

For native/desktop OAuth, also apply RFC 8252 external-user-agent guidance where the host owns the OAuth flow:
https://www.rfc-editor.org/rfc/rfc8252.html

Keep transaction-scoped `state`/nonce/PKCE and bind callbacks to the initiating account/session.

Do not spoof browser identity to bypass an identity provider that intentionally rejects embedded user agents.

## Authorization

Enforce object/action authorization server-side for every path.

A UUID, opaque ID, signed UI state, or hidden button is not authorization.

For resource access ask:

`principal P acting in tenant T wants action A on resource R`

Verify membership/role/policy and that R belongs to the permitted scope.

OWASP API Security identifies broken object-level authorization as a primary API risk:
https://owasp.org/API-Security/editions/2023/en/0xa1-broken-object-level-authorization/

## Multi-tenant isolation

Establish tenant context early from a server-verified identity/membership, not an arbitrary header alone.

Carry tenant scope through:

- DB queries/transactions;
- cache keys;
- object storage paths/policies;
- queue messages and consumers;
- rate limits/quotas;
- external credentials;
- audit events;
- exports/backups;
- admin operations.

OWASP's Multi-Tenant Security Cheat Sheet is a strong current reference and explicitly recommends re-establishing authorization for asynchronous work and scoping cache/storage resources:
https://cheatsheetseries.owasp.org/cheatsheets/Multi_Tenant_Security_Cheat_Sheet.html

Test isolation using two tenants over reused process/DB/cache connections so stale request context cannot bleed across requests.

## Organization and membership lifecycle

When the product owns organizations/workspaces, invitations, membership states, roles, guests, owner transfer, SCIM/group provisioning, or member offboarding, read `organization-membership-product-engineering.md`.

Keep identity, tenant membership, role/policy, directory provisioning, and resource ownership under explicit owners. Treat membership/role changes as revocation events that may need to converge across sessions, caches, realtime subscriptions, and asynchronous jobs; updating one membership row is not sufficient proof that stale access is gone.

## Secrets and credentials

Keep secrets in purpose-built secret stores/environment bindings rather than source/config checked into Git.

Prefer:

- least privilege;
- separate credentials by environment/purpose;
- short-lived/OIDC credentials for CI when possible;
- explicit rotation procedure;
- redaction at logging/telemetry boundaries;
- secret scanning/pre-commit/CI where appropriate.

OWASP Secrets Management guidance is a useful baseline:
https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html

Do not log Authorization headers, cookies, password reset tokens, API keys, client secrets, or raw signed URLs.

## Files, object storage, URLs, parsers, and SSRF

Treat uploads, object delivery, parsers, and remote fetches as high-risk boundaries.

For uploads:

- verify size/type using server-side policy;
- avoid trusting filename extension/content-type alone;
- use server-controlled object keys rather than raw user paths;
- bind upload intent to actor/tenant/object purpose and expected size/type/checksum when practical;
- separate `upload-issued`, `object-present`, `validated/scanned`, and `available` states when processing is asynchronous;
- scan/transform/quarantine if the threat model requires it;
- constrain archive extraction against traversal, symlinks, and decompression bombs;
- expire abandoned multipart/upload intents and clean orphaned objects deliberately.

For object delivery:

- authorize before issuing a signed URL or streaming bytes;
- keep signed URL TTL/scope/method as narrow as product semantics allow;
- never treat knowledge of an object key as authorization;
- include tenant/owner scope in metadata and cleanup jobs;
- define retention/versioning/deletion behavior, including backups and CDN caches.

For server-side URL fetch:

- parse and normalize once;
- allowlist destinations when product semantics permit;
- block private/link-local/metadata targets as appropriate;
- re-check redirects/DNS resolution under the chosen security model;
- enforce protocol, size, timeout, and redirect limits.

Do not make a privileged backend proxy simply to bypass browser CORS.

## Audit and sensitive operations

Audit security-significant state changes such as:

- privilege/role changes;
- credential/key creation/revocation;
- password reset completion;
- tenant deletion/export;
- billing/entitlement changes;
- production deployment/config changes.

Audit events should identify actor, verified tenant/account, action, target, result, time, and correlation ID without embedding secrets or sensitive payloads.

## Security review workflow

For high-risk changes:

1. identify trust boundaries and assets;
2. list abuse cases/failure modes;
3. verify authentication/authorization ownership;
4. verify data/tenant/cache/job isolation;
5. inspect secrets and logging;
6. inspect input/file/network parsing;
7. add negative tests;
8. review rollout/revocation/recovery;
9. check dependencies/runtime security changes.

OWASP ASVS 5.0 provides a broad current verification taxonomy covering frontend, API, file handling, authentication, session management, authorization, OAuth/OIDC, cryptography, data protection, architecture, logging, and WebRTC:
https://owasp.org/www-project-application-security-verification-standard/

## Mature references

- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP API Security Top 10: https://owasp.org/API-Security/
- OAuth Security BCP RFC 9700: https://www.rfc-editor.org/rfc/rfc9700.html
- OAuth for Native Apps RFC 8252: https://www.rfc-editor.org/rfc/rfc8252.html
