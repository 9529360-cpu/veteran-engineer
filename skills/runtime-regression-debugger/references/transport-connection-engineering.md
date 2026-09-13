# Transport, TCP, TLS, and Connection-Storm Engineering

Use this reference when failures involve connection establishment, resets, intermittent timeouts, retry storms, proxy/LB behavior, large fan-out, deploy drains, or sudden traffic spikes.

## Decompose connection lifecycle

Trace separately:

`name resolution -> route -> SYN/connect -> TLS -> protocol/session setup -> request -> response -> idle reuse -> close/drain`

A "network timeout" is too coarse. Determine which stage consumed the budget.

## Connection storms

Connection storms often occur during deploys, failover, autoscaling, DNS changes, proxy restarts, expired idle pools, or dependency recovery.

Model the positive feedback loop:

`connections fail/close -> clients reconnect -> handshake CPU/state rises -> latency rises -> timeouts -> retries -> more connects`

Mitigations may include jittered reconnects, bounded concurrent dials, warm pools, admission control, longer-lived healthy connections, staged traffic restore, and sufficient listener/NAT/TLS capacity. Do not solve a storm by adding unlimited retries.

## TCP and transport behavior

When relevant, inspect:

- SYN/accept backlog pressure;
- retransmission/loss and RTT changes;
- congestion control and bandwidth-delay-product effects;
- TIME_WAIT/ephemeral-port pressure for high connection churn;
- keepalive/idle timeout mismatches across clients, LBs, proxies, NAT, and servers;
- MTU/path issues when failures correlate with payload size or network path;
- connection migration/session semantics for HTTP/2, HTTP/3/QUIC, gRPC, or long-lived streams.

Do not change kernel TCP tunables from a generic checklist. Tie each change to measured transport evidence and validate under representative load.

## Timeout budgets

Allocate end-to-end deadlines intentionally. Inner operations should normally finish or fail before outer deadlines so callers retain time to classify/recover.

Avoid independent timeout/retry policies at every layer. A client with 3 retries through a proxy with 2 retries into an SDK with 3 retries can turn one logical request into a fleet event.

Propagate deadlines where supported and stop work that can no longer produce a useful response, unless the operation is a durable asynchronous mutation with its own completion contract.

## TLS and certificates

Distinguish certificate validation, SNI/hostname, protocol/cipher negotiation, mutual-TLS identity, OCSP/CRL dependencies, and handshake CPU/latency. Certificate rotation must account for long-lived connections and staggered trust-store rollout.

Never disable certificate validation to make a production path work.

## Draining and failover

A safe rolling deploy/failover should coordinate:

`stop admission -> remove from discovery/LB -> allow bounded in-flight completion -> checkpoint/transfer durable work -> close connections -> terminate`

Verify behavior for WebSockets, HTTP/2/gRPC streams, long polls, queue consumers, and sticky sessions separately; their drain semantics differ from short HTTP requests.

## Packet-level evidence

Use packet capture only when higher-level telemetry cannot distinguish the mechanism and capture is authorized. Prefer metadata/counters and targeted filters; avoid retaining sensitive payloads.
