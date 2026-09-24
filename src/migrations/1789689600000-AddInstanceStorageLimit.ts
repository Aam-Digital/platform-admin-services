import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceStorageLimit1789689600000 implements MigrationInterface {
  name = "AddInstanceStorageLimit1789689600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable and without a default: "no limit set" is the normal case, and
    // must be distinguishable from an explicit value the infrastructure would
    // otherwise have to invent.
    await queryRunner.query(`
      ALTER TABLE "instances" ADD COLUMN "storage_limit" varchar(16)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instances" DROP COLUMN "storage_limit"`,
    );
  }
}
