import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAlternativeHostnames1755400000000 implements MigrationInterface {
  name = "AddAlternativeHostnames1755400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "instances"
      ADD COLUMN "alternative_hostnames" text NOT NULL DEFAULT ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "instances" DROP COLUMN "alternative_hostnames"
    `);
  }
}
