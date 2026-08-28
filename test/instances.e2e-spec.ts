jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule, getRepositoryToken } from "@nestjs/typeorm";
import { Octokit } from "@octokit/rest";
import request from "supertest";
import { Repository } from "typeorm";
import { Instance } from "../src/instance/instance.entity";
import { InstanceModule } from "../src/instance/instance.module";

/**
 * E2E tests for the /api/v1/instances endpoints.
 *
 * Uses an in-memory SQLite database so no external services are needed.
 * Auth guards are overridden: JwtAuthGuard always passes,
 * BrevoWebhookGuard validates only the `token` query param.
 */

// ── Stub guards ────────────────────────────────────────────────────────

import { CanActivate, ExecutionContext } from "@nestjs/common";

/** Always allows access – replaces the real JWT guard. */
class MockJwtAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

/** Validates only `?token=test-token` – replaces the real Brevo guard. */
class MockBrevoWebhookGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    return req.query?.token === "test-token";
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

const VALID_INSTANCE = {
  name: "my-org",
  ownerEmail: "admin@example.com",
};

const VALID_BREVO_PAYLOAD = {
  email: "brevo-user@example.com",
  attributes: { AAM_SYSTEM: "brevo-org" },
};

// ── Test suite ─────────────────────────────────────────────────────────

describe("Instances (e2e)", () => {
  let app: INestApplication;
  let mockDispatch: jest.Mock;

  beforeAll(async () => {
    mockDispatch = jest.fn().mockResolvedValue({});

    jest.mocked(Octokit).mockImplementation(
      () =>
        ({
          rest: {
            apps: {
              getRepoInstallation: jest
                .fn()
                .mockResolvedValue({ data: { id: 123 } }),
            },
            actions: { createWorkflowDispatch: mockDispatch },
          },
        }) as unknown as Octokit,
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          // Provide minimal config so guards/strategies don't blow up
          load: [
            () => ({
              BREVO_WEBHOOK_TOKEN: "test-token",
              BREVO_ALLOWED_IPS: "",
              GITHUB_OIDC_AUDIENCE: "test",
              GITHUB_REPOSITORY: "test/test",
              GITHUB_APP_ID: "123",
              GITHUB_APP_PRIVATE_KEY: "fake-key",
              INFRA_STACK: "test",
            }),
          ],
        }),
        TypeOrmModule.forRoot({
          type: "better-sqlite3",
          database: ":memory:",
          entities: [Instance],
          synchronize: true,
        }),
        InstanceModule,
      ],
    })
      .overrideGuard(
        await import("../src/auth/jwt-or-basic-auth.guard").then(
          (m) => m.JwtOrBasicAuthGuard,
        ),
      )
      .useClass(MockJwtAuthGuard)
      .overrideGuard(
        await import("../src/auth/basic-auth.guard").then(
          (m) => m.BasicAuthGuard,
        ),
      )
      .useClass(MockJwtAuthGuard)
      .overrideGuard(
        await import("../src/instance/guards/brevo-webhook.guard").then(
          (m) => m.BrevoWebhookGuard,
        ),
      )
      .useClass(MockBrevoWebhookGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api/v1");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/v1/instances
  // ────────────────────────────────────────────────────────────────────

  describe("GET /api/v1/instances", () => {
    it("should return an empty array initially", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual([]);
        });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/v1/instances
  // ────────────────────────────────────────────────────────────────────

  describe("POST /api/v1/instances", () => {
    afterEach(() => {
      mockDispatch.mockClear();
    });

    it("should dispatch the GitHub workflow on instance creation", async () => {
      await request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name: "dispatch-org", ownerEmail: "dispatch@example.com" })
        .expect(201);

      await new Promise(setImmediate);

      expect(mockDispatch).toHaveBeenCalledWith({
        owner: "Aam-Digital",
        repo: "aam-cloud-infrastructure",
        workflow_id: "pulumi-up-instances.yaml",
        ref: "main",
        inputs: { stack: "test" },
      });
    });

    it("should create a new instance", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send(VALID_INSTANCE)
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            name: "my-org",
            ownerEmail: "admin@example.com",
            locale: "en-US",
          });
        });
    });

    it("should return 409 when name is already taken", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send(VALID_INSTANCE)
        .expect(409);
    });

    it("should return 409 for reserved names", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name: "admin", ownerEmail: "x@example.com" })
        .expect(409);
    });

    it("should return 400 for invalid name format", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name: "-invalid", ownerEmail: "x@example.com" })
        .expect(400);
    });

    it("should return 400 when name is missing", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ ownerEmail: "x@example.com" })
        .expect(400);
    });

    it("should return 400 when ownerEmail is invalid", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name: "valid-name", ownerEmail: "not-an-email" })
        .expect(400);
    });

    it("should return 400 for unknown properties", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ ...VALID_INSTANCE, name: "another-org", extra: "field" })
        .expect(400);
    });

    it("should accept alternative hostnames", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "hosted-org",
          ownerEmail: "hosted@example.com",
          alternativeHostnames: ["hosted-org.aam-digital.com"],
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.alternativeHostnames).toEqual([
            "hosted-org.aam-digital.com",
          ]);
        });
    });

    it("should default alternative hostnames to an empty list", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name: "plain-org", ownerEmail: "plain@example.com" })
        .expect(201)
        .expect((res) => {
          expect(res.body.alternativeHostnames).toEqual([]);
        });
    });

    it("should return 400 for a malformed alternative hostname", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "bad-host-org",
          ownerEmail: "x@example.com",
          alternativeHostnames: ["Not-Lowercase.example.org"],
        })
        .expect(400);
    });

    it("should return 409 when another instance already claims the hostname", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "second-org",
          ownerEmail: "second@example.com",
          alternativeHostnames: ["hosted-org.aam-digital.com"],
        })
        .expect(409);
    });

    it("should accept an optional locale", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "german-org",
          ownerEmail: "de@example.com",
          locale: "de-DE",
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.locale).toBe("de-DE");
        });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/v1/instances  (after data was created)
  // ────────────────────────────────────────────────────────────────────

  describe("GET /api/v1/instances (with data)", () => {
    it("should return all created instances sorted by name", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          expect(res.body.length).toBeGreaterThanOrEqual(2);
          const names = res.body.map((i: any) => i.name);
          expect(names).toEqual([...names].sort());
        });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/v1/instances/webhook/brevo
  // ────────────────────────────────────────────────────────────────────

  describe("POST /api/v1/instances/webhook/brevo", () => {
    it("should create an instance from a valid Brevo webhook", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send(VALID_BREVO_PAYLOAD)
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({
            name: "brevo-org",
            ownerEmail: "brevo-user@example.com",
            locale: "en-US",
          });
        });
    });

    it("should return 409 when Brevo webhook tries a duplicate name", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send(VALID_BREVO_PAYLOAD)
        .expect(409);
    });

    it("should reject a Brevo payload carrying alternative hostnames", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send({
          email: "x@example.com",
          attributes: { AAM_SYSTEM: "hostname-org" },
          alternativeHostnames: ["admin.aam-digital.app"],
        })
        .expect(400);
    });

    it("should reject when token is wrong", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=wrong")
        .send({
          email: "x@example.com",
          attributes: { AAM_SYSTEM: "new-sys" },
        })
        .expect(403);
    });

    it("should reject when token is missing", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo")
        .send({
          email: "x@example.com",
          attributes: { AAM_SYSTEM: "new-sys" },
        })
        .expect(403);
    });

    it("should return 400 when email is missing", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send({ attributes: { AAM_SYSTEM: "missing-email" } })
        .expect(400);
    });

    it("should return 400 when attributes.AAM_SYSTEM is missing", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send({ email: "x@example.com", attributes: {} })
        .expect(400);
    });

    it("should create a standard instance without overrides", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send({
          email: "brevo-plain@example.com",
          attributes: { AAM_SYSTEM: "brevo-plain-org" },
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.mode).toBe("standard");
          expect(res.body.appConfigOverride).toBeNull();
        });
    });

    // The webhook is authenticated by a shared token, the weakest of the create
    // paths, so it must not be able to ask for a demo instance. Two things stop
    // it, and this pins both: the controller builds the create DTO field by
    // field, and — despite the index signature on `BrevoWebhookAttributes`, which
    // has no effect on validation — an unknown attribute is rejected outright.
    it("should reject an unknown attribute rather than pass it through", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send({
          email: "brevo-mode@example.com",
          attributes: { AAM_SYSTEM: "brevo-mode-org", mode: "demo" },
        })
        .expect(400);
    });

    it("should reject any unknown attribute, not just a known field name", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances/webhook/brevo?token=test-token")
        .send({
          email: "brevo-extra@example.com",
          attributes: { AAM_SYSTEM: "brevo-extra-org", FIRSTNAME: "Ada" },
        })
        .expect(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // POST /api/v1/instances/:name/hibernate  and  /activate,
  // GET and DELETE /api/v1/instances/:name
  // ────────────────────────────────────────────────────────────────────

  describe("Instance lifecycle", () => {
    /** Created per test, so no test depends on another one's leftovers. */
    async function createInstance(name: string): Promise<void> {
      await request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name, ownerEmail: `${name}@example.com` })
        .expect(201);
    }

    async function hibernate(name: string): Promise<void> {
      await request(app.getHttpServer())
        .post(`/api/v1/instances/${name}/hibernate?confirm=${name}`)
        .expect(200);
    }

    it("should return a single instance whatever its status", async () => {
      await createInstance("single-org");

      await request(app.getHttpServer())
        .get("/api/v1/instances/single-org")
        .expect(200)
        .expect((res) => {
          expect(res.body.name).toBe("single-org");
          expect(res.body.status).toBe("active");
        });

      // unlike the manifest, this is a record lookup and does not filter
      await hibernate("single-org");
      await request(app.getHttpServer())
        .get("/api/v1/instances/single-org")
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("inactive");
        });
    });

    it("should hibernate an instance when the name is confirmed", async () => {
      await createInstance("hibernate-me");

      await request(app.getHttpServer())
        .post("/api/v1/instances/hibernate-me/hibernate?confirm=hibernate-me")
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("inactive");
        });
    });

    it("should drop a hibernated instance from the manifest but keep its name", async () => {
      await createInstance("dropped-org");
      await hibernate("dropped-org");

      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const names = res.body.map((i: any) => i.name);
          expect(names).not.toContain("dropped-org");
        });

      await request(app.getHttpServer())
        .get("/api/v1/instances?status=all")
        .expect(200)
        .expect((res) => {
          const names = res.body.map((i: any) => i.name);
          expect(names).toContain("dropped-org");
        });

      // the name stays reserved, so nobody can claim the subdomain
      await request(app.getHttpServer())
        .get("/api/v1/instances/check/dropped-org")
        .expect(200)
        .expect((res) => {
          expect(res.body.reason).toBe("taken");
        });
    });

    it("should reject an unknown status filter", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances?status=gone")
        .expect(400);
    });

    it("should reject hibernating without a matching confirmation", async () => {
      await createInstance("keep-me");

      await request(app.getHttpServer())
        .post("/api/v1/instances/keep-me/hibernate")
        .expect(400);

      await request(app.getHttpServer())
        .post("/api/v1/instances/keep-me/hibernate?confirm=other-org")
        .expect(400);

      // still in the manifest, so still deployed
      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const names = res.body.map((i: any) => i.name);
          expect(names).toContain("keep-me");
        });
    });

    it("should activate a hibernated instance when the name is confirmed", async () => {
      await createInstance("back-again");
      await hibernate("back-again");

      await request(app.getHttpServer())
        .post("/api/v1/instances/back-again/activate?confirm=back-again")
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("active");
        });
    });

    it("should reject activating without a matching confirmation", async () => {
      // Activating is confirmed too: aimed at the wrong hibernated instance it
      // brings an empty system up under that name.
      await createInstance("stay-down");
      await hibernate("stay-down");

      await request(app.getHttpServer())
        .post("/api/v1/instances/stay-down/activate")
        .expect(400);

      await request(app.getHttpServer())
        .post("/api/v1/instances/stay-down/activate?confirm=other-org")
        .expect(400);

      await request(app.getHttpServer())
        .get("/api/v1/instances/stay-down")
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("inactive");
        });
    });

    it("should treat a transition to the current status as a confirmed no-op", async () => {
      await createInstance("already-up");
      mockDispatch.mockClear();

      await request(app.getHttpServer())
        .post("/api/v1/instances/already-up/activate?confirm=already-up")
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("active");
        });

      // the dispatched workflow deploys every instance of the stack, so a
      // no-op call must not trigger one
      expect(mockDispatch).not.toHaveBeenCalled();
    });

    it("should refuse to delete an active instance", async () => {
      await createInstance("still-running");

      await request(app.getHttpServer())
        .delete("/api/v1/instances/still-running?confirm=still-running")
        .expect(409);

      await request(app.getHttpServer())
        .get("/api/v1/instances/check/still-running")
        .expect(200)
        .expect((res) => {
          expect(res.body.reason).toBe("taken");
        });
    });

    it("should reject deleting without a matching confirmation", async () => {
      await createInstance("confirm-me");
      await hibernate("confirm-me");

      await request(app.getHttpServer())
        .delete("/api/v1/instances/confirm-me")
        .expect(400);

      await request(app.getHttpServer())
        .delete("/api/v1/instances/confirm-me?confirm=other-org")
        .expect(400);
    });

    it("should delete a hibernated instance and free its name", async () => {
      await createInstance("purge-me");
      await hibernate("purge-me");

      await request(app.getHttpServer())
        .delete("/api/v1/instances/purge-me?confirm=purge-me")
        .expect(204);

      await request(app.getHttpServer())
        .get("/api/v1/instances/check/purge-me")
        .expect(200)
        .expect((res) => {
          expect(res.body.available).toBe(true);
        });
    });

    it("should return 404 for an unknown instance", async () => {
      await request(app.getHttpServer())
        .get("/api/v1/instances/no-such-org")
        .expect(404);

      await request(app.getHttpServer())
        .delete("/api/v1/instances/no-such-org?confirm=no-such-org")
        .expect(404);

      await request(app.getHttpServer())
        .post("/api/v1/instances/no-such-org/hibernate?confirm=no-such-org")
        .expect(404);

      await request(app.getHttpServer())
        .post("/api/v1/instances/no-such-org/activate?confirm=no-such-org")
        .expect(404);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/v1/instances/:name/app-config
  // ────────────────────────────────────────────────────────────────────

  describe("PATCH /api/v1/instances/:name/app-config", () => {
    async function createInstance(
      name: string,
      body: Record<string, unknown> = {},
    ): Promise<void> {
      await request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name, ownerEmail: `${name}@example.com`, ...body })
        .expect(201);
    }

    it("should default a new instance to standard mode without overrides", async () => {
      await createInstance("plain-mode-org");

      await request(app.getHttpServer())
        .get("/api/v1/instances/check/plain-mode-org")
        .expect(200);

      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const created = res.body.find(
            (i: any) => i.name === "plain-mode-org",
          );
          expect(created.mode).toBe("standard");
          expect(created.appConfigOverride).toBeNull();
        });
    });

    it("should accept a mode when creating an instance", async () => {
      await createInstance("demo-org", { mode: "demo" });

      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const created = res.body.find((i: any) => i.name === "demo-org");
          expect(created.mode).toBe("demo");
        });
    });

    it("should reject an unknown mode when creating an instance", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "bogus-mode-org",
          ownerEmail: "a@b.com",
          mode: "hibernating",
        })
        .expect(400);
    });

    it("should reject a null mode when creating an instance", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "null-mode-org",
          ownerEmail: "a@b.com",
          mode: null,
        })
        .expect(400);
    });

    // The route that creates an instance also takes a user token and serves the
    // Brevo webhook, so the raw overrides must not be reachable there. The
    // global ValidationPipe rejects the unknown property.
    it("should refuse overrides when creating an instance", () => {
      return request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({
          name: "sneaky-org",
          ownerEmail: "a@b.com",
          appConfigOverride: { session_type: "mock" },
        })
        .expect(400);
    });

    // `whitelist: true` strips properties without a validation decorator. The
    // overrides are one opaque value rather than a nested DTO, so the pipe must
    // leave their keys, at every depth, alone.
    it("should store overrides unchanged, including nested keys", async () => {
      await createInstance("override-org");
      const override = {
        webmaster_email: "it@example.org",
        site: { title: "Example", flags: [1, 2] },
      };

      await request(app.getHttpServer())
        .patch("/api/v1/instances/override-org/app-config?confirm=override-org")
        .send({ appConfigOverride: override })
        .expect(200)
        .expect((res) => {
          expect(res.body.appConfigOverride).toEqual(override);
        });

      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const found = res.body.find((i: any) => i.name === "override-org");
          expect(found.appConfigOverride).toEqual(override);
        });
    });

    it("should change the mode without touching the overrides", async () => {
      await createInstance("both-org");
      await request(app.getHttpServer())
        .patch("/api/v1/instances/both-org/app-config?confirm=both-org")
        .send({ appConfigOverride: { keep: true } })
        .expect(200);

      await request(app.getHttpServer())
        .patch("/api/v1/instances/both-org/app-config?confirm=both-org")
        .send({ mode: "demo" })
        .expect(200)
        .expect((res) => {
          expect(res.body.mode).toBe("demo");
          expect(res.body.appConfigOverride).toEqual({ keep: true });
        });
    });

    // The infrastructure does not map this mode to an app configuration yet
    // (aam-cloud-infrastructure#222), but this API already accepts and stores
    // it, same as it did for `demo` before its counterpart landed.
    it("should accept and round-trip the online mode", async () => {
      await createInstance("online-org");

      await request(app.getHttpServer())
        .patch("/api/v1/instances/online-org/app-config?confirm=online-org")
        .send({ mode: "online" })
        .expect(200)
        .expect((res) => {
          expect(res.body.mode).toBe("online");
        });

      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const found = res.body.find((i: any) => i.name === "online-org");
          expect(found.mode).toBe("online");
        });
    });

    it("should unset the overrides for an explicit null", async () => {
      await createInstance("unset-org");
      await request(app.getHttpServer())
        .patch("/api/v1/instances/unset-org/app-config?confirm=unset-org")
        .send({ appConfigOverride: { gone: true } })
        .expect(200);

      await request(app.getHttpServer())
        .patch("/api/v1/instances/unset-org/app-config?confirm=unset-org")
        .send({ appConfigOverride: null })
        .expect(200)
        .expect((res) => {
          expect(res.body.appConfigOverride).toBeNull();
        });
    });

    it("should require confirm even for a harmless change", async () => {
      await createInstance("confirm-org");

      await request(app.getHttpServer())
        .patch("/api/v1/instances/confirm-org/app-config")
        .send({ mode: "standard" })
        .expect(400);

      await request(app.getHttpServer())
        .patch("/api/v1/instances/confirm-org/app-config?confirm=other-org")
        .send({ mode: "standard" })
        .expect(400);
    });

    it("should reject a body that changes nothing", async () => {
      await createInstance("empty-body-org");

      return request(app.getHttpServer())
        .patch(
          "/api/v1/instances/empty-body-org/app-config?confirm=empty-body-org",
        )
        .send({})
        .expect(400);
    });

    it("should reject an unknown mode", async () => {
      await createInstance("bad-mode-org");

      return request(app.getHttpServer())
        .patch("/api/v1/instances/bad-mode-org/app-config?confirm=bad-mode-org")
        .send({ mode: "mock" })
        .expect(400);
    });

    it("should reject a null mode rather than write it to the row", async () => {
      await createInstance("null-mode-org");

      await request(app.getHttpServer())
        .patch(
          "/api/v1/instances/null-mode-org/app-config?confirm=null-mode-org",
        )
        .send({ mode: null })
        .expect(400);

      await request(app.getHttpServer())
        .get("/api/v1/instances")
        .expect(200)
        .expect((res) => {
          const found = res.body.find((i: any) => i.name === "null-mode-org");
          expect(found.mode).toBe("standard");
        });
    });

    it("should reject overrides that are not an object", async () => {
      await createInstance("scalar-org");

      return (
        request(app.getHttpServer())
          .patch("/api/v1/instances/scalar-org/app-config?confirm=scalar-org")
          .send({ appConfigOverride: "session_type=mock" })
          .expect(400)
          // asserted on the message, because an empty body is a 400 as well and
          // would let this pass if the pipe had silently dropped the property
          .expect((res) => {
            expect(JSON.stringify(res.body.message)).toContain(
              "appConfigOverride",
            );
          })
      );
    });

    it("should 404 for an unknown instance", () => {
      return request(app.getHttpServer())
        .patch("/api/v1/instances/no-such-org/app-config?confirm=no-such-org")
        .send({ mode: "demo" })
        .expect(404);
    });

    it("should not deploy for a mode that is already set", async () => {
      await createInstance("noop-org");
      mockDispatch.mockClear();

      await request(app.getHttpServer())
        .patch("/api/v1/instances/noop-org/app-config?confirm=noop-org")
        .send({ mode: "standard" })
        .expect(200)
        .expect((res) => {
          expect(res.body.mode).toBe("standard");
        });

      expect(mockDispatch).not.toHaveBeenCalled();
    });

    // What a value corrupted outside this API does. `simple-json` is text with a
    // `JSON.parse` on read, so it fails while the entity is hydrated, and it
    // fails for the whole response rather than for the one row: a single bad
    // value takes the manifest down for every instance. That direction is the
    // safe one for the deployment — it cannot fetch the manifest, so it destroys
    // nothing — but it is not contained, so it is worth knowing it behaves this
    // way rather than skipping the row.
    it("should fail the whole manifest on an unparseable stored override", async () => {
      await createInstance("corrupt-org");
      const repo = app.get<Repository<Instance>>(getRepositoryToken(Instance));
      await repo.query(
        `UPDATE instances SET app_config_override = 'not json' WHERE name = 'corrupt-org'`,
      );

      await request(app.getHttpServer()).get("/api/v1/instances").expect(500);

      // and recovers once the value is valid again
      await repo.query(
        `UPDATE instances SET app_config_override = NULL WHERE name = 'corrupt-org'`,
      );
      await request(app.getHttpServer()).get("/api/v1/instances").expect(200);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // GET /api/v1/instances/check/:name
  // ────────────────────────────────────────────────────────────────────

  describe("GET /api/v1/instances/check/:name", () => {
    it("should report a taken name as unavailable", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances/check/my-org")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            name: "my-org",
            available: false,
            reason: "taken",
          });
        });
    });

    it("should report a reserved name as unavailable", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances/check/admin")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            name: "admin",
            available: false,
            reason: "reserved",
          });
        });
    });

    it("should report an invalid name format", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances/check/-bad")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            name: "-bad",
            available: false,
            reason: "invalid",
          });
        });
    });

    it("should report a free name as available", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances/check/free-name")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            name: "free-name",
            available: true,
            reason: null,
          });
        });
    });

    it("should report a too-short name as invalid", () => {
      return request(app.getHttpServer())
        .get("/api/v1/instances/check/ab")
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual({
            name: "ab",
            available: false,
            reason: "invalid",
          });
        });
    });
  });
});
