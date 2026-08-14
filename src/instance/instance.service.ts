import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
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

const GITHUB_ORG_NAME = "Aam-Digital";
const GITHUB_INFRA_REPO = "aam-cloud-infrastructure";

@Injectable()
export class InstanceService implements OnModuleInit {
  private readonly logger = new Logger(InstanceService.name);
  private readonly infraStack: string;
  private octokit: Octokit | null = null;

  constructor(
    @InjectRepository(Instance)
    private readonly instanceRepo: Repository<Instance>,
    private readonly configService: ConfigService,
  ) {
    this.infraStack = this.configService.getOrThrow<string>("INFRA_STACK");
  }

  async onModuleInit(): Promise<void> {
    const appId = this.configService.get<string>("GITHUB_APP_ID");
    const privateKey = this.configService.get<string>("GITHUB_APP_PRIVATE_KEY");

    if (!appId || !privateKey) {
      if (this.configService.get<string>("NODE_ENV") !== "development") {
        throw new Error(
          "GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY are required in non-development environments",
        );
      }
      this.logger.warn(
        "GitHub App not configured — workflow dispatch disabled",
      );
      return;
    }

    const appOctokit = new Octokit({
      authStrategy: createAppAuth,
      auth: { appId, privateKey: privateKey.replace(/\\n/g, "\n") },
    });

    const { data: installation } =
      await appOctokit.rest.apps.getRepoInstallation({
        owner: GITHUB_ORG_NAME,
        repo: GITHUB_INFRA_REPO,
      });

    this.octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey: privateKey.replace(/\\n/g, "\n"),
        installationId: installation.id,
      },
    });
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
    this.logger.log("Instance created", {
      name: saved.name,
      ownerEmail: saved.ownerEmail,
    });

    this.dispatchInstanceDeployment().catch((err: unknown) => {
      // pass the wrapping Error (not `err`) as the message, so Sentry groups
      // on the constant text rather than on the varying cause; `cause` is
      // still reported through Sentry's linked-errors handling.
      this.logger.error(
        new Error("Failed to dispatch GitHub workflow", { cause: err }),
        { instance: saved.name },
      );
    });

    return saved;
  }

  private async dispatchInstanceDeployment(): Promise<void> {
    if (!this.octokit) {
      this.logger.log("Workflow trigger skipped (GitHub App not configured)");
      return;
    }

    try {
      await this.octokit.rest.actions.createWorkflowDispatch({
        owner: GITHUB_ORG_NAME,
        repo: GITHUB_INFRA_REPO,
        workflow_id: "pulumi-up-instances.yaml",
        ref: "main",
        inputs: { stack: this.infraStack },
      });
    } catch (e) {
      throw new Error('Failed to trigger workflow "pulumi-up-instances.yaml"', {
        cause: e,
      });
    }

    this.logger.log("Triggered pulumi-up-instances workflow");
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
