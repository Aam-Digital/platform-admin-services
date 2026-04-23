# Aam Digital Admin API

NestJS API for managing Aam Digital SaaS instances.

## API Use

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/instances` | Bearer JWT / Basic Auth (admin) | List all instances |
| `POST` | `/api/v1/instances` | Bearer JWT / Basic Auth (admin) | Create a new instance |
| `POST` | `/api/v1/instances/webhook/brevo` | Token + IP whitelist | Brevo webhook to create instance |
| `GET` | `/api/v1/instances/check/:name` | Public (rate-limited) | Check name availability |

For API specs refer to the OpenAPI docs (generated at runtime) available at `/api/docs`.

### Configuration

The following environment variables should be set:

- **Database**: `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- **Auth**:
  - `JWT_SECRET`
  - `ADMIN_PASSWORD` (static password for access with Basic Auth user "admin")
- **Sentry**: `SENTRY_DSN`, `SENTRY_ENVIRONMENT`
- **Brevo Webhook**: `BREVO_WEBHOOK_TOKEN`, `BREVO_ALLOWED_IPS`

---

## Development

### Getting Started

```bash
# 1. Copy environment config
cp .env.example .env

# 2. Start PostgreSQL
docker compose up -d

# 3. Install dependencies
npm install

# 4. Run in development mode
npm run start:dev
```

Swagger UI is available at `http://localhost:3000/api/docs`.

### Testing

```bash
npm test
```

### Configuration for local development

See [.env.example](.env.example) for all available environment variables
and check section above.
