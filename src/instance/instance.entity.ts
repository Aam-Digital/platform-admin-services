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

@Entity("instances")
// Any other value reads as "not active" and therefore as "destroy this
// instance", so it must not be storable. Declared here as well as in the
// migration, or `synchronize` would drop it again on a development database.
@Check("CHK_instances_status", `"status" IN ('active', 'inactive')`)
export class Instance {
  @PrimaryColumn({ type: "varchar", length: 63 })
  name: string;

  @Column({ type: "varchar", length: 10, default: "en-US" })
  locale: string;

  @Column({ name: "owner_email", type: "varchar", length: 255 })
  ownerEmail: string;

  @Column({ type: "varchar", length: 16, default: "active" })
  status: InstanceStatus;

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
