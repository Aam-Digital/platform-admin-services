import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceFeatures1791504000000 implements MigrationInterface {
  name = "AddInstanceFeatures1791504000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable and without a default: every existing instance has no feature
    // on, which is what `null` stands for. `text` because the column is
    // TypeORM's `simple-json`, as `versions` is.
    await queryRunner.query(`
      ALTER TABLE "instances" ADD COLUMN "features" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instances" DROP COLUMN "features"`);
  }
}
