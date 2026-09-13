# Capacity, Queueing, Overload, and Load Shedding

Use this reference for scale planning, saturation incidents, concurrency tuning, queue backlogs, or architecture claims about throughput.

## Build a capacity budget before tuning

Translate product demand into a rough resource model:

- logical requests/events per second and peak multiplier;
- average and tail service time;
- concurrent in-flight work (Little's Law: concurrency ~= throughput * average time);
- downstream calls per request;
- database work and connection demand;
- queue arrival/service rates and backlog tolerance;
- payload/storage growth and retention;
- third-party quotas and cost-sensitive operations.

Use `scripts/capacity_budget.py` for quick arithmetic, then validate assumptions with production-like measurements.

## Utilization is nonlinear

Near saturation, small load increases can create disproportionate queueing delay. Do not plan steady-state operation at theoretical maximum throughput.

- Reserve headroom for bursts, failover, deploys, noisy neighbors, compaction/GC, and dependency degradation.
- Measure p95/p99, not only averages.
- Bound concurrency at the bottleneck, not at the easiest layer to configure.
- If adding workers increases queue wait or dependency latency, the system may already be past useful concurrency.

## Backpressure and admission

Overload is a product behavior problem, not only an infrastructure problem.

- Reject, defer, degrade, sample, or shed lower-value work before all work fails.
- Bound queues. An unbounded queue converts overload into memory growth and stale work.
- Propagate deadlines/cancellation when downstream work is no longer useful.
- Apply per-tenant/user fairness where one source can monopolize scarce resources.
- Preserve control-plane/health/repair capacity during data-plane overload.

## Retry amplification

Retries create extra arrival rate precisely when a dependency is unhealthy.

- Retry only transient/replay-safe operations.
- Bound attempts, use backoff+jitter, and honor server retry hints.
- Budget total retry work and avoid stacked retry policies across layers.
- Couple circuit breaking/load shedding to measured dependency health; do not use a breaker as a generic exception wrapper.

## Queue recovery

For a backlog, calculate net drain rate:

`drain = consumer_capacity - new_arrival_rate`

If drain <= 0, the backlog cannot recover. Increasing concurrency is useful only if the true downstream bottleneck has headroom.

Define age-based SLOs and poison-message handling so "queue length falling" does not hide permanently stuck work.

## Capacity review output

State baseline, workload assumptions, bottleneck, saturation signal, headroom, failure mode, shedding/degradation plan, estimated candidate capacity, measurement plan, and which assumptions remain unproven.
