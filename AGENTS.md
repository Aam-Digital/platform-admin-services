# AGENTS.md

This file provides guidance to coding agents when working with code in this repository.

## Functionality

Admin backend for Aam Digital's SaaS platform. Tracks and provisions customer instances (each mapped to a subdomain like `my-org.aam-digital.app`). On instance creation, triggers the `pulumi-up-instances` workflow in `Aam-Digital/aam-cloud-infrastructure` via GitHub workflow dispatch, passing the stack name from `INFRA_STACK`.

## Architecture

NestJS REST API managing lifecycle of Aam Digital SaaS instances. PostgreSQL via TypeORM. Deployed via semantic-release on push to main.

**Modules:**
- `src/auth/` — Authentication via GitHub OIDC JWTs or Basic Auth (admin). `JwtStrategy` validates issuer, audience, and repository claim; `JwtOrBasicAuthGuard` protects admin routes.
- `src/instance/` — Core domain. Controller exposes 4 endpoints; service handles business logic; entity maps to `instances` table. `BrevoWebhookGuard` validates webhook requests by token + source IP CIDR range.
- `src/app.module.ts` — Wires Sentry (initialized first via `instrument.ts`), ConfigModule, TypeORM, throttler (30 req/60s global), and the above modules.

**Endpoints:**
- `GET /api/v1/instances` — Bearer JWT / Basic Auth (admin), lists instances
- `POST /api/v1/instances` — Bearer JWT / Basic Auth (admin), creates instance
- `GET /api/v1/instances/check/:name` — Public (rate-limited 10/min), checks name availability; returns `{ name, available, reason: 'invalid' | 'reserved' | 'taken' | null }`
- `POST /api/v1/instances/webhook/brevo` — Brevo webhook, protected by `BrevoWebhookGuard`

**Conventions:**
- Read required env vars via `configService.getOrThrow` in the constructor and store them as instance fields — fail at startup, not at runtime.

**Testing approach:**
- Unit tests mock repositories; E2E tests use in-memory SQLite and replace JWT/Brevo guards with mocks.
- No `@` TypeScript path alias is configured; imports use relative paths (see `tsconfig.json`).
