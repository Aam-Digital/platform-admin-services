import { MigrationInterface, QueryRunner } from "typeorm";

export class AddInstanceVersion1790294400000 implements MigrationInterface {
  name = "AddInstanceVersion1790294400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Nullable and without a default: an instance with no version set follows
    // whatever the infrastructure deploys by default, rather than being pinned
    // to the value that default had when this ran.
    await queryRunner.query(`
      ALTER TABLE "instances" ADD COLUMN "version" varchar(128)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "instances" DROP COLUMN "version"`);
  }
}
