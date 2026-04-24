import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInstances1745400000000 implements MigrationInterface {
  name = "CreateInstances1745400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "instances" (
        "name"        varchar(63)   NOT NULL,
        "locale"      varchar(10)   NOT NULL DEFAULT 'en-US',
        "owner_email" varchar(255)  NOT NULL,
        "created_at"  TIMESTAMP     NOT NULL DEFAULT now(),
        "updated_at"  TIMESTAMP     NOT NULL DEFAULT now(),
        CONSTRAINT "PK_instances" PRIMARY KEY ("name")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "instances"`);
  }
}
