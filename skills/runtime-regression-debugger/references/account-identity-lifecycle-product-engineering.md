# Account and Identity Lifecycle Product Engineering

Use this reference when a product owns user accounts, contact verification, passwords, passkeys, MFA, recovery, linked identity providers, session/device management, or account closure.

The product contract is:

`registration intent -> verified internal account identity -> credential/factor enrollment -> authenticated session -> credential/link/recovery change -> session convergence -> account closure/recovery`

Authentication answers whether current proof is sufficient to act as an account. This reference owns how the account and its proofs are created, replaced, recovered, linked, revoked, and finally closed without changing identity by accident.

For tenant membership/roles read `organization-membership-product-engineering.md`. For request/object authorization and security boundaries read `security-multitenancy-patterns.md`. For privacy export/retention/deletion propagation read `privacy-data-lifecycle-engineering.md`.

## Keep identity and credentials separate

Name the authority for each fact:

- **Account authority** owns the stable internal account identity and terminal account state.
- **Contact-verification authority** owns whether a specific email/phone/contact was proven for a specific account generation and purpose.
- **Credential authority** owns password/passkey/MFA/recovery-factor registration and generation.
- **Session authority** owns active sessions, refresh/token generations, devices, and revocation.
- **Recovery authority** owns recovery intent, proof, generation, completion, and post-recovery consequences.
- **Identity-link authority** owns external issuer/subject or equivalent provider bindings to one internal account.

Do not use a mutable email address, display name, OAuth profile payload, session cookie, or one current credential as the durable account identity.

## Registration and activation

Separate an untrusted registration intent from an activated internal account.

Define:

- stable signup/request identity;
- uniqueness policy and normalization for verified contacts or usernames;
- when an internal account id is allocated;
- verification requirements before activation;
- duplicate or concurrent signup behavior;
- abandoned/unverified account cleanup;
- rate and abuse controls;
- enumeration-resistant public responses where required.

A verification link/token should bind purpose, intended account/contact, generation, expiry, and single-use/revocation state. Changing the contact or issuing a replacement must make superseded generations harmless.

Do not let an old verification link verify a newly changed email/phone merely because the token signature remains valid.

## Contact changes

Changing email or phone can change login and recovery capability, so model it as a security-sensitive transition.

- Require current authentication/step-up according to risk.
- Prove the new destination before making it authoritative when product policy requires.
- Define whether the old destination remains a notification or recovery channel during a bounded transition.
- Revoke stale verification generations.
- Handle duplicate-contact conflicts explicitly rather than silently merging accounts.
- Re-evaluate linked IdP or organization policy that depends on domain/contact when applicable.

## Password lifecycle

Passwords are credentials, not account identity.

Define password creation/change/reset authority, hashing/upgrade policy, compromise/rotation response, history rules only when product/security policy actually requires them, and session consequences.

A password change initiated from a known session and a password reset through recovery are distinct transitions and can justify different session/factor revocation behavior.

Never log raw passwords or reset tokens.

## Passkeys and WebAuthn

A passkey/WebAuthn credential needs:

- trusted RP ID/origin rules;
- stable internal user handle/account binding;
- credential id and public-key ownership;
- registration ceremony bound to the current authenticated account and challenge;
- challenge expiry/replay prevention;
- sign-counter or authenticator semantics appropriate to the implementation;
- user-verification requirements according to policy;
- naming/device metadata treated as presentation, not authority;
- explicit credential removal/replacement and recovery behavior.

Do not auto-link a passkey to another account merely because a contact/profile attribute matches.

## MFA enrollment and removal

Factor enrollment is itself a privileged operation.

- Require fresh account proof/step-up appropriate to risk.
- Verify the new factor before making it authoritative.
- Define enrollment generation and retries so duplicate submissions do not create confusing parallel factors.
- Show enough factor/device metadata for safe management without exposing secrets.
- Require strong proof before disabling the last required factor.
- Define session consequences after factor enrollment/removal or policy changes.

For TOTP or similar secrets, protect seed material at rest and never expose it through logs/analytics/support bundles.

## Recovery codes and backup factors

Recovery codes are credentials.

- Generate with sufficient entropy.
- Store one-way verifiers where feasible rather than plaintext copies.
- Make codes single-use.
- Regenerating a set invalidates the previous set.
- Scope consumption to the intended account and recovery generation.
- Treat support display/download/print flows as sensitive surfaces.

A recovery factor must not quietly outlive account closure or credential reset policy.

## Account recovery is a takeover boundary

Recovery changes who can regain authority over the account. Treat it as an adversarial workflow, not a convenience email.

Define:

`recovery request -> account-scoped generation -> bounded proof -> anti-replay/anti-enumeration -> credential change -> session/factor convergence -> user-visible completion`

Material decisions include:

- which proof sources are accepted;
- whether a newly supplied destination can ever be used as the sole recovery proof;
- token expiry and generation replacement;
- rate limits/lockouts without easy denial-of-service;
- step-up or manual review for high-risk cases;
- cooldown or delayed sensitive actions where approved by product/security policy;
- independent notification to previously trusted channels where appropriate;
- revocation/refresh of old sessions, credentials, recovery tokens, and remembered devices.

Never complete recovery solely because the requester controls the new email/phone they just asked to attach.

## Recovery concurrency and replay

Assume multiple recovery requests and stale links exist simultaneously.

- Give every recovery attempt stable identity and generation.
- Define whether only the newest generation is valid or how multiple channels interact.
- Consume completion atomically.
- Reject replay after success.
- Prevent an older worker/link from restoring a credential/session generation superseded by a newer recovery.
- Keep unknown outcomes explicit if recovery crosses external providers.

## Linked identity providers

External login providers identify an external issuer/subject; they do not replace the internal account identity.

Store enough scope to distinguish provider tenant/client/issuer as needed. Linking should require current authenticated account authority or an explicit trusted merge/recovery flow.

On link:

- prove the external provider identity in a fresh transaction;
- bind callback state/nonce/PKCE as applicable;
- reject collisions when the same external identity is already bound elsewhere;
- do not infer account equivalence from matching email alone;
- audit the link result without storing secrets.

On unlink:

- require fresh account proof;
- prevent removing the last usable factor/recovery path unless product policy intentionally allows an inaccessible state;
- revoke provider-specific sessions/tokens/credentials if owned by the product;
- preserve unrelated tenant membership and internal account identity.

## Account merge and split

Automatic account merge is high risk because identity, memberships, entitlements, ownership, audit history, and credentials may conflict.

If the product supports merge/split, define one explicit authority and invariants for:

- proof of control over both source identities;
- canonical surviving internal account id;
- organization memberships and roles;
- subscription/entitlement ownership;
- resources/content;
- linked IdPs and credentials;
- sessions/devices;
- audit/history lineage;
- duplicate contacts and provider bindings;
- rollback/forward repair.

Do not implement “same email means same user” as an implicit merge policy.

## Sessions and credential generations

Credential changes need a defined session contract.

Sessions/tokens should carry or resolve enough current generation/state to reject security-sensitive stale authority. Define:

- issuance and refresh authority;
- access/refresh expiry;
- rotation/reuse detection where used;
- per-session/device identity;
- global and selective revocation;
- password/recovery/MFA/passkey/link-change consequences;
- remembered-device/trusted-device invalidation;
- account locked/closing/closed behavior.

A long-lived token issued before recovery must not remain indefinitely authoritative merely because its signature is valid.

## Sensitive-operation reauthentication

For password/passkey/MFA changes, provider linking, recovery settings, account closure, payment/security administration, and other high-risk actions, distinguish “has a session” from “recently proved enough account authority.”

Use the product's approved reauthentication/step-up policy and bind the proof to the intended sensitive operation or a bounded freshness window.

## Account closure

Account closure is not merely deleting a credential row.

Coordinate:

`authorize closure -> mark account closing/closed generation -> stop new sessions/recovery -> revoke credentials/sessions/provider links -> memberships/resources follow their own lifecycle -> privacy retention/deletion/export -> external cleanup/reconciliation -> visible terminal state`

Define whether closure is immediate, delayed, or reversible during an approved grace period. Stale verification/recovery/provider callbacks must not resurrect a closed account.

Organization membership/resource handoff and privacy deletion are separate authorities; closure should call/reconcile them rather than silently bypassing their invariants.

## Enumeration and abuse resistance

Registration, verification, login, recovery, link collision, and support flows can disclose whether an account/contact/provider binding exists.

Use product/security-approved response normalization, rate limiting, abuse detection, proof requirements, and operator visibility. Do not hide internal security evidence from authorized support tooling merely to make all internal states identical.

## Observability

Correlate secret-safe identities:

`account -> registration/verification generation -> credential/factor generation -> recovery/link request -> session generation -> closure state`

Track verification/recovery retries and replay, factor enrollment/removal, provider-link collisions, stale-session rejection after credential events, token refresh reuse, account lockout/closure, and unresolved external-provider cleanup.

Never log passwords, MFA seeds, recovery codes, reset/verification tokens, WebAuthn challenges, private keys, session/refresh tokens, or unnecessary personal identity payloads.

## Mixed versions and migrations

- Evolve credential/session/recovery schemas additively or through explicit compatibility windows.
- Assume old clients/tokens can carry older account or credential generations.
- During password-hash migration, rehash/upgrade without changing account identity.
- During passkey/MFA migration, define coexistence/removal rules for old and new factors.
- During IdP migration, preserve stable internal account identity while old/new issuer/subject bindings reconcile.
- A code rollback does not undo verification/recovery emails already sent, sessions revoked, factors removed, or provider links changed.

## Validation shape

High-value cases include:

- duplicate/concurrent signup;
- expired or superseded verification token;
- account-enumeration attempts;
- MFA enrollment/removal race;
- loss of the primary factor;
- recovery token replay;
- two recovery generations completing out of order;
- recovery followed by stale old-session use;
- passkey replacement/removal;
- linked-provider collision with another account;
- unlink of the last usable factor;
- password/contact change with stale sessions;
- cross-account recovery token use;
- account closure while sessions/recovery links are still active;
- old verification callback after contact replacement;
- IdP migration with mixed old/new bindings.

The strongest oracle is not “login succeeded.” It is that account, contact, credential, recovery, linked-provider, and session authorities all agree on the same stable internal identity and stale proof cannot regain authority.

## Common failed approaches

Avoid using email as permanent account identity; treating an OAuth email match as safe automatic linking; letting a reset link stay valid after a newer recovery starts; making MFA removal weaker than MFA enrollment; storing recovery codes plaintext; allowing unlink to strand the account accidentally; leaving all sessions active after a hostile recovery; auto-merging duplicate signups; treating passkey display metadata as authority; resurrecting a closed account from stale callbacks; or letting support/admin tooling mutate identity without the same explicit ownership/audit model.
