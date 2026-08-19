jest.mock("@octokit/rest", () => ({ Octokit: jest.fn() }));

import { INestApplication, ValidationPipe } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Octokit } from "@octokit/rest";
import request from "supertest";
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
  });

  // ────────────────────────────────────────────────────────────────────
  // PATCH /api/v1/instances/:name  and  DELETE /api/v1/instances/:name
  // ────────────────────────────────────────────────────────────────────

  describe("PATCH & DELETE /api/v1/instances/:name", () => {
    /** Created per test, so no test depends on another one's leftovers. */
    async function createInstance(name: string): Promise<void> {
      await request(app.getHttpServer())
        .post("/api/v1/instances")
        .send({ name, ownerEmail: `${name}@example.com` })
        .expect(201);
    }

    async function hibernate(name: string): Promise<void> {
      await request(app.getHttpServer())
        .patch(`/api/v1/instances/${name}?confirm=${name}`)
        .send({ status: "inactive" })
        .expect(200);
    }

    it("should hibernate an instance when the name is confirmed", async () => {
      await createInstance("hibernate-me");

      await request(app.getHttpServer())
        .patch("/api/v1/instances/hibernate-me?confirm=hibernate-me")
        .send({ status: "inactive" })
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
        .patch("/api/v1/instances/keep-me")
        .send({ status: "inactive" })
        .expect(400);

      await request(app.getHttpServer())
        .patch("/api/v1/instances/keep-me?confirm=other-org")
        .send({ status: "inactive" })
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

    it("should re-activate a hibernated instance", async () => {
      await createInstance("back-again");
      await hibernate("back-again");

      await request(app.getHttpServer())
        .patch("/api/v1/instances/back-again")
        .send({ status: "active" })
        .expect(200)
        .expect((res) => {
          expect(res.body.status).toBe("active");
        });
    });

    it("should reject an unknown status", async () => {
      await createInstance("bad-status");

      return request(app.getHttpServer())
        .patch("/api/v1/instances/bad-status?confirm=bad-status")
        .send({ status: "deleted" })
        .expect(400);
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
        .delete("/api/v1/instances/no-such-org?confirm=no-such-org")
        .expect(404);

      await request(app.getHttpServer())
        .patch("/api/v1/instances/no-such-org?confirm=no-such-org")
        .send({ status: "inactive" })
        .expect(404);
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
