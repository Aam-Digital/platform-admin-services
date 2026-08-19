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
      repo.findOneBy.mockResolvedValue(active());
      repo.save.mockImplementation((i) => Promise.resolve(i as Instance));

      const result = await service.setStatus(
        "some-org",
        "inactive",
        "some-org",
        "1.2.3.4",
      );

      expect(result.status).toBe("inactive");
      expect(repo.save).toHaveBeenCalledWith(
        expect.objectContaining({ name: "some-org", status: "inactive" }),
      );
    });

    it("should reject hibernating without a matching confirmation", async () => {
      repo.findOneBy.mockResolvedValue(active());

      await expect(
        service.setStatus("some-org", "inactive", "other-org", "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setStatus("some-org", "inactive", undefined, "1.2.3.4"),
      ).rejects.toThrow(BadRequestException);
      expect(repo.save).not.toHaveBeenCalled();
    });

    it("should re-activate without a confirmation", async () => {
      repo.findOneBy.mockResolvedValue(inactive());
      repo.save.mockImplementation((i) => Promise.resolve(i as Instance));

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
      const instance = { name: "some-org", status: "inactive" } as Instance;
      repo.findOneBy.mockResolvedValue(instance);

      await service.remove("some-org", "some-org", "1.2.3.4");

      expect(repo.remove).toHaveBeenCalledWith(instance);
    });

    it("should refuse to delete an active instance", async () => {
      repo.findOneBy.mockResolvedValue({
        name: "some-org",
        status: "active",
      } as Instance);

      await expect(
        service.remove("some-org", "some-org", "1.2.3.4"),
      ).rejects.toThrow(ConflictException);
      expect(repo.remove).not.toHaveBeenCalled();
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
      expect(repo.remove).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException for an unknown instance", async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.remove("no-such-org", "no-such-org", "1.2.3.4"),
      ).rejects.toThrow(NotFoundException);
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
