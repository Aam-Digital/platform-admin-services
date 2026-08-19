import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { getRepositoryToken } from "@nestjs/typeorm";
import { Repository } from "typeorm";
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

  describe("setStatus", () => {
    const active = () => ({ name: "some-org", status: "active" }) as Instance;
    const inactive = () =>
      ({ name: "some-org", status: "inactive" }) as Instance;

    it("should hibernate a confirmed instance", async () => {
      repo.findOneBy.mockResolvedValueOnce(active()).mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);

      const result = await service.setStatus(
        "some-org",
        "inactive",
        "some-org",
        "1.2.3.4",
      );

      expect(result.status).toBe("inactive");
      // guarded by the status that was read, so a concurrent change loses
      expect(repo.update).toHaveBeenCalledWith(
        { name: "some-org", status: "active" },
        { status: "inactive" },
      );
    });

    it("should report a conflict when the status changed under the request", async () => {
      repo.findOneBy.mockResolvedValue(active());
      repo.update.mockResolvedValue({
        affected: 0,
        raw: {},
        generatedMaps: [],
      });

      await expect(
        service.setStatus("some-org", "inactive", "some-org", "1.2.3.4"),
      ).rejects.toThrow(ConflictException);
    });

    it("should reject hibernating without a matching confirmation", async () => {
      repo.findOneBy.mockResolvedValue(active());

      await expect(
        service.setStatus("some-org", "inactive", "other-org", "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setStatus("some-org", "inactive", undefined, "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should re-activate without a confirmation", async () => {
      repo.findOneBy.mockResolvedValueOnce(inactive()).mockResolvedValue({
        name: "some-org",
        status: "active",
      } as Instance);

      const result = await service.setStatus(
        "some-org",
        "active",
        undefined,
        "1.2.3.4",
      );

      expect(result.status).toBe("active");
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.setStatus("no-such-org", "inactive", "no-such-org", "1.2.3.4"),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("remove", () => {
    it("should delete an inactive, confirmed instance", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);

      await service.remove("some-org", "some-org", "1.2.3.4");

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

      await expect(
        service.remove("some-org", "some-org", "1.2.3.4"),
      ).rejects.toThrow(ConflictException);
    });

    it("should refuse to delete an active instance", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "active",
      } as Instance);

      await expect(
        service.remove("some-org", "some-org", "1.2.3.4"),
      ).rejects.toThrow(ConflictException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("should reject a missing or mismatched confirmation", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "inactive",
      } as Instance);

      await expect(
        service.remove("some-org", undefined, "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.remove("some-org", "other-org", "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.remove("no-such-org", "no-such-org", "1.2.3.4"),
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
        "1.2.3.4",
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
        "1.2.3.4",
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

      await service.updateAppConfig(
        "my-org",
        { mode: "demo" },
        "my-org",
        "1.2.3.4",
      );

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
        "1.2.3.4",
      );

      expect(repo.update).toHaveBeenCalledWith(
        { name: "my-org" },
        { appConfigOverride: null },
      );
    });

    it("should reject a body that changes nothing", async () => {
      repo.findOneBy.mockResolvedValue(existing);

      await expect(
        service.updateAppConfig("my-org", {}, "my-org", "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should require confirm to repeat the name, for every change", async () => {
      repo.findOneBy.mockResolvedValue(existing);

      await expect(
        service.updateAppConfig(
          "my-org",
          { mode: "standard" },
          undefined,
          "1.2.3.4",
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateAppConfig(
          "my-org",
          { appConfigOverride: null },
          "other-org",
          "1.2.3.4",
        ),
      ).rejects.toThrow(BadRequestException);
      expect(repo.update).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.updateAppConfig("nope", { mode: "demo" }, "nope", "1.2.3.4"),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw ConflictException when the row went away", async () => {
      repo.findOneBy.mockResolvedValue(existing);
      repo.update.mockResolvedValue({ affected: 0 } as never);

      await expect(
        service.updateAppConfig(
          "my-org",
          { mode: "demo" },
          "my-org",
          "1.2.3.4",
        ),
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
