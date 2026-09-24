import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceVersions1790294400000 implements MigrationInterface {
  name = "AddInstanceVersions1790294400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable and without a default: an instance with no version set follows
    // whatever the infrastructure deploys by default, rather than being pinned
    // to the value that default had when this ran. `text` because the column
    // is TypeORM's `simple-json`, as `app_config_override` is.
    await queryRunner.query(`
      ALTER TABLE "instances" ADD COLUMN "versions" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instances" DROP COLUMN "versions"`);
  }
}
