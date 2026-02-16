import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { AvailabilityCheckDto, CreateInstanceDto } from "./dto";
import { INSTANCE_NAME_PATTERN } from "./dto/create-instance.dto";
import { Instance } from "./instance.entity";

/** Names that must not be used as instance subdomains. */
const RESERVED_NAMES = new Set([
  "www",
  "admin",
  "aam",
  "api",
  "app",
  "mail",
  "smtp",
  "ftp",
  "dev",
  "staging",
  "demo",
  "test",
  "status",
]);

@Injectable()
export class InstanceService {
  private readonly logger = new Logger(InstanceService.name);

  constructor(
    @InjectRepository(Instance)
    private readonly instanceRepo: Repository<Instance>,
  ) {}

  async findAll(): Promise<Instance[]> {
    return this.instanceRepo.find({ order: { name: "ASC" } });
  }

  async create(dto: CreateInstanceDto): Promise<Instance> {
    const availability = await this.checkAvailability(dto.name);
    if (!availability.available) {
      switch (availability.reason) {
        case "reserved":
          throw new ConflictException(
            `Instance name "${dto.name}" is reserved.`,
          );
        case "taken":
          throw new ConflictException(
            `Instance name "${dto.name}" is already taken.`,
          );
        default:
          throw new BadRequestException(
            `Instance name "${dto.name}" is invalid.`,
          );
      }
    }

    const instance = this.instanceRepo.create({
      name: dto.name,
      ownerEmail: dto.ownerEmail,
      locale: dto.locale ?? "en-US",
    });

    const saved = await this.instanceRepo.save(instance);
    this.logger.log(`Instance "${saved.name}" created for ${saved.ownerEmail}`);
    return saved;
  }

  async checkAvailability(name: string): Promise<AvailabilityCheckDto> {
    if (!INSTANCE_NAME_PATTERN.test(name)) {
      return { name, available: false, reason: "invalid" };
    }

    if (RESERVED_NAMES.has(name)) {
      return { name, available: false, reason: "reserved" };
    }

    const existing = await this.instanceRepo.findOneBy({ name });
    if (existing) {
      return { name, available: false, reason: "taken" };
    }

    return { name, available: true, reason: null };
  }
}
