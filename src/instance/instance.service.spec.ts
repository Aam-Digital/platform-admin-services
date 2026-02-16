import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Instance } from './instance.entity';
import { InstanceService } from './instance.service';

describe('InstanceService', () => {
  let service: InstanceService;
  let repo: jest.Mocked<Repository<Instance>>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstanceService,
        {
          provide: getRepositoryToken(Instance),
          useValue: {
            find: jest.fn(),
            findOneBy: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(InstanceService);
    repo = module.get(getRepositoryToken(Instance));
  });

  describe('findAll', () => {
    it('should return all instances ordered by name', async () => {
      const instances = [{ name: 'a-org' }, { name: 'b-org' }] as Instance[];
      repo.find.mockResolvedValue(instances);

      const result = await service.findAll();

      expect(result).toEqual(instances);
      expect(repo.find).toHaveBeenCalledWith({ order: { name: 'ASC' } });
    });
  });

  describe('create', () => {
    it('should create a new instance', async () => {
      const dto = { name: 'new-org', ownerEmail: 'a@b.com' };
      const entity = { ...dto, locale: 'en-US' } as Instance;

      repo.findOneBy.mockResolvedValue(null);
      repo.create.mockReturnValue(entity);
      repo.save.mockResolvedValue(entity);

      const result = await service.create(dto);
      expect(result.name).toBe('new-org');
    });

    it('should throw ConflictException if name is taken', async () => {
      repo.findOneBy.mockResolvedValue({ name: 'taken' } as Instance);

      await expect(
        service.create({ name: 'taken', ownerEmail: 'a@b.com' }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException for reserved names', async () => {
      repo.findOneBy.mockResolvedValue(null);

      await expect(
        service.create({ name: 'admin', ownerEmail: 'a@b.com' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('checkAvailability', () => {
    it('should return available for a valid, unused name', async () => {
      repo.findOneBy.mockResolvedValue(null);
      const result = await service.checkAvailability('good-name');
      expect(result).toEqual({ name: 'good-name', available: true, reason: null });
    });

    it('should return invalid for a bad pattern', async () => {
      const result = await service.checkAvailability('-bad');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('invalid');
    });

    it('should return reserved for reserved names', async () => {
      const result = await service.checkAvailability('admin');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('reserved');
    });

    it('should return taken when name exists', async () => {
      repo.findOneBy.mockResolvedValue({ name: 'existing' } as Instance);
      const result = await service.checkAvailability('existing');
      expect(result.available).toBe(false);
      expect(result.reason).toBe('taken');
    });
  });
});
