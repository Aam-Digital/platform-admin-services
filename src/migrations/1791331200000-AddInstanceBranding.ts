import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceBranding1791331200000 implements MigrationInterface {
  name = "AddInstanceBranding1791331200000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable and without a default: `null` is "serve the default icons",
    // which is what every existing instance is doing.
    //
    // No CHECK constraint, unlike `status` and `mode`: which icon sets exist
    // is decided by the infrastructure, not here. See the column's comment in
    // `instance.entity.ts`.
    await queryRunner.query(`
      ALTER TABLE "instances" ADD COLUMN "branding" varchar(32)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instances" DROP COLUMN "branding"`);
  }
}
