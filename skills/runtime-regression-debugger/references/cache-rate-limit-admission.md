# Cache, Rate Limiting, Admission Control, and Brownout Engineering

Use this reference when correctness or stability depends on caches, request quotas, overload protection, hot-key control, or fair multi-tenant admission.

## Cache only with an explicit contract

For every cache, define:

- authoritative source;
- key dimensions including tenant/user/auth scope;
- value/version semantics;
- freshness tolerance;
- invalidation/update path;
- TTL and jitter policy;
- negative-cache behavior;
- size/admission/eviction bounds;
- failure behavior when cache is unavailable;
- warmup/repopulation cost.

Never let an eventually consistent cache silently become authorization or monetary authority.

## Stampede and hot keys

A common failure loop is:

`entry expires -> many misses -> origin overload -> origin slows -> timeouts/retries -> more misses`

Use techniques appropriate to the product contract: TTL jitter, request coalescing/single-flight, stale-while-revalidate, bounded background refresh, per-key concurrency limits, prewarm for known hot sets, or admission/eviction policies that resist scan pollution.

Do not place a global distributed lock on every cache miss unless the coordination cost and failure mode are justified.

## Rate limiting algorithms

Choose semantics deliberately:

- **fixed window**: simple, but boundary bursts;
- **sliding window/log/counter**: smoother semantics at more state/cost;
- **token bucket**: sustained rate plus explicit burst capacity;
- **leaky bucket/queueing**: shapes output but can add latency/backlog;
- **concurrency limit**: protects work-in-flight rather than arrival count.

Decide whether the limit is local, per instance, per tenant/user/key, regional, or global. Distributed precision has a coordination cost; many systems need bounded fairness, not globally exact counters.

## Admission control and load shedding

Protect the scarce downstream resource, not an arbitrary frontend metric.

- Define the bottleneck capacity and safety margin.
- Reject or defer work before unbounded queues form.
- Prefer cheap early rejection over expensive late failure.
- Separate critical/read/control traffic from optional/bulk work where product policy permits.
- Use brownout/degraded modes that disable optional expensive features before core correctness fails.
- Return retry guidance only when retry is safe and capacity is expected to recover; jitter clients.

Use `scripts/load_shed_budget.py` for rough admission math under explicit retry and safety-margin assumptions.

## Fairness and abuse

Per-tenant/user/API-key fairness should prevent one actor from consuming the entire shared pool. Combine hard caps, weighted shares, reserved capacity, and burst credits only as required by product contracts.

Do not expose internal capacity numbers in ways that make abuse easier. Authentication/authorization still applies before quota policy where identity affects the limit.

## Validation

Test cold cache, mass expiry, cache loss, hot keys, low hit rate, stale values, origin slowdown, limiter-store failure, clock skew, multiple instances, and recovery after overload. Measure user-visible latency/error trade-offs and origin protection, not only cache hit rate.
