import * as Sentry from "@sentry/nestjs";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
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
  private readonly githubApiToken: string | null;
  private readonly infraStack: string;

  constructor(
    @InjectRepository(Instance)
    private readonly instanceRepo: Repository<Instance>,
    private readonly configService: ConfigService,
  ) {
    this.githubApiToken =
      this.configService.get<string>("GITHUB_API_TOKEN") || null;
    this.infraStack = this.configService.getOrThrow<string>("INFRA_STACK");
  }

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

    this.dispatchInstanceDeployment().catch((err) => {
      Sentry.captureException(
        new Error("Failed to dispatch GitHub workflow", { cause: err }),
      );
      this.logger.warn(`Failed to dispatch GitHub workflow: ${err.message}`);
    });

    return saved;
  }

  private async dispatchInstanceDeployment(): Promise<void> {
    if (!this.githubApiToken) {
      this.logger.log("GITHUB_API_TOKEN not set, skipping workflow dispatch");
      return;
    }

    // https://github.com/Aam-Digital/aam-cloud-infrastructure/blob/main/.github/workflows/pulumi-up-instances.yaml
    const workflowFile = "pulumi-up-instances.yaml";
    const response = await fetch(
      `https://api.github.com/repos/Aam-Digital/aam-cloud-infrastructure/actions/workflows/${workflowFile}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.githubApiToken}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: { stack: this.infraStack },
        }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`GitHub API responded with ${response.status}: ${body}`);
    }
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
