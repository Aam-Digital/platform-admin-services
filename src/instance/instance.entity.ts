import {
  Check,
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * Lifecycle state of an instance.
 *
 * The `active` instances are the deployment manifest returned by
 * `GET /instances`. The infrastructure destroys everything that is not in it,
 * so `inactive` means hibernated: the record and its name are kept here, the
 * deployment in the cluster is torn down.
 */
export const INSTANCE_STATUSES = ["active", "inactive"] as const;

export type InstanceStatus = (typeof INSTANCE_STATUSES)[number];

/**
 * How an instance stores its data, as the product offers it rather than as the
 * app configures it.
 *
 * A named mode instead of the underlying app settings, because those combine
 * into states we do not offer and must not be able to request: `standard`
 * misread as `demo` means a live system stops persisting what is entered into
 * it. The infrastructure translates a mode into the actual app configuration.
 */
export const INSTANCE_MODES = ["standard", "demo"] as const;

export type InstanceMode = (typeof INSTANCE_MODES)[number];

@Entity("instances")
// Any other value reads as "not active" and therefore as "destroy this
// instance", so it must not be storable. Declared here as well as in the
// migration, or `synchronize` would drop it again on a development database.
@Check("CHK_instances_status", `"status" IN ('active', 'inactive')`)
// As with the status: an unknown mode is not something the infrastructure can
// act on, so it must not be storable.
@Check("CHK_instances_mode", `"mode" IN ('standard', 'demo')`)
export class Instance {
  @PrimaryColumn({ type: "varchar", length: 63 })
  name: string;

  @Column({ type: "varchar", length: 10, default: "en-US" })
  locale: string;

  @Column({ name: "owner_email", type: "varchar", length: 255 })
  ownerEmail: string;

  @Column({ type: "varchar", length: 16, default: "active" })
  status: InstanceStatus;

  /**
   * Full hostnames the instance is served on in addition to its
   * `<name>.<cluster domain>` one, e.g. a domain of its own. The
   * infrastructure adds an Ingress host and a certificate for each.
   *
   * `simple-array` rather than a Postgres `text[]`, because the e2e tests run
   * the same entity against SQLite.
   */
  @Column({ name: "alternative_hostnames", type: "simple-array", default: "" })
  alternativeHostnames: string[];

  @Column({ type: "varchar", length: 16, default: "standard" })
  mode: InstanceMode;

  /**
   * Raw overrides for the app's `config.json`, applied on top of everything the
   * mode and the deployment defaults produce. `null` when unset, which is the
   * normal case.
   *
   * Stored as given and not interpreted here: what a valid app setting is, and
   * which of them the deployment owns and therefore refuses to let through, is
   * decided by the infrastructure. This is the escape hatch for trying a
   * setting on a single instance without a release of three repositories.
   *
   * `config.json` is fetched by the browser, so nothing secret belongs in here.
   *
   * `simple-json` rather than Postgres `jsonb`, because the e2e tests run the
   * same entity against SQLite. A value corrupted by a manual write therefore
   * fails on read and takes the manifest endpoint with it — which fails closed:
   * the deployment cannot fetch the manifest and destroys nothing.
   */
  @Column({ name: "app_config_override", type: "simple-json", nullable: true })
  appConfigOverride: Record<string, unknown> | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
