# Aam Digital Admin API

NestJS API for managing Aam Digital SaaS instances.

## API Use

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/v1/instances` | Bearer JWT / Basic Auth (admin) | List instances (active ones by default) |
| `POST` | `/api/v1/instances` | Bearer JWT / Basic Auth (admin) | Create a new instance |
| `PATCH` | `/api/v1/instances/:name` | Basic Auth (admin) | Hibernate or re-activate an instance |
| `DELETE` | `/api/v1/instances/:name` | Basic Auth (admin) | Delete a hibernated instance's record |
| `POST` | `/api/v1/instances/webhook/brevo` | Token + IP whitelist | Brevo webhook to create instance |
| `GET` | `/api/v1/instances/check/:name` | Public (rate-limited) | Check name availability |

For API specs refer to the OpenAPI docs (generated at runtime) available at `/api/docs`.

### Shutting an instance down

`GET /api/v1/instances` is the manifest the
[cluster deployment](https://github.com/Aam-Digital/aam-cloud-infrastructure/tree/main/infra/aam-digital-instances)
reads: it provisions what the response lists and destroys what it does not. So
taking a system down means taking it out of that response, and the two ways to
do that differ in what is kept.

This only reaches the cluster on the stacks that actually read the manifest —
production does not yet, so there a status change is recorded here and nothing
else happens.

**Hibernate** — the instance leaves the manifest, its record and its name stay:

```bash
curl -u "admin:$ADMIN_PASSWORD" -X PATCH \
  "https://admin.$DOMAIN/api/v1/instances/my-org?confirm=my-org" \
  -H 'content-type: application/json' -d '{"status":"inactive"}'
```

The next deployment (dispatched automatically) removes the instance's
namespace, its Keycloak realm and its database volume claim. The CouchDB volume
itself is retained by the cluster, and so are its backups — but nothing
restores an instance from them, so re-activating with `{"status":"active"}`
provisions an *empty* instance. Use `?status=all` on `GET` to see hibernated
instances; they keep their name reserved and `check/:name` keeps reporting it
as taken.

**Delete** — the record goes and the name is freed:

```bash
curl -u "admin:$ADMIN_PASSWORD" -X DELETE \
  "https://admin.$DOMAIN/api/v1/instances/my-org?confirm=my-org"
```

Only an instance that is already hibernated can be deleted, and no deployment
is triggered: it is out of the manifest already, so there is nothing left in
the cluster to remove. **This does not erase the data.** The retained volume and
its backups have to be purged in the cluster.

Creating an instance under a freed name does not bring the old one back: the
retained volume is `Released` and is never bound again, so the new instance
starts empty and the old volume stays orphaned until someone removes it.

Both calls take the admin password only — deliberately not the GitHub OIDC
token the other admin routes also accept, which is authorized by its repository
claim alone — and both require `confirm` to repeat the instance name, because
valid credentials do not establish that the caller meant this particular
instance. Both are logged at `warn` with the client IP and therefore land in
Sentry.

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
