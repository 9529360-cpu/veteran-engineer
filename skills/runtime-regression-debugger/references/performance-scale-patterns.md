# Performance, scalability, and efficiency patterns

## Contents

- Define a performance contract
- Measure baseline before optimizing
- Decompose latency and resource ownership
- Profile before changing code
- Treat database performance as workload-dependent
- Design caches with correctness first
- Control concurrency and backpressure
- Test frontend performance in field and lab
- Guard memory and resource lifecycle
- Include cost and efficiency where material
- Prove regressions with comparable workloads
- Mature references

## Define a performance contract

Translate "make it faster" into a measurable user/operator objective.

Useful dimensions:

- end-to-end latency distribution, not only average;
- throughput;
- queue age/backlog;
- CPU and memory;
- DB time/locks/connections;
- dependency latency/quota;
- payload size/network transfer;
- browser main-thread/input delay;
- cold start versus steady state;
- cost per request/job/tenant when material.

Use p50/p95/p99 or a product-specific percentile where tail latency matters. Define the workload and environment alongside the target.

## Measure baseline before optimizing

Capture a reproducible baseline before changing implementation.

Record:

- exact build/commit/config;
- dataset size/distribution;
- concurrency and request mix;
- warm/cold state;
- hardware/runtime limits;
- dependency behavior;
- measurement duration/sample count;
- relevant percentiles and resource signals.

Do not compare a cold baseline against a warm candidate or a toy dataset against production-scale data.

## Decompose latency and resource ownership

Break end-to-end work into owners:

`client -> network -> gateway -> app -> DB/cache -> queue/dependency -> projection -> render`

Use traces, timings, query stats, profiles, browser tooling, and queue metrics to identify the dominant owner.

Optimizing a 5 ms component does not matter when a 900 ms dependency dominates the critical path.

## Profile before changing code

Use a profiler when CPU, allocation, lock contention, blocking, or memory growth is suspected.

Different profiles answer different questions:

- on-CPU -> where processor time is spent;
- off-CPU -> where execution waits/blocks;
- heap -> retained memory;
- allocations -> allocation pressure/churn;
- lock/thread/runtime profiles -> contention and scheduling.

OpenTelemetry Profiles is currently an emerging/alpha signal, so verify ecosystem support before depending on it as a production contract:
https://opentelemetry.io/docs/concepts/signals/profiles/

Do not add high-cardinality telemetry or expensive profiling blindly; measure instrumentation overhead.

When application metrics cannot explain the bottleneck, ask a concrete lower-level question before reaching for perf/eBPF: on-CPU work, off-CPU blocking, scheduler/run-queue delay, syscall/file/network latency, page faults/reclaim, cgroup throttling, or allocation/GC. Prefer sampling and the least invasive profiler; bind profiles to exact build, workload, host/container limits, and latency interval. A hot function may be expected work amplified by an upstream retry or traffic-shape problem, not the root cause.

## Treat database performance as workload-dependent

For database bottlenecks:

1. identify the actual slow/high-volume query;
2. inspect real row counts/selectivity and planner estimates;
3. use `EXPLAIN`/`EXPLAIN ANALYZE` safely;
4. inspect indexes, locks, I/O, connection pressure, and statistics;
5. test with representative data scale;
6. measure write/storage overhead of new indexes;
7. verify the application query still has correct semantics.

PostgreSQL's current documentation explicitly recommends examining plans and index usage with realistic data and up-to-date statistics:
https://www.postgresql.org/docs/current/using-explain.html
https://www.postgresql.org/docs/current/indexes-examine.html

Remember that `EXPLAIN ANALYZE` executes the statement. Protect mutating statements appropriately.

## Design caches with correctness first

A cache is a consistency mechanism, not merely a speed trick.

Define:

- authoritative source;
- key scope including tenant/user/authorization dimensions;
- freshness/TTL;
- invalidation owner;
- read-after-write behavior;
- stampede/coalescing policy;
- failure behavior;
- capacity/eviction;
- observability.

Do not cache an authorization decision longer or more broadly than its revocation semantics permit.

## Control concurrency and backpressure

More parallelism can reduce throughput when the real bottleneck saturates.

Bound concurrency by:

- DB connection pool;
- dependency quota;
- CPU/memory;
- queue consumer capacity;
- browser/runtime limits;
- per-tenant fairness requirements.

Use admission control, queueing, load shedding, or deferred work where appropriate. Measure recovery after overload, not only peak throughput.

## Test frontend performance in field and lab

For web products, distinguish lab from real-user measurements.

Current Core Web Vitals focus on LCP, INP, and CLS and are evaluated using field experience; lab tools remain useful for pre-release regression detection:
https://web.dev/articles/vitals

Measure the actual interaction or route changed. Avoid cargo-cult memoization, bundle splitting, or virtualization without evidence that it addresses the dominant cost.

## Guard memory and resource lifecycle

Performance regressions are often lifecycle leaks rather than slow algorithms.

Check:

- listeners/subscriptions not removed;
- timers/pollers multiplied after remount/reconnect;
- stale browser/WebContents/session owners retained;
- unbounded caches/maps/buffers;
- queued work without backpressure;
- large object retention;
- connection/file descriptor leaks;
- retries accumulating work faster than completion.

Use repeated-cycle tests and steady-state observation to detect growth.

## Include cost and efficiency where material

For serverless, high-volume, AI, storage-heavy, or egress-heavy systems, include unit economics in performance decisions.

Useful ratios:

- compute time/request;
- DB queries/request;
- bytes/request;
- queue attempts/job;
- cache hit rate;
- cost/1k operations;
- storage growth/day;
- third-party API units/user action.

A faster design that multiplies dependency calls or data transfer may be operationally worse.

## Prove regressions with comparable workloads

A credible performance conclusion compares baseline and candidate under equivalent conditions.

Report:

- workload;
- exact builds/config;
- warm/cold state;
- before/after distribution;
- resource changes;
- correctness/error rate;
- confidence/noise caveats;
- regression guard added.

Do not claim a performance win from one local timing sample.

## Mature references

- Core Web Vitals: https://web.dev/articles/vitals
- PostgreSQL performance tips: https://www.postgresql.org/docs/current/performance-tips.html
- PostgreSQL EXPLAIN: https://www.postgresql.org/docs/current/using-explain.html
- OpenTelemetry Profiles: https://opentelemetry.io/docs/concepts/signals/profiles/
- OpenTelemetry performance principles: https://opentelemetry.io/docs/specs/otel/performance/
- Google SRE monitoring: https://sre.google/sre-book/monitoring-distributed-systems/
- AWS Builders' Library: https://aws.amazon.com/builders-library/
