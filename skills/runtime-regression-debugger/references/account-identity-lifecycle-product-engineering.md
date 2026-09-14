# Account and Identity Lifecycle Product Engineering

Use this when a product owns user accounts, contact verification, passwords, passkeys, MFA, recovery, linked identity providers, session/device management, or account closure.

`registration intent -> stable internal account -> verified contacts/credentials -> authenticated sessions -> credential/link/recovery transitions -> session convergence -> closure`

This reference owns how one internal account identity and its proofs are created, replaced, recovered, linked, revoked, and closed. For tenant membership/roles use `organization-membership-product-engineering.md`; for request/object authorization use `security-multitenancy-patterns.md`; for retention/export/deletion propagation use `privacy-data-lifecycle-engineering.md`.

## Keep identity and proof authorities separate

Name one authority for each material fact:

- account identity and terminal account state;
- verification state for a specific contact, purpose, and generation;
- password/passkey/MFA/recovery-factor registrations and generations;
- sessions, refresh/token generations, devices, and revocation;
- recovery intent, proof, generation, completion, and consequences;
- external issuer/subject bindings to the internal account.

A mutable email, phone, display name, OAuth profile, session cookie, or current credential is not the durable account identity.

## Registration and contact verification

Separate untrusted signup intent from activated account identity. Define when the account id exists, uniqueness/normalization policy, verification requirements, duplicate/concurrent signup behavior, abandoned-intent cleanup, abuse controls, and enumeration-resistant public behavior where required.

Verification artifacts bind the intended account/contact, purpose, generation, expiry, and single-use/revocation state. Replacing a contact or issuing a newer verification generation makes stale links harmless; an old token must not verify a newly changed destination.

Changing email/phone is security-sensitive when it affects login or recovery. Require current proof/step-up as policy demands, prove the new destination before authority moves when required, reject implicit account merge on collisions, and define what happens to old recovery/notification channels.

## Credentials and factors

Passwords, passkeys, MFA factors, and recovery codes are proofs, not account identity.

Credential creation, replacement, and removal must define fresh-proof requirements, generation changes, session consequences, and secret handling. In particular:

- passkeys/WebAuthn bind trusted RP/origin, challenge, internal account/user handle, credential id/public key, replay bounds, and explicit removal/replacement;
- MFA enrollment verifies a new factor before making it authoritative and removal of the last required factor needs appropriately strong proof;
- recovery codes are high-entropy, single-use, stored as verifiers where feasible, and regeneration invalidates the prior set;
- secrets, reset tokens, MFA seeds, recovery codes, private keys, session tokens, and WebAuthn challenges never belong in logs or analytics.

Do not auto-link credentials or accounts because profile/contact attributes happen to match.

## Recovery is an account-takeover boundary

Model recovery as:

`account-scoped recovery generation -> bounded proof -> anti-replay/anti-enumeration -> credential transition -> session/factor convergence -> visible completion`

Recovery needs stable attempt identity, expiry, replacement semantics, atomic completion, replay rejection, rate/abuse controls, and explicit post-recovery session/factor behavior. Multiple generations may race; an older request, worker, or link must not restore authority superseded by a newer recovery.

Never complete recovery solely because the requester controls a new email/phone they just asked to attach. High-risk flows use only approved proof/step-up/manual-review/cooldown policy rather than inventing weaker shortcuts.

## Linked identity providers and account merge

External providers identify an issuer/subject (plus provider tenant/client scope where relevant); they do not replace internal account identity.

Link/unlink requires fresh trusted account authority or an explicit recovery/merge flow. Bind callback state/nonce/PKCE where applicable, reject an external identity already bound elsewhere, and do not infer account equivalence from matching email alone.

Unlink must not accidentally strand the account without an allowed proof/recovery path. Provider-specific tokens/credentials owned by the product are revoked through their lifecycle without changing unrelated tenant membership or the internal account id.

If account merge/split exists, make it an explicit authority covering proof of both identities, canonical surviving account id, memberships, entitlements, resources, credentials, provider bindings, sessions, and audit lineage. “Same email means same user” is not a merge policy.

## Sessions follow account and credential generations

Define issuance/refresh authority, expiry, rotation/reuse detection where used, per-session/device identity, selective/global revocation, and the consequences of password, recovery, MFA, passkey, contact, provider-link, lock, and closure transitions.

A token issued before a hostile recovery, credential replacement, or account closure must not stay authoritative merely because its signature remains valid. Sessions should carry or resolve enough current account/credential/session generation to reject superseded authority.

For password/passkey/MFA changes, linking, recovery settings, account closure, and other high-risk actions, distinguish “has a session” from “recently proved enough authority.” Use the product's approved step-up/reauthentication policy with bounded freshness or operation binding.

## Closure is terminal identity lifecycle

Coordinate:

`authorize closure -> closing/closed generation -> block new sessions/recovery -> revoke credentials/sessions/provider links -> delegate memberships/resources/privacy lifecycle -> external cleanup/reconciliation -> terminal visible state`

Define immediate versus delayed/reversible closure if supported. Stale verification, recovery, provider callbacks, or old sessions must not resurrect a closed account. Membership/resource handoff and privacy deletion remain their own authorities rather than being bypassed by account closure.

## Compatibility, observability, and validation

Assume old clients/tokens, credential schemas, recovery generations, and IdP bindings can overlap during migrations. Preserve stable internal account identity while password hashes, factors, session claims, or provider bindings evolve. Code rollback cannot undo verification/recovery messages already sent, sessions revoked, credentials removed, or provider links changed.

Correlate secret-safe account, verification, credential/factor, recovery/link, session, and closure identities. Observe replay, collisions, stale-session rejection, factor changes, refresh reuse, closure, and unresolved provider cleanup without recording secrets.

Use tests that can falsify the changed mechanism, especially duplicate signup, superseded verification, enumeration, factor enrollment/removal races, recovery replay/out-of-order generations, stale sessions after recovery/password change, passkey replacement, provider-link collision, unlink-last-factor, cross-account recovery, and closure with live sessions/callbacks.

The useful oracle is not “login succeeded.” Account, contact, credential, recovery, provider-link, and session authorities must converge on the same stable internal identity, and stale proof must never regain authority.
