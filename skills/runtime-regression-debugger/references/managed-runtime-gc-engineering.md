# Managed Runtime, GC, JIT, and Memory Engineering

Use this reference when JVM, .NET, Node/V8, Python, or another managed runtime shows pauses, heap growth, allocation pressure, thread/event-loop starvation, warmup effects, or RSS/heap disagreement.

## Identify the runtime mechanism before tuning

Collect exact runtime version, GC/allocator mode, container limits, heap limits, thread/executor settings, and workload shape. Version-sensitive defaults matter; verify current runtime documentation before changing flags.

Do not start with a bag of JVM/GC/V8 flags copied from another service.

## Allocation and collection

Reason from:

`allocation rate -> object lifetime distribution -> live-set size -> collection frequency -> pause/concurrent-work cost -> CPU/RSS/tail latency`

A large heap can reduce collection frequency but increase memory footprint and some pause/recovery costs. A small heap can create allocation/collection churn. Optimize the workload and allocation profile before assuming GC tuning is the primary fix.

## Heap is not process memory

Account for native buffers, direct byte buffers, JIT/code cache, thread stacks, shared libraries, mmap, allocator arenas, page cache, and runtime metadata. If RSS grows while managed heap stays flat, investigate native/off-heap ownership rather than increasing the heap blindly.

## Runtime-specific failure shapes

### JVM

Inspect GC logs/JFR/profiles, safepoints, allocation rate, old-generation pressure, direct buffers, thread pools, classloader/metaspace growth, JIT warmup/deoptimization, and container awareness. Treat `System.gc()` and blanket heap enlargement as diagnostics at best unless evidence supports them.

### .NET

Inspect GC generations/LOH, allocation rate, thread-pool starvation, async blocking, pinned objects, native interop, and server/workstation/container GC behavior. Distinguish memory retained intentionally from leaks by ownership and lifetime.

### Node.js / V8

Inspect event-loop delay, CPU profiles, heap snapshots, external/Buffer memory, promise/timer/listener lifetimes, worker/libuv pool saturation, and synchronous CPU work. A low process CPU average does not rule out a blocked event loop on one core.

### Python

Distinguish reference-counting/object retention, cyclic GC, native-extension allocations, process-worker multiplicity, GIL-bound CPU work, async-loop blocking, and allocator/RSS behavior. More workers multiply memory and connection pools; budget them explicitly.

## Leak diagnosis

Prove retention across repeated lifecycle cycles or steady-state traffic. Compare allocation/retention by owner and object graph/root where tooling supports it.

A cache that grows to a documented bound is not the same as an unbounded leak. A process that returns managed objects but not RSS may reflect allocator/page behavior rather than live-object growth.

## Benchmark discipline

Warmup, JIT tiering, profile collection, heap dump, and debug instrumentation can alter behavior. Compare baseline/candidate using equivalent runtime flags, workload, container limits, and warm state.
