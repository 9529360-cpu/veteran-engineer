# API and backend patterns

## Contents

- Resource and action modeling
- HTTP semantics
- Error contracts
- Idempotency and duplicate submission
- Timeouts, retries, backoff, jitter
- Rate limiting and overload
- Streaming and real-time APIs
- Webhooks
- Long-running operations
- Compatibility and versioning
- External dependency boundaries
- Mature references

## Resource and action modeling

Design an API around product resources/actions and invariants, not a direct reflection of tables.

For each operation define:

- authenticated actor;
- resource/tenant scope;
- request schema;
- validation and business preconditions;
- authorization check;
- mutation transaction;
- side effects;
- retry/idempotency semantics;
- response/error schema;
- observability identity.

Google AIP-121 is a useful mature reference for resource-oriented API design and explicitly warns against coupling the API one-to-one with database schema:
https://google.aip.dev/121

## HTTP semantics

Use protocol semantics deliberately.

RFC 9110 defines safe/idempotent request-method behavior. In particular, PUT, DELETE, and safe methods are idempotent by method semantics, while POST generally needs an application-level replay contract if clients may retry.

Reference:
https://www.rfc-editor.org/rfc/rfc9110.html

Do not treat a timeout as proof the server did not commit. This is the core reason mutation retries require idempotency/deduplication.

## Error contracts

Return stable machine-readable error categories without leaking implementation details.

RFC 9457 `application/problem+json` is a useful standard model when the API does not already have an established error envelope:
https://www.rfc-editor.org/rfc/rfc9457.html

An error contract should distinguish at least when relevant:

- invalid request;
- unauthenticated;
- unauthorized;
- not found;
- conflict/precondition failure;
- rate limit/overload;
- dependency failure;
- retryable server error;
- terminal business failure.

Do not put raw stack traces, SQL, secret values, tokens, internal hostnames, or sensitive identifiers into client errors.

## Idempotency and duplicate submission

For create/charge/send/schedule/import and other side-effecting operations that can be retried, use an idempotency/dedupe identity scoped to the semantic operation.

Good design questions:

- who generates the key;
- what actor/tenant/endpoint scope it belongs to;
- how long replay state is retained;
- whether parameters must match on reuse;
- which response/result is replayed;
- what happens if the first attempt is still in flight;
- whether side effects occur inside or after the dedupe transaction.

Stripe's public idempotency API is a mature example: repeated requests with the same key are recognized and parameter reuse is validated:
https://docs.stripe.com/api/idempotent_requests

Do not mistake "we disabled the button" for server-side idempotency.

## Timeouts, retries, backoff, jitter

Every remote dependency needs an intentional timeout derived from the user/job budget.

Before retrying, prove the operation is safe to replay.

Prefer:

`attempt budget + exponential backoff + jitter + Retry-After/rate-limit awareness + terminal classification`

Avoid retry multiplication across every layer. Pick a retry owner close to the caller that has enough context to decide safely.

AWS Builders' Library guidance on timeouts/retries/backoff/jitter is a strong production reference:
https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/

## Rate limiting and overload

Classify limits by purpose:

- abuse/security;
- user/tenant entitlement;
- dependency quota;
- shared capacity protection;
- expensive business-flow protection.

Include the correct scope: global, tenant, user, credential, IP, endpoint, resource, or job type.

When rejecting or deferring requests, return actionable retry semantics where appropriate. Do not retry a 429 in a tight loop.

## Streaming and real-time APIs

Treat WebSocket, Server-Sent Events, streaming RPC, subscriptions, and long-lived HTTP responses as stateful protocols rather than ordinary request/response calls.

Define:

- connection/session identity and authenticated principal;
- subscription/resource scope and authorization re-check policy;
- server and client cancellation semantics;
- heartbeat/idle timeout ownership;
- reconnect and resume behavior;
- message/event identity, ordering scope, and duplicate handling;
- backpressure, buffering, per-connection limits, and slow-consumer policy;
- token expiry/rotation without silently widening authorization;
- deploy/drain behavior for long-lived connections;
- observability without high-cardinality payload logging.

Assume reconnect can duplicate or skip application-visible events unless the protocol and application state machine prove stronger semantics. When resumption matters, use a stable cursor/sequence/checkpoint and define what happens when it is too old or no longer available.

Do not keep unbounded per-client queues to preserve the illusion of perfect delivery. Bound buffers and choose an explicit policy: block/backpressure, coalesce, drop with a detectable gap, disconnect and resume, or persist through a durable broker when the product contract requires it.

For bidirectional protocols, authorize commands at the message/action boundary as well as at connection establishment. A connection authenticated once is not permanent proof that every later object/action remains authorized.

For GraphQL subscriptions or generated gRPC clients, separate the public schema/IDL from transport lifecycle. Evolve independently deployed producers/consumers compatibly and bind generated clients to exact schema versions where rollout requires it.

## Webhooks

Treat inbound webhooks as hostile, replayable, duplicate, and potentially out-of-order network input.

Verify:

- signature/authentication using the exact raw bytes when the provider requires it;
- timestamp/replay window when defined;
- event ID or semantic dedupe identity;
- tenant/account routing from server-verified configuration;
- schema/event version;
- idempotent consumer behavior;
- durable receipt before acknowledging if loss is unacceptable;
- ordering assumptions and how missing/out-of-order state is reconciled.

Keep the ingress handler short: authenticate, validate minimal envelope, durably record/enqueue, and acknowledge. Move slow business work to an async owner when provider retry/timeouts or traffic spikes make synchronous processing unsafe.

Stripe's public webhook guidance is a mature concrete example: it documents retries, duplicate deliveries, non-guaranteed event ordering, signature verification from the raw body, and asynchronous processing:
https://docs.stripe.com/webhooks

Do not trust a tenant ID or callback URL supplied inside the webhook without mapping it through authorized configuration. Do not return success before the event reaches the durability boundary required by the product contract.

## Long-running operations

Do not hold HTTP requests open for work that naturally lasts long enough to disconnect, retry, or need progress/cancel state.

Prefer an operation/job resource:

`submit -> operation ID -> status/progress -> terminal result/error`

Google AIP-151 is a mature example:
https://google.aip.dev/151

The operation state must survive process replacement if the work itself survives process replacement.

## Compatibility and versioning

Prefer additive compatible evolution.

For a breaking contract:

- expand first;
- deploy consumers/producers that understand both forms;
- cut over traffic/data;
- remove the old form only after evidence that old clients/workers are gone.

Do not use API versioning to avoid thinking about compatibility; use it when simultaneous contracts are truly required.

## External dependency boundaries

Wrap each meaningful external service behind an owner that defines:

- auth credential scope;
- base URL/version;
- timeout;
- retry/idempotency behavior;
- error normalization;
- rate-limit interpretation;
- request correlation;
- circuit/degradation behavior when appropriate;
- redaction rules.

Do not let vendor-specific exceptions leak throughout domain logic.

## Mature references

- RFC 9110 HTTP Semantics: https://www.rfc-editor.org/rfc/rfc9110.html
- RFC 9457 Problem Details: https://www.rfc-editor.org/rfc/rfc9457.html
- Stripe idempotent requests: https://docs.stripe.com/api/idempotent_requests
- Google API Improvement Proposals: https://google.aip.dev/
- AWS Builders' Library: https://aws.amazon.com/builders-library/
- OWASP API Security Top 10: https://owasp.org/API-Security/
