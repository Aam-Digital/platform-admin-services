# AGENTS.md

This file provides guidance to coding agenst when working with code in this repository.

## Functionality

Admin backend for Aam Digital's SaaS platform. Tracks and provisions customer instances (each mapped to a subdomain like `my-org.aam-digital.com`). On instance creation, triggers the `pulumi-up` workflow (`stack=production`) in `Aam-Digital/aam-cloud-infrastructure` via GitHub workflow dispatch to provision the infrastructure.

## Architecture

NestJS REST API managing lifecycle of Aam Digital SaaS instances. PostgreSQL via TypeORM. Deployed via semantic-release on push to main.

**Modules:**
- `src/auth/` — JWT authentication via GitHub OIDC tokens. `JwtStrategy` validates issuer, audience, and repository claim. `JwtAuthGuard` protects routes requiring this auth.
- `src/instance/` — Core domain. Controller exposes 4 endpoints; service handles business logic; entity maps to `instances` table. `BrevoWebhookGuard` validates webhook requests by token + source IP CIDR range.
- `src/app.module.ts` — Wires Sentry (initialized first via `instrument.ts`), ConfigModule, TypeORM, throttler (30 req/60s global), and the above modules.

**Endpoints:**
- `GET /instances` — JWT-protected, lists instances
- `POST /instances` — JWT-protected, creates instance
- `GET /instances/check/:name` — Public (rate-limited 10/min), checks name availability; returns `{ name, available, reason: 'invalid' | 'reserved' | 'taken' | null }`
- `POST /webhook/brevo` — Brevo webhook, protected by `BrevoWebhookGuard`

**Testing approach:**
- Unit tests mock repositories; E2E tests use in-memory SQLite and replace JWT/Brevo guards with mocks.
- `@` path alias maps to `src/` (configured in `tsconfig.json`).
