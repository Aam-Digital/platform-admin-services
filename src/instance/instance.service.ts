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
import { QueryDeepPartialEntity, Repository } from "typeorm";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import {
  AvailabilityCheckDto,
  CreateInstanceDto,
  type InstanceStatusFilter,
} from "./dto";
import { INSTANCE_NAME_PATTERN } from "./dto/create-instance.dto";
import { Instance, InstanceStatus } from "./instance.entity";
import { UpdateAppConfigDto } from "./dto/update-app-config.dto";

/**
 * Names that must not be used as instance subdomains.
 *
 * `demo` and `preview` are the platform's own instances, defined in the
 * infrastructure rather than here. Creating one under those names is accepted by
 * neither side, but only this one reports it to whoever asked: the deployment
 * refuses a manifest entry that collides with a platform instance by failing the
 * apply, which takes every other instance's update with it.
 * https://github.com/Aam-Digital/aam-cloud-infrastructure/blob/main/infra/aam-digital-instances/src/index.ts
 */
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
  "preview",
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

    const alternativeHostnames = [...new Set(dto.alternativeHostnames ?? [])];
    await this.assertHostnamesUnclaimed(alternativeHostnames);

    const instance = this.instanceRepo.create({
      name: dto.name,
      ownerEmail: dto.ownerEmail,
      locale: dto.locale ?? "en-US",
      alternativeHostnames,
      mode: dto.mode ?? "standard",
      // Deliberately not settable when creating: this route also accepts a
      // user token and the Brevo webhook, and an override reaches the app
      // unvalidated. It is set through the admin-only route below.
      appConfigOverride: null,
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
   * Hibernates an instance: removes it from the manifest, so the deployment
   * triggered here destroys its namespace, its Keycloak realm and its database
   * volume claim. The record and the name stay reserved, and the underlying
   * volume is retained by the cluster.
   *
   * @param confirm must repeat `name`.
   */
  async hibernate(
    name: string,
    confirm: string | undefined,
  ): Promise<Instance> {
    return this.setStatus(name, "inactive", confirm);
  }

  /**
   * Puts a hibernated instance back into the manifest, so the deployment
   * triggered here provisions it again — empty, since hibernating destroyed its
   * database and nothing here restores one.
   *
   * @param confirm must repeat `name`. Required as when hibernating: aimed at
   *   the wrong hibernated instance this brings a system up under that name.
   */
  async activate(name: string, confirm: string | undefined): Promise<Instance> {
    return this.setStatus(name, "active", confirm);
  }

  /**
   * The single write behind {@link hibernate} and {@link activate}, private
   * because the API names the transition instead of taking a status: a value of
   * `inactive` says nothing about the teardown it causes, and each direction
   * has its own documented consequences.
   */
  private async setStatus(
    name: string,
    status: InstanceStatus,
    confirm: string | undefined,
  ): Promise<Instance> {
    const instance = await this.findOneOrFail(name);

    this.assertNameConfirmed(name, confirm);

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
    // Sentry as an audit trail.
    this.logger.warn("Instance status changed", {
      name: saved.name,
      status: saved.status,
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
   * Changes an instance's app configuration: its mode, its raw `config.json`
   * overrides, or both. A field absent from the DTO is left as it is.
   *
   * The overrides are stored as given. Which settings are valid, and which of
   * them the deployment owns and refuses to let through, is decided where they
   * are applied — this service has no way to tell a deliberate override from a
   * typo.
   *
   * @param confirm must repeat `name`. Unconditionally, unlike
   *   {@link setStatus}: whether a change here stops an instance persisting its
   *   data can depend on the contents of an override this service does not
   *   interpret, so there is no subset of calls that is safely exempt.
   */
  async updateAppConfig(
    name: string,
    dto: UpdateAppConfigDto,
    confirm: string | undefined,
  ): Promise<Instance> {
    const instance = await this.findOneOrFail(name);
    this.assertNameConfirmed(name, confirm);

    // `!== undefined` rather than `in`, which would be true for a declared but
    // absent field and turn every request into an unset of both.
    if (dto.mode === undefined && dto.appConfigOverride === undefined) {
      throw new BadRequestException(
        'Nothing to change: pass "mode", "appConfigOverride", or both.',
      );
    }

    const changes: Partial<Instance> = {};
    if (dto.mode !== undefined && dto.mode !== instance.mode) {
      changes.mode = dto.mode;
    }
    if (dto.appConfigOverride !== undefined) {
      // Not compared against the stored value: an override is an arbitrarily
      // nested object, and a deep comparison that is subtly wrong would drop a
      // change. Re-sending an identical override therefore does deploy again.
      changes.appConfigOverride = dto.appConfigOverride;
    }

    // No deployment for a request that asks for what is already stored — as
    // with a status set to the one it already has. The dispatched workflow
    // deploys every instance of the stack, so an idempotent-looking call is an
    // expensive no-op.
    if (Object.keys(changes).length === 0) {
      return instance;
    }

    // Conditional on the row still existing rather than on the values that were
    // read: `save` reports success for a row deleted in between. Not conditional
    // on the previous configuration — a lost update here means stale config,
    // where the same conditional for the status guards against destruction.
    const updated = await this.instanceRepo.update(
      { name },
      // `update` recurses into object-typed columns to allow partial updates of
      // embedded entities, which the overrides are not: they are one opaque
      // value that is replaced whole.
      changes as QueryDeepPartialEntity<Instance>,
    );
    if (updated.affected === 0) {
      throw new ConflictException(RACE_MESSAGE(name));
    }

    const saved = await this.findOneOrFail(name);

    // `warn` for the same reason as a status change, logged with the previous
    // values because a wrong setting here is silent — the instance stays up
    // and merely behaves differently.
    this.logger.warn("Instance app config changed", {
      name: saved.name,
      mode: saved.mode,
      previousMode: instance.mode,
      hasOverride: saved.appConfigOverride !== null,
      hadOverride: instance.appConfigOverride !== null,
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
  async remove(name: string, confirm: string | undefined): Promise<void> {
    const instance = await this.findOneOrFail(name);
    this.assertNameConfirmed(name, confirm);

    // Deleting a running instance would take it down through the manifest,
    // with nothing left to restore it from. Hibernating first makes that step
    // its own request, and one that is reversible.
    if (instance.status !== "inactive") {
      throw new ConflictException(
        `Instance "${name}" is still active. Hibernate it first ` +
          `(POST /instances/${name}/hibernate?confirm=${name}), then delete it.`,
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

    this.logger.warn("Instance deleted", { name });
  }

  /**
   * Public because `GET /instances/:name` is exactly this: a record lookup that
   * 404s, whatever the instance's status — unlike {@link findAll}, which
   * defaults to the manifest.
   */
  async findOneOrFail(name: string): Promise<Instance> {
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

  /**
   * Two instances claiming the same hostname would each get an Ingress for it
   * and the ingress controller would serve whichever it saw first, without
   * either instance's owner being told. So a clash is rejected here.
   *
   * All instances are read rather than queried: `alternativeHostnames` is a
   * `simple-array` column, which is not searchable, and there are dozens of
   * instances rather than thousands.
   */
  private async assertHostnamesUnclaimed(hostnames: string[]): Promise<void> {
    if (hostnames.length === 0) {
      return;
    }

    const claimed = new Map(
      (await this.instanceRepo.find()).flatMap((instance) =>
        instance.alternativeHostnames.map(
          (hostname) => [hostname, instance.name] as const,
        ),
      ),
    );

    for (const hostname of hostnames) {
      const claimedBy = claimed.get(hostname);
      if (claimedBy) {
        throw new ConflictException(
          `Hostname "${hostname}" is already used by instance "${claimedBy}".`,
        );
      }
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
