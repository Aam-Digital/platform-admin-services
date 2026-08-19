import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import {
  AvailabilityCheckDto,
  CreateInstanceDto,
  type InstanceStatusFilter,
} from "./dto";
import { INSTANCE_NAME_PATTERN } from "./dto/create-instance.dto";
import { Instance, InstanceStatus } from "./instance.entity";

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

/**
 * Raised when a lifecycle write matches no row because the instance changed
 * between being read and being written. Retrying is safe: the caller then
 * decides against what the record now says.
 */
const RACE_MESSAGE = (name: string) =>
  `Instance "${name}" was changed by another request while this one was in ` +
  `flight. Read it again and repeat the request.`;

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

  /**
   * The `active` instances are the deployment manifest the infrastructure
   * reads, so this defaults to them: an instance the caller does not see is an
   * instance the next deployment tears down.
   */
  async findAll(status: InstanceStatusFilter = "active"): Promise<Instance[]> {
    return this.instanceRepo.find({
      where: status === "all" ? {} : { status },
      order: { name: "ASC" },
    });
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

  /**
   * Activates or hibernates an instance. Hibernating removes it from the
   * manifest, so the deployment triggered here destroys its namespace, its
   * Keycloak realm and its database volume claim; the record and the name stay
   * reserved, and the underlying volume is retained by the cluster.
   *
   * @param confirm must repeat `name` when hibernating.
   */
  async setStatus(
    name: string,
    status: InstanceStatus,
    confirm: string | undefined,
    clientIp: string,
  ): Promise<Instance> {
    const instance = await this.findOneOrFail(name);

    if (status === "inactive") {
      this.assertNameConfirmed(name, confirm);
    }

    if (instance.status === status) {
      return instance;
    }

    // Conditional on the status that was read, rather than saving the entity
    // back: between the read and the write another request may have changed it
    // or deleted the row, and `save` would report success either way.
    const updated = await this.instanceRepo.update(
      { name, status: instance.status },
      { status },
    );
    if (updated.affected === 0) {
      throw new ConflictException(RACE_MESSAGE(name));
    }

    const saved = await this.findOneOrFail(name);

    // `warn` so that taking an instance down (and putting it back up) reaches
    // Sentry as an audit trail. The admin password is shared, so the client IP
    // is the only thing distinguishing one caller from another.
    this.logger.warn("Instance status changed", {
      name: saved.name,
      status: saved.status,
      clientIp,
    });

    this.dispatchInstanceDeployment().catch((err: unknown) => {
      this.logger.error(
        new Error("Failed to dispatch GitHub workflow", { cause: err }),
        { instance: saved.name },
      );
    });

    return saved;
  }

  /**
   * Deletes the record of an already hibernated instance, freeing its name.
   *
   * No deployment is triggered: an inactive instance is out of the manifest
   * already, so there is nothing left in the cluster to remove. What this does
   * not do is erase the data — the CouchDB volume was retained when the
   * instance was hibernated, and so were its backups.
   *
   * @param confirm must repeat `name`.
   */
  async remove(
    name: string,
    confirm: string | undefined,
    clientIp: string,
  ): Promise<void> {
    const instance = await this.findOneOrFail(name);
    this.assertNameConfirmed(name, confirm);

    // Deleting a running instance would take it down through the manifest,
    // with nothing left to restore it from. Hibernating first makes that step
    // its own request, and one that is reversible.
    if (instance.status !== "inactive") {
      throw new ConflictException(
        `Instance "${name}" is still active. Hibernate it first ` +
          `(PATCH /instances/${name}?confirm=${name} with { "status": "inactive" }), ` +
          `then delete it.`,
      );
    }

    // Conditional on the instance still being inactive, so the check above
    // holds at the moment of the delete and not merely when it was read — a
    // concurrent re-activation must not slip an active instance past it.
    const deleted = await this.instanceRepo.delete({
      name,
      status: "inactive",
    });
    if (deleted.affected === 0) {
      throw new ConflictException(RACE_MESSAGE(name));
    }

    this.logger.warn("Instance deleted", { name, clientIp });
  }

  private async findOneOrFail(name: string): Promise<Instance> {
    const instance = await this.instanceRepo.findOneBy({ name });
    if (!instance) {
      throw new NotFoundException(`Instance "${name}" does not exist.`);
    }
    return instance;
  }

  /**
   * Guards against a request that names the wrong instance — a mistyped
   * subdomain, a script run against the wrong stack. Valid credentials alone
   * do not establish that the caller meant *this* instance.
   */
  private assertNameConfirmed(name: string, confirm: string | undefined): void {
    if (confirm !== name) {
      throw new BadRequestException(
        `Confirmation required: repeat the instance name as the "confirm" ` +
          `query parameter (?confirm=${name}).`,
      );
    }
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
