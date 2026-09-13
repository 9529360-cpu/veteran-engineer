# Linux, Networking, and Runtime Engineering

Use this reference when symptoms involve latency, connection failure, resource exhaustion, process lifecycle, containers, DNS/TLS, or "works locally" differences.

## Trace the request below the framework

Model the path when relevant:

`client -> DNS -> proxy/LB -> TCP/TLS -> listener -> accept queue -> runtime event loop/thread -> app queue -> dependency socket -> kernel/filesystem -> response`

Locate the wait or failure boundary before changing application logic.

## Process and resource fundamentals

Inspect limits and ownership for:

- CPU quota/throttling and runnable queue;
- RSS/heap/native memory/page cache;
- file descriptors and socket counts;
- thread/process count;
- event-loop lag or executor starvation;
- disk space/inodes and I/O latency;
- ephemeral ports/NAT/conntrack where outbound fan-out is high;
- cgroup/container limits versus host capacity.

A machine with free memory can still have a process-specific limit. A container with low CPU usage can still be throttled by quota bursts.

## TCP, HTTP, proxies, and pools

- Align connect, TLS, request, idle, keepalive, and total-operation timeouts intentionally across hops.
- Avoid retry layers that multiply each other at client, proxy, service mesh, SDK, and application levels.
- Reuse connections where appropriate, but set bounded pool sizes and validate idle-connection behavior through real proxies/NAT.
- Distinguish connection refused, reset, timeout, TLS failure, HTTP error, and application timeout; they imply different owners.
- Check backlog/accept saturation, connection churn, slow clients, and head-of-line effects before blaming the handler.

## DNS and service discovery

- Treat DNS caching/TTL behavior as runtime-specific.
- During failover, verify resolver caches, negative caching, load balancer health, stale connections, and application discovery refresh.
- Do not assume changing DNS means established connections move immediately.

## Signals, shutdown, and restarts

A graceful shutdown must stop admission, finish or checkpoint bounded in-flight work, release leases, close listeners/pools, and exit before the platform's hard deadline.

- Know PID 1/signal forwarding behavior in containers.
- Avoid accepting new durable work after shutdown begins unless ownership transfer is explicit.
- Test crash, SIGTERM, rolling restart, node drain, suspend/resume, and abrupt dependency loss where relevant.

## Filesystems and durability

- Distinguish application flush from OS page cache from durable storage acknowledgement.
- Atomic rename, fsync, file locking, network filesystems, and overlay/container filesystems have different semantics.
- Do not use local process disk as durable authoritative state in ephemeral runtimes unless persistence is guaranteed.

## Evidence hierarchy

Prefer runtime-native evidence: socket state, process metrics, kernel/container limits, traces, profiles, packet/connection counters, proxy logs, and exact timeout configuration. Use packet capture or lower-level tracing only when needed and authorized; minimize sensitive payload capture.
