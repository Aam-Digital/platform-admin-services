# Aam Digital Admin API

NestJS API for managing Aam Digital SaaS instances.

Each instance is a customer deployment, served on its own subdomain. This
service holds the record of which instances exist, and `GET /api/v1/instances`
is the manifest the [cluster deployment][infra] reads: it provisions what the
response lists and destroys what it does not. Creating an instance, or changing
its status, dispatches that deployment.

## API

The OpenAPI docs at `/api/docs` (Swagger UI, generated at runtime) document the
endpoints, their authentication and the effect of each operation.

### Shutting an instance down

Taking a system down means taking it out of the manifest, and the two ways to do
that differ in what is kept. **Hibernating** it keeps its record and its name.
**Deleting** it frees the name, is only allowed once it is already hibernated,
and triggers no deployment — it is out of the manifest already. Both calls take
the admin password only, and both require `confirm` to repeat the instance name —
valid credentials do not establish that the caller meant this particular
instance.

Neither call erases data and neither is reversible in practice: re-activating a
hibernated instance provisions an empty one rather than restoring it. What the
deployment tears down, what the cluster keeps, and how to purge or restore it
belong to the [cluster deployment][infra] and are documented there.

```bash
# hibernate (`{"status":"active"}` puts it back)
curl -u "admin:$ADMIN_PASSWORD" -X PATCH \
  "https://admin.$DOMAIN/api/v1/instances/my-org?confirm=my-org" \
  -H 'content-type: application/json' -d '{"status":"inactive"}'

# delete the record of a hibernated instance
curl -u "admin:$ADMIN_PASSWORD" -X DELETE \
  "https://admin.$DOMAIN/api/v1/instances/my-org?confirm=my-org"
```

### Alternative hostnames

Besides its `<name>.<cluster domain>` hostname, an instance can be served on any
number of `alternativeHostnames` — full hostnames such as
`my-org.aam-digital.com` or a domain of the organisation's own. The
infrastructure reads them from the manifest and gives each one an Ingress host
and its own certificate. A hostname only works once its DNS record points at the
cluster: until then no certificate can be issued and browsers warn about the one
they get. And because a hostname becomes routing configuration in the cluster,
it is settable by an admin through `POST /api/v1/instances` only, never through
the Brevo webhook, and one already claimed by another instance is rejected with
`409`.

### App configuration of an instance

How an instance stores its data is a `mode`, not a set of app settings:
e.g. `standard` is a regular system on its own database, `demo` runs on generated
data that is not persisted. See the API docs for all available modes.
These named modes combine into valid overall system states by the infra cluster.

Anything else is an **override**: admin-only, unset by default, stored as
given and applied on top of the mode. Changed (along with `mode`) 
through `PATCH /api/v1/instances/:name/app-config`:

---

## Setup

Environment variables are documented in [.env.example](.env.example); copy it to
`.env` for local development.

### GitHub App

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
[infra]: https://github.com/Aam-Digital/aam-cloud-infrastructure/tree/main/infra/aam-digital-instances

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
