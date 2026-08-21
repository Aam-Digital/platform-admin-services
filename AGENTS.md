# AGENTS.md

Guidance for coding agents working in this repository.

Admin backend for Aam Digital's SaaS platform: a NestJS REST API over PostgreSQL
(TypeORM) that tracks customer instances (each a subdomain like
`my-org.aam-digital.app`) and provisions them by dispatching the
`pulumi-up-instances` workflow in `Aam-Digital/aam-cloud-infrastructure`.
Released by semantic-release on push to main.

Routes all live in `src/instance/instance.controller.ts`, under the `api/v1`
prefix set in `main.ts`. Their Swagger decorators, and those of the DTOs, are the
API documentation the `README.md` points at — keep them current when behaviour
changes.

**Invariants:**

- `GET /instances` is the deployment manifest the infrastructure reads, and it
  defaults to `active`. Anything missing from it is destroyed on the next
  deployment, so a query that returns too few rows destroys systems — hence
  the validated `status` filter and, in the migration, a
  `NOT NULL DEFAULT 'active'` column with a `CHECK` constraint on the two
  allowed values.
- The routes that take an instance down accept the admin password only, not the
  GitHub OIDC token the other admin routes also accept: that token is authorized
  by its `repository` claim alone, so any workflow in that repository could
  otherwise use it. They also require `?confirm=<name>` repeating the path
  name — valid credentials do not establish that the caller meant *this*
  instance.
- Lifecycle writes are conditional on the status that was read
  (`update`/`delete` with a status predicate, checking `affected`), never
  `save`/`remove` on a loaded entity. A concurrent re-activation would otherwise
  slip an active instance past the "must be hibernated" check. A row lock would
  do too, but `better-sqlite3` in the e2e tests does not support one.

**Conventions:**

- Read required env vars with `configService.getOrThrow` in the constructor and
  keep them as fields — fail at startup, not at runtime.
- Keep log messages constant, passing the variable parts as an object param —
  `logger.warn("rejected request from IP", { clientIp })`, never interpolation:
  Sentry groups on the message. Report failures by logging an `Error` (wrapping
  the cause), so Sentry gets a stack trace; no `Sentry.captureException`
  alongside, `SentryLogger` (`src/common/sentry-logger.service.ts`) already
  sends it. Log taking an instance down, and putting it back up, at `warn` with
  the client IP — the admin password is shared, so the IP is the only audit
  trail.
- Register migrations in the explicit array in `app.module.ts`; adding the file
  is not enough. `data-source.ts` (the `migration:*` scripts) globs the
  TypeScript sources instead, because it runs under ts-node.
- Imports are relative — no `@` path alias is configured.
