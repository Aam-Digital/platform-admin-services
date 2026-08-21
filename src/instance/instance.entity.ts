import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("instances")
export class Instance {
  @PrimaryColumn({ type: "varchar", length: 63 })
  name: string;

  @Column({ type: "varchar", length: 10, default: "en-US" })
  locale: string;

  @Column({ name: "owner_email", type: "varchar", length: 255 })
  ownerEmail: string;

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

  @CreateDateColumn({ name: "created_at" })
  createdAt: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt: Date;
}
