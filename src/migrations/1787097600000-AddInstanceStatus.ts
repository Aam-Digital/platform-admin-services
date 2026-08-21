import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceStatus1787097600000 implements MigrationInterface {
  name = "AddInstanceStatus1787097600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NOT NULL DEFAULT 'active' backfills the existing rows. A nullable column
    // would leave them all outside the `status = 'active'` manifest and the
    // next deployment would destroy every instance.
    await queryRunner.query(`
      ALTER TABLE "instances"
        ADD COLUMN "status" varchar(16) NOT NULL DEFAULT 'active'
    `);
    // Any other value is read as "not active" and therefore as "destroy this
    // instance", so a typo in a manual UPDATE must not be storable.
    await queryRunner.query(`
      ALTER TABLE "instances"
        ADD CONSTRAINT "CHK_instances_status"
        CHECK ("status" IN ('active', 'inactive'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "instances" DROP CONSTRAINT "CHK_instances_status"
    `);
    await queryRunner.query(`ALTER TABLE "instances" DROP COLUMN "status"`);
  }
}
