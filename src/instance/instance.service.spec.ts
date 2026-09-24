import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { IsNull, Repository } from "typeorm";
import { Instance } from "./instance.entity";
import { InstanceService } from "./instance.service";

describe("InstanceService", () => {
  let service: InstanceService;
  let repo: jest.Mocked<Repository<Instance>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({ GITHUB_API_TOKEN: "test-token", INFRA_STACK: "test" }),
          ],
        }),
      ],
      providers: [
        InstanceService,
        {
          provide: getRepositoryToken(Instance),
          useValue: {
            find: jest.fn(),
            findOneBy: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            remove: jest.fn(),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
      ],
    }).compile();

    service = module.get(InstanceService);
    repo = module.get(getRepositoryToken(Instance));
  });

  describe("findAll", () => {
    it("should return only the active instances by default", async () => {
      const instances = [{ name: "a-org" }, { name: "b-org" }] as Instance[];
      repo.find.mockResolvedValue(instances);

      const result = await service.findAll();

      expect(result).toEqual(instances);
      expect(repo.find).toHaveBeenCalledWith({
        where: { status: "active" },
        order: { name: "ASC" },
      });
    });

    it("should filter by the requested status", async () => {
      repo.find.mockResolvedValue([]);

      await service.findAll("inactive");

      expect(repo.find).toHaveBeenCalledWith({
        where: { status: "inactive" },
        order: { name: "ASC" },
      });
    });

    it('should not filter for status "all"', async () => {
      repo.find.mockResolvedValue([]);

      await service.findAll("all");

      expect(repo.find).toHaveBeenCalledWith({
        where: {},
        order: { name: "ASC" },
      });
    });
  });

  describe("hibernate / activate", () => {
    const active = () => ({ name: "some-org", status: "active" }) as Instance;
    const inactive = () =>
      ({ name: "some-org", status: "inactive" }) as Instance;

    it("should hibernate a confirmed instance", async () => {
      repo.findOneBy.mockResolvedValueOnce(active()).mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);

      const result = await service.hibernate("some-org", "some-org");

      expect(result.status).toBe("inactive");
      // guarded by the status that was read, so a concurrent change loses
      expect(repo.update).toHaveBeenCalledWith(
        { name: "some-org", status: "active" },
        { status: "inactive" },
      );
    });

    it("should activate a confirmed instance", async () => {
      repo.findOneBy.mockResolvedValueOnce(inactive()).mockResolvedValue({
        name: "some-org",
        status: "active",
      } as Instance);

      const result = await service.activate("some-org", "some-org");

      expect(result.status).toBe("active");
    });

    it("should report a conflict when the status changed under the request", async () => {
      repo.findOneBy.mockResolvedValue(active());
      repo.update.mockResolvedValue({
        affected: 0,
        raw: {},
        generatedMaps: [],
      });

      await expect(service.hibernate("some-org", "some-org")).rejects.toThrow(
        ConflictException,
      );
    });

    it("should reject hibernating without a matching confirmation", async () => {
      repo.findOneBy.mockResolvedValue(active());

      await expect(service.hibernate("some-org", "other-org")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.hibernate("some-org", undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should reject activating without a matching confirmation", async () => {
      // Activating is not the harmless direction it looks like: aimed at the
      // wrong hibernated instance it brings an empty system up under that name.
      repo.findOneBy.mockResolvedValue(inactive());

      await expect(service.activate("some-org", "other-org")).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.activate("some-org", undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should require confirmation even when the status is already the requested one", async () => {
      // The no-op shortcut must not become a way past the check, or a script
      // pointed at the wrong instance gets a 200 for it.
      repo.findOneBy.mockResolvedValue(active());

      await expect(service.activate("some-org", undefined)).rejects.toThrow(
        BadRequestException,
      );
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.hibernate("no-such-org", "no-such-org"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("remove", () => {
    it("should delete an inactive, confirmed instance", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);

      await service.remove("some-org", "some-org");

      // conditional on the instance still being inactive at delete time
      expect(repo.delete).toHaveBeenCalledWith({
        name: "some-org",
        status: "inactive",
      });
    });

    it("should report a conflict when it is re-activated under the request", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);
      repo.delete.mockResolvedValue({ affected: 0, raw: {} });

      await expect(service.remove("some-org", "some-org")).rejects.toThrow(
        ConflictException,
      );
    });

    it("should refuse to delete an active instance", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "active",
      } as Instance);

      await expect(service.remove("some-org", "some-org")).rejects.toThrow(
        ConflictException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("should reject a missing or mismatched confirmation", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);

      await expect(service.remove("some-org", undefined)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.remove("some-org", "other-org")).rejects.toThrow(
        BadRequestException,
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.remove("no-such-org", "no-such-org"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("updateAppConfig", () => {
    const existing = {
      name: "my-org",
      mode: "standard",
      appConfigOverride: null,
    } as Instance;

    it("should set the mode", async () => {
      repo.findOneBy
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce({ ...existing, mode: "demo" } as Instance);

      const result = await service.updateAppConfig(
        "my-org",
        { mode: "demo" },
        "my-org",
      );

      expect(repo.update).toHaveBeenCalledWith(
        { name: "my-org" },
        { mode: "demo" },
      );
      expect(result.mode).toBe("demo");
    });

    it("should store the overrides as given", async () => {
      const override = { webmaster_email: "it@example.org", nested: { a: 1 } };
      repo.findOneBy.mockResolvedValueOnce(existing).mockResolvedValueOnce({
        ...existing,
        appConfigOverride: override,
      } as Instance);

      const result = await service.updateAppConfig(
        "my-org",
        { appConfigOverride: override },
        "my-org",
      );

      expect(repo.update).toHaveBeenCalledWith(
        { name: "my-org" },
        { appConfigOverride: override },
      );
      expect(result.appConfigOverride).toEqual(override);
    });

    it("should leave a field out of the update when it is absent", async () => {
      repo.findOneBy
        .mockResolvedValueOnce({
          ...existing,
          appConfigOverride: { keep: true },
        } as Instance)
        .mockResolvedValueOnce({
          ...existing,
          mode: "demo",
          appConfigOverride: { keep: true },
        } as Instance);

      await service.updateAppConfig("my-org", { mode: "demo" }, "my-org");

      // The exact-equality check above already proves appConfigOverride is
      // left out of the SQL update, so `repo.update` never touches that
      // column — mocked here, so it can't show the column surviving in a
      // real row; "should change the mode without touching the overrides"
      // in instances.e2e-spec.ts does that against a real (SQLite) table.
      expect(repo.update).toHaveBeenCalledWith(
        { name: "my-org" },
        { mode: "demo" },
      );
    });

    it("should unset the overrides for an explicit null", async () => {
      repo.findOneBy
        .mockResolvedValueOnce({
          ...existing,
          appConfigOverride: { gone: true },
        } as Instance)
        .mockResolvedValueOnce(existing);

      await service.updateAppConfig(
        "my-org",
        { appConfigOverride: null },
        "my-org",
      );

      expect(repo.update).toHaveBeenCalledWith(
        { name: "my-org" },
        { appConfigOverride: null },
      );
    });

    it("should not deploy for a mode that is already set", async () => {
      repo.findOneBy.mockResolvedValue(existing);

      const result = await service.updateAppConfig(
        "my-org",
        { mode: "standard" },
        "my-org",
      );

      expect(result).toBe(existing);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should reject a body that changes nothing", async () => {
      repo.findOneBy.mockResolvedValue(existing);

      await expect(
        service.updateAppConfig("my-org", {}, "my-org"),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should require confirm to repeat the name, for every change", async () => {
      repo.findOneBy.mockResolvedValue(existing);

      await expect(
        service.updateAppConfig("my-org", { mode: "standard" }, undefined),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateAppConfig(
          "my-org",
          { appConfigOverride: null },
          "other-org",
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateAppConfig("nope", { mode: "demo" }, "nope"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when the row went away", async () => {
      repo.findOneBy.mockResolvedValue(existing);
      repo.update.mockResolvedValue({ affected: 0 } as never);

      await expect(
        service.updateAppConfig("my-org", { mode: "demo" }, "my-org"),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("updateStorage", () => {
    function givenStored(storageLimit: string | null): Instance {
      const instance = { name: "my-org", storageLimit } as Instance;
      repo.findOneBy.mockResolvedValue(instance);
      return instance;
    }

    it.each([
      // stored, requested
      [null, "5Gi"],
      ["1Gi", "5Gi"],
      [null, "100Gi"], // exactly the default maximum
    ])(
      "should write %p → %p, conditional on the stored value",
      async (stored, requested) => {
        givenStored(stored);

        await service.updateStorage("my-org", requested, "my-org");

        expect(repo.update).toHaveBeenCalledWith(
          { name: "my-org", storageLimit: stored ?? IsNull() },
          { storageLimit: requested },
        );
      },
    );

    it("should return the re-read row, not the pre-update one", async () => {
      const reread = { name: "my-org", storageLimit: "5Gi" } as Instance;
      // the first read is the stored row, the second the re-read after writing
      repo.findOneBy
        .mockResolvedValueOnce({
          name: "my-org",
          storageLimit: null,
        } as Instance)
        .mockResolvedValueOnce(reread);

      const result = await service.updateStorage("my-org", "5Gi", "my-org");

      expect(result).toBe(reread);
    });

    it.each(["1Gi", "1024Mi"])(
      "should not deploy for %p when 1Gi is stored",
      async (requested) => {
        const stored = givenStored("1Gi");

        const result = await service.updateStorage(
          "my-org",
          requested,
          "my-org",
        );

        expect(result).toBe(stored);
        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it.each([
      // stored, requested
      ["5Gi", "1Gi"], // smaller
      ["5Gi", "4096Mi"], // smaller, in another unit
      [null, "101Gi"], // above the maximum
      [null, "102401Mi"],
      [null, "1Ti"],
    ])("should reject %p → %p", async (stored, requested) => {
      givenStored(stored);

      await expect(
        service.updateStorage("my-org", requested, "my-org"),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it.each([undefined, "other-org"])(
      "should reject confirm=%p",
      async (confirm) => {
        givenStored(null);

        await expect(
          service.updateStorage("my-org", "5Gi", confirm),
        ).rejects.toThrow(BadRequestException);
        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateStorage("nope", "5Gi", "nope"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when the row changed or went away", async () => {
      givenStored(null);
      repo.update.mockResolvedValue({ affected: 0 } as never);

      await expect(
        service.updateStorage("my-org", "5Gi", "my-org"),
      ).rejects.toThrow(ConflictException);
    });

    describe("MAX_STORAGE_LIMIT", () => {
      const withMax = (max: string) =>
        new InstanceService(
          repo,
          new ConfigService({ INFRA_STACK: "test", MAX_STORAGE_LIMIT: max }),
        );

      it("should apply a configured maximum", async () => {
        givenStored(null);

        await expect(
          withMax("10Gi").updateStorage("my-org", "11Gi", "my-org"),
        ).rejects.toThrow(BadRequestException);
      });

      it("should refuse to start with a malformed value", () => {
        expect(() => withMax("10GB")).toThrow("MAX_STORAGE_LIMIT");
      });
    });
  });

  describe("updateVersion", () => {
    function givenStored(version: string | null): Instance {
      const instance = { name: "my-org", version } as Instance;
      repo.findOneBy.mockResolvedValue(instance);
      return instance;
    }

    it.each([
      // stored, requested
      [null, "stable"],
      ["stable", "3.52.0"],
      ["master", null], // unset
    ])("should write %p → %p", async (stored, requested) => {
      givenStored(stored);

      await service.updateVersion("my-org", requested, "my-org");

      expect(repo.update).toHaveBeenCalledWith(
        { name: "my-org" },
        { version: requested },
      );
    });

    it.each([null, "stable"])(
      "should not deploy for %p when it is already stored",
      async (version) => {
        const stored = givenStored(version);

        const result = await service.updateVersion("my-org", version, "my-org");

        expect(result).toBe(stored);
        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it.each([undefined, "other-org"])(
      "should reject confirm=%p",
      async (confirm) => {
        givenStored(null);

        await expect(
          service.updateVersion("my-org", "stable", confirm),
        ).rejects.toThrow(BadRequestException);
        expect(repo.update).not.toHaveBeenCalled();
      },
    );

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateVersion("nope", "stable", "nope"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when the row went away", async () => {
      givenStored(null);
      repo.update.mockResolvedValue({ affected: 0 } as never);

      await expect(
        service.updateVersion("my-org", "stable", "my-org"),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe("create", () => {
    it("should create a new instance", async () => {
      const dto = { name: "new-org", ownerEmail: "a@b.com" };
      const entity = { ...dto, locale: "en-US" } as Instance;

      repo.findOneBy.mockResolvedValue(null);
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      const result = await service.create(dto);
      expect(result.name).toBe("new-org");
    });

    it("should default to the standard mode and no overrides", async () => {
      const dto = { name: "new-org", ownerEmail: "a@b.com" };
      const entity = { ...dto, locale: "en-US" } as Instance;

      repo.findOneBy.mockResolvedValue(null);
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      await service.create(dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "standard", appConfigOverride: null }),
      );
    });

    it("should create a demo instance when the mode asks for it", async () => {
      const dto = {
        name: "new-org",
        ownerEmail: "a@b.com",
        mode: "demo",
      } as const;
      const entity = { ...dto, locale: "en-US" } as Instance;

      repo.findOneBy.mockResolvedValue(null);
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      await service.create(dto);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ mode: "demo" }),
      );
    });

    it("should throw ConflictException if name is taken", async () => {
      repo.findOneBy.mockResolvedValue({ name: "taken" } as Instance);

      await expect(
        service.create({ name: "taken", ownerEmail: "a@b.com" }),
      ).rejects.toThrow(ConflictException);
    });

    it("should throw ConflictException for reserved names", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ name: "admin", ownerEmail: "a@b.com" }),
      ).rejects.toThrow(ConflictException);
    });

    it("should store alternative hostnames without duplicates", async () => {
      const entity = { name: "new-org" } as Instance;
      repo.findOneBy.mockResolvedValue(null);
      repo.find.mockResolvedValue([]);
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      await service.create({
        name: "new-org",
        ownerEmail: "a@b.com",
        alternativeHostnames: [
          "new-org.aam-digital.com",
          "new-org.aam-digital.com",
        ],
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          alternativeHostnames: ["new-org.aam-digital.com"],
        }),
      );
    });

    it("should throw ConflictException if another instance claims the hostname", async () => {
      repo.findOneBy.mockResolvedValue(null);
      repo.find.mockResolvedValue([
        {
          name: "other-org",
          alternativeHostnames: ["shared.example.org"],
        } as Instance,
      ]);

      await expect(
        service.create({
          name: "new-org",
          ownerEmail: "a@b.com",
          alternativeHostnames: ["shared.example.org"],
        }),
      ).rejects.toThrow(ConflictException);
    });

    // The platform's own instances. Without this the API accepts the name and
    // the deployment then fails the apply for every instance, not just this one.
    it.each(["demo", "preview"])(
      "should reject the platform instance name %s",
      async (name) => {
        repo.findOneBy.mockResolvedValue(null);

        await expect(
          service.create({ name, ownerEmail: "a@b.com" }),
        ).rejects.toThrow(ConflictException);
      },
    );
  });

  describe("checkAvailability", () => {
    it("should return available for a valid, unused name", async () => {
      repo.findOneBy.mockResolvedValue(null);
      const result = await service.checkAvailability("good-name");
      expect(result).toEqual({
        name: "good-name",
        available: true,
        reason: null,
      });
    });

    it("should return invalid for a bad pattern", async () => {
      const result = await service.checkAvailability("-bad");
      expect(result.available).toBe(false);
      expect(result.reason).toBe("invalid");
    });

    it("should return reserved for reserved names", async () => {
      const result = await service.checkAvailability("admin");
      expect(result.available).toBe(false);
      expect(result.reason).toBe("reserved");
    });

    it("should return taken when name exists", async () => {
      repo.findOneBy.mockResolvedValue({ name: "existing" } as Instance);
      const result = await service.checkAvailability("existing");
      expect(result.available).toBe(false);
      expect(result.reason).toBe("taken");
    });
  });
});
