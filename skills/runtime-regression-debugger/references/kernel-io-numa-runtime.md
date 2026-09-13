# Linux Kernel, I/O, Memory, and NUMA Engineering

Use this reference when application metrics do not explain latency, throughput collapse, memory pressure, I/O stalls, CPU saturation, container-host differences, or large-machine behavior.

## Separate kinds of CPU pressure

Do not treat aggregate CPU percentage as sufficient evidence. Distinguish when available:

- user versus system CPU;
- runnable queue/load versus actual core count/quota;
- steal time in virtualized environments;
- CPU throttling from cgroups/quotas;
- interrupt/softirq pressure;
- scheduler contention and excessive context switching;
- single-thread or single-core saturation hidden by fleet/host averages.

High latency with modest fleet-average CPU can still be a CPU scheduling problem on a hot core, throttled container, or overloaded cell.

## Memory is more than heap

Model:

`application heap + native allocations + stacks + mmap + page cache + kernel/socket buffers + shared memory`

Inspect RSS, working set, allocation rate, reclaim, swap behavior, OOM events, cgroup limits, and page cache effects. A managed runtime may report a healthy heap while the process is near its RSS/cgroup limit.

Avoid treating Linux page cache as automatically wasted memory. Reclaim behavior and working-set pressure matter more than the "free" number alone.

## I/O path and durability

For storage-sensitive workloads, distinguish:

`application write -> filesystem cache -> block layer -> device/controller cache -> durable media`

Measure service time, queue depth, throughput, IOPS, tail latency, fsync latency, and saturation under representative concurrency.

- Sequential throughput and random small-write latency are different constraints.
- A faster device cannot fix lock contention or synchronous write serialization above it.
- High I/O wait is context-dependent; confirm which process/request is blocked.
- Check disk/inode exhaustion and filesystem error state before tuning.
- Validate cloud-volume burst credits/provisioned limits where applicable.

## NUMA and large hosts

On multi-socket/high-core systems, memory locality can matter.

- Identify NUMA topology before assuming all memory accesses have equal cost.
- Watch cross-node memory access and uneven IRQ/thread placement for highly latency-sensitive workloads.
- Be cautious with manual CPU pinning, NUMA binding, huge pages, and IRQ tuning; benchmark under the real workload and preserve an easy rollback.
- Prefer reducing unnecessary sharing/contention before micro-tuning affinity.

Do not introduce NUMA-specific complexity on small systems where it cannot explain the symptom.

## File descriptors, sockets, and kernel limits

Inspect process and system limits for file descriptors, open sockets, listen/SYN backlogs, ephemeral ports, conntrack/NAT capacity, and mmap/thread limits when symptoms indicate exhaustion.

A raised limit only moves the bottleneck if downstream memory, CPU, DB, or network capacity is unchanged.

## Evidence tools

Use the least invasive tool that distinguishes the hypothesis: process/runtime metrics, `/proc`, cgroup stats, `vmstat`, `iostat`, `pidstat`, socket counters, profiler traces, eBPF/perf/strace when justified and authorized.

Correlate kernel evidence to user-visible requests or workload phases. A kernel metric without a product-level correlation is a clue, not a root cause.
