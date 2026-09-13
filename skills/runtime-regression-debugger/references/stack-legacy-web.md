# Rails, PHP, and long-lived server-rendered web systems

Use this playbook when Ruby/Rails or PHP/Laravel/Symfony/legacy web evidence is present. Treat long-lived behavior and deployment conventions as contracts; confirm exact runtime/framework/database versions.

## Recover the real application

- Identify web entrypoint, routing, middleware/hooks, background jobs, scheduled tasks, mailers, templates, database callbacks, and asset/build pipeline.
- Inspect environment-specific configuration and process topology; old systems often rely on deployment conventions not represented in application code.
- Look for direct SQL, stored procedures, filesystem state, shared sessions, cron, and operator scripts before declaring a boundary isolated.

## Active Record / ORM caution

- Inspect query count and SQL shape for association-heavy paths.
- Treat callbacks/hooks/magic lifecycle behavior as hidden control flow; trace it before extracting code.
- Keep transactions short; avoid external network calls inside DB transactions.
- Define concurrency/invariant handling explicitly rather than assuming request serialization.

## Background and scheduled work

- Recover Sidekiq/Resque/ActiveJob/queue workers, Laravel queues, Symfony Messenger, cron, or custom daemons.
- Make job identity, retry, duplicate side effects, queue priority, poison payload, and shutdown semantics explicit.
- Check whether interactive requests enqueue work transactionally or can lose/duplicate intent around commit failures.

## Sessions, auth, and old clients

- Understand cookie/session store, CSRF protection, reverse proxy headers, host/scheme assumptions, and authentication plugin behavior before changing login/session code.
- Old clients may depend on HTML/redirect/status semantics that modern API-centric tests miss.
- Preserve encoding, locale, timezone, decimal/money, and form parameter semantics during modernization.

## Modernization

- Do not rewrite solely to change language/framework.
- First isolate a capability behind a route/API/facade seam, characterize behavior, and move authority deliberately.
- Keep old and new cookie/session/auth/data semantics compatible where traffic overlaps.
- Separate runtime/framework EOL upgrade from UI or domain redesign when practical.
- Delete old callbacks/routes/jobs only after proving no traffic or scheduled/manual workflow still relies on them.
