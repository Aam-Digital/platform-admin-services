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
 * into states we do not offer.
 * The infrastructure translates a mode into the actual app configuration.
 */
export const InstanceMode = {
  /** A regular system on its own database, persisting what is entered. */
  Standard: "standard",
  /**
   * Runs on generated data that is not persisted, for a system to show
   * rather than to work in.
   */
  Demo: "demo",
  /**
   * A standard system that disallows offline-sync on devices.
   */
  Online: "online",
} as const;

export type InstanceMode = (typeof InstanceMode)[keyof typeof InstanceMode];

export const INSTANCE_MODES = Object.values(InstanceMode);

/**
 * API docs shared with all DTOs that expose `mode` on the public API.
 * Defined once rather than retyped to avoid duplication and inconsistencies.
 */
export const MODE_DESCRIPTION =
  "How the instance stores its data. `standard` is a regular system on its " +
  "own database, and `demo` runs on generated data that is not persisted, " +
  "for a system to show rather than to work in.";

/**
 * API docs shared with all DTOs that expose `appConfigOverride` for consistency.
 */
export const APP_CONFIG_OVERRIDE_DESCRIPTION =
  "Raw overrides for the app's `config.json`, applied on top of what the " +
  "mode and the deployment defaults produce. Which settings are valid, and " +
  "which of them the deployment owns and therefore refuses to let through, " +
  "is decided by the infrastructure, so a value accepted here can still be " +
  "ignored when it is applied. `config.json` is fetched by the browser.";

/**
 * A Kubernetes quantity in binary units, restricted to a whole number of Mi,
 * Gi or Ti — the granularity the infrastructure actually provisions in, and
 * narrow enough that comparing two values is exact integer arithmetic rather
 * than general quantity parsing.
 */
export const STORAGE_LIMIT_PATTERN = /^([1-9][0-9]*)(Mi|Gi|Ti)$/;

/**
 * API docs shared with all DTOs that expose `storageLimit` for consistency.
 *
 * Named for where this is going rather than what it does today: the only
 * consumer right now is the CouchDB volume, but it is meant to grow into a
 * limit on the instance's storage as a whole.
 */
export const STORAGE_LIMIT_DESCRIPTION =
  "A floor on the storage the deployment gives the instance, as a whole " +
  'number of Mi, Gi or Ti (e.g. "5Gi"). The underlying volume can be grown ' +
  "but never shrunk, so raising this is one-way — the infrastructure decides " +
  "how, and applying a lower value than what is already provisioned has no " +
  "effect there. Capped at a maximum configured for the deployment.";

/**
 * Default for the `MAX_STORAGE_LIMIT` env var, the largest `storageLimit`
 * accepted. Because the limit only grows, a typo cannot be taken back, so this
 * is kept close to what an instance realistically needs rather than to what
 * the infrastructure could provide.
 */
export const DEFAULT_MAX_STORAGE_LIMIT = "100Gi";

const STORAGE_LIMIT_UNIT_BYTES = { Mi: 2 ** 20, Gi: 2 ** 30, Ti: 2 ** 40 };

/**
 * Bytes represented by a `STORAGE_LIMIT_PATTERN` value, so two quantities in
 * different units (e.g. "1024Mi" and "1Gi") compare equal.
 *
 * Throws on a value that does not match — callers are expected to validate
 * with `STORAGE_LIMIT_PATTERN` first (the DTO does, via `@Matches`), so this
 * is a programming error rather than user input reaching here unchecked.
 */
export function parseStorageLimitBytes(value: string): number {
  const match = STORAGE_LIMIT_PATTERN.exec(value);
  if (!match) {
    throw new Error(`"${value}" does not match STORAGE_LIMIT_PATTERN`);
  }
  const [, digits, unit] = match;
  return (
    Number(digits) *
    STORAGE_LIMIT_UNIT_BYTES[unit as keyof typeof STORAGE_LIMIT_UNIT_BYTES]
  );
}

@Entity("instances")
// Any other value reads as "not active" and therefore as "destroy this
// instance", so it must not be storable. Declared here as well as in the
// migration, or `synchronize` would drop it again on a development database.
@Check("CHK_instances_status", `"status" IN ('active', 'inactive')`)
// As with the status: an unknown mode is not something the infrastructure can
// act on, so it must not be storable. Derived from INSTANCE_MODES so this
// check cannot drift from it on a `synchronize`d dev database — the
// migration's own copy of this constraint still needs updating by hand for
// Postgres.
@Check(
  "CHK_instances_mode",
  `"mode" IN (${INSTANCE_MODES.map((mode) => `'${mode}'`).join(", ")})`,
)
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

  /**
   * A floor on the instance's storage, as a `STORAGE_LIMIT_PATTERN` value.
   * `null` — the normal case — leaves the infrastructure's own default in
   * place.
   *
   * Grows only: see `STORAGE_LIMIT_DESCRIPTION`. Nothing here enforces that on
   * its own; `InstanceService.updateStorage` is the only writer and is what
   * rejects a smaller value.
   */
  @Column({
    name: "storage_limit",
    type: "varchar",
    length: 16,
    nullable: true,
  })
  storageLimit: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
