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

See `.env.example` for environment variables.

### GitHub App Setup

The service authenticates with GitHub as a GitHub App to dispatch workflow runs of
[`pulumi-up-instances`][] on `Aam-Digital/aam-cloud-infrastructure`.

**Create the App** in the `Aam-Digital` org:

1. Go to **Org Settings → Developer settings → GitHub Apps → New GitHub App**
2. Set a name (e.g. `aam-platform-admin`) and the homepage URL
   <https://github.com/Aam-Digital/platform-admin-services>
3. Uncheck **Active** under Webhooks (not needed)
4. Under **Repository permissions**, set **Actions: Read and write**
5. Set **Where can this app be installed** to "Only on this account"
6. Click **Create GitHub App**

**Install the App** on the target repository:

1. In the App settings, click **Install App**
2. Install on the `Aam-Digital` org, restrict access to the `aam-cloud-infrastructure` repository

**Configure the service** (see [`.env.example`](.env.example) for all variables):

- `GITHUB_APP_ID`: numeric App ID from the [`aam-platform-admin` settings page](https://github.com/organizations/Aam-Digital/settings/apps/aam-platform-admin)
- `GITHUB_APP_PRIVATE_KEY`: generate a private key on that page and set it to the `.pem` contents

[pulumi-up-instances]: https://github.com/Aam-Digital/aam-cloud-infrastructure/blob/main/.github/workflows/pulumi-up-instances.yaml


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
