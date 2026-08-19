import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceAppConfig1787270400000 implements MigrationInterface {
  name = "AddInstanceAppConfig1787270400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NOT NULL DEFAULT 'standard' backfills the existing rows, which all are
    // standard instances: a nullable column would leave the infrastructure
    // guessing what an existing instance is.
    await queryRunner.query(`
      ALTER TABLE "instances"
        ADD COLUMN "mode" varchar(16) NOT NULL DEFAULT 'standard'
    `);
    // An unknown mode is not something the infrastructure can act on, so a
    // typo in a manual UPDATE must not be storable.
    await queryRunner.query(`
      ALTER TABLE "instances"
        ADD CONSTRAINT "CHK_instances_mode"
        CHECK ("mode" IN ('standard', 'demo'))
    `);
    // Nullable and without a default: "no overrides" is the normal case and is
    // worth being distinguishable from "an empty set of overrides".
    await queryRunner.query(`
      ALTER TABLE "instances" ADD COLUMN "app_config_override" text
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "instances" DROP COLUMN "app_config_override"`,
    );
    await queryRunner.query(
      `ALTER TABLE "instances" DROP CONSTRAINT "CHK_instances_mode"`,
    );
    await queryRunner.query(`ALTER TABLE "instances" DROP COLUMN "mode"`);
  }
}
