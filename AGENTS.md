# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Functionality

Admin backend for Aam Digital's SaaS platform. Tracks and provisions customer instances (each mapped to a subdomain like `my-org.aam-digital.app`). On instance creation, triggers the `pulumi-up-instances` workflow in `Aam-Digital/aam-cloud-infrastructure` via GitHub workflow dispatch, passing the stack name from `INFRA_STACK`.

## Architecture

NestJS REST API managing lifecycle of Aam Digital SaaS instances. PostgreSQL via TypeORM. Deployed via semantic-release on push to main.

**Modules:**
- `src/auth/` — Authentication via GitHub OIDC JWTs or Basic Auth (admin). `JwtStrategy` validates issuer, audience, and repository claim; `JwtOrBasicAuthGuard` protects admin routes. `BasicAuthGuard` accepts the admin password only and protects the routes that take an instance down — a GitHub OIDC token is authorized by its `repository` claim alone, so every workflow in that repository could otherwise use them.
- `src/instance/` — Core domain. Controller exposes 6 endpoints; service handles business logic; entity maps to `instances` table. `BrevoWebhookGuard` validates webhook requests by token + source IP CIDR range.
- `src/app.module.ts` — Wires Sentry (initialized first via `instrument.ts`), ConfigModule, TypeORM, throttler (30 req/60s global), and the above modules.
- `src/common/sentry-logger.service.ts` — `SentryLogger`, the app-wide logger set in `main.ts`. Mirrors `warn`/`error` to Sentry (Nest's built-in logger bypasses `console`, so Sentry would not see them otherwise).

**Endpoints:**
- `GET /api/v1/instances` — Bearer JWT / Basic Auth (admin), lists instances; `?status=active|inactive|all`, default `active`
- `POST /api/v1/instances` — Bearer JWT / Basic Auth (admin), creates instance
- `PATCH /api/v1/instances/:name` — Basic Auth (admin), `{ status }` hibernates or re-activates
- `DELETE /api/v1/instances/:name` — Basic Auth (admin), deletes the record of a hibernated instance
- `GET /api/v1/instances/check/:name` — Public (rate-limited 10/min), checks name availability; returns `{ name, available, reason: 'invalid' | 'reserved' | 'taken' | null }`
- `POST /api/v1/instances/webhook/brevo` — Brevo webhook, protected by `BrevoWebhookGuard`

**Instance lifecycle:**
- `GET /instances` is the deployment manifest the infrastructure reads, and it defaults to the `active` instances. Anything missing from it is destroyed on the next deployment, so a query that returns too few rows destroys systems — hence the `status` filter is validated and the DB column is `NOT NULL DEFAULT 'active'` with a `CHECK` constraint, in the migration *and* on the entity.
- `inactive` means hibernated: namespace, Keycloak realm and database volume claim go away on the next deployment, the record and the name stay. The volume itself is retained by the cluster, but nothing restores an instance from it — re-activating provisions an empty one.
- Deleting requires the instance to be `inactive` already, so the step that takes a system down is always the reversible one, and it is not the same request. Deleting triggers no deployment: an inactive instance is out of the manifest already.
- Both destructive routes require `?confirm=<name>` repeating the path name. Valid credentials do not establish that the caller meant *this* instance.
- Lifecycle writes are conditional on the status that was read (`update`/`delete` with a status predicate, checking `affected`), never `save`/`remove` on the loaded entity. A concurrent re-activation would otherwise slip an active instance past the "must be hibernated" check. A row lock would do too, but `better-sqlite3` in the e2e tests does not support one.

**Conventions:**
- Read required env vars via `configService.getOrThrow` in the constructor and store them as instance fields — fail at startup, not at runtime.
- Keep log messages constant, passing variable parts as an object param — `logger.warn("rejected request from IP", { clientIp })`, never interpolation. Sentry groups on the message, so interpolated values fragment one problem into an issue per value.
- Report failures by logging an `Error` (wrapping the cause) as the message, so Sentry gets a stack trace. Don't add a `Sentry.captureException` alongside — `SentryLogger` already sends it.
- Log taking an instance down (and putting it back up) at `warn`, with the client IP, so it reaches Sentry as an audit trail. The admin password is shared, so the IP is the only thing that distinguishes one caller from another.
- Migrations are registered as an explicit array in `app.module.ts` — adding the file is not enough. `data-source.ts` (the `migration:*` scripts) globs the TypeScript sources instead, because it runs under ts-node.

**Testing approach:**
- Unit tests mock repositories; E2E tests use in-memory SQLite and replace the auth and Brevo guards with mocks.
- No `@` TypeScript path alias is configured; imports use relative paths (see `tsconfig.json`).
