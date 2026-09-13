# Go service engineering

Use this playbook only when Go module evidence is present. Confirm Go version, module/workspace layout, framework/library versions, CGO/build tags, and deployment target before implementation.

## Ownership and package design

- Prefer package boundaries that reflect stable responsibilities rather than a universal layered template.
- Keep interfaces near consumers when they represent required behavior; do not create interfaces for every concrete type by habit.
- Make ownership of goroutines, channels, clients, and shutdown explicit.

## Context, cancellation, and goroutines

- Propagate `context.Context` through request-scoped I/O and deadlines; do not store it in long-lived structs.
- Every started goroutine needs an owner, termination condition, panic/error strategy, and shutdown behavior.
- Avoid unbounded goroutine creation as a substitute for backpressure.
- Close channels only from the sending/owning side under a clear ownership rule.

## HTTP and RPC

- Configure server/client timeouts intentionally. A default `http.Client` without a total timeout can leak resources under dependency failure.
- Reuse transports/clients; do not create a new transport per request.
- Drain/close response bodies correctly so connections can be reused.
- For gRPC, define deadline, status/error semantics, retries, streaming lifetime, and compatibility explicitly.

## Data and concurrency

- Bound database connection pools against DB capacity; more goroutines do not create more database capacity.
- Keep transactions short and context-aware.
- Protect shared mutable state with clear ownership or synchronization; run race detection on concurrency-sensitive changes when practical.
- Treat map iteration/order and time behavior as unspecified unless explicitly controlled.

## Errors and observability

- Preserve causal error context without relying on string parsing as protocol.
- Use stable typed/sentinel semantics only where callers genuinely need branching behavior.
- Keep metric labels bounded; avoid request/user IDs as labels.
- Carry correlation/trace context across internal calls where allowed.

## Delivery

- Verify build tags, target OS/architecture, CGO/native dependencies, timezone/CA certificate availability, and static/dynamic linking assumptions in the final artifact.
- Validate graceful shutdown and connection draining under real orchestrator termination semantics.
