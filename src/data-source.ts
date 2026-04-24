import { DataSource } from "typeorm";
import { Instance } from "./instance/instance.entity";

export default new DataSource({
  type: "postgres",
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  username: process.env.POSTGRES_USER ?? "aam_admin",
  password: process.env.POSTGRES_PASSWORD ?? "aam_admin_secret",
  database: process.env.POSTGRES_DB ?? "aam_admin",
  entities: [Instance],
  migrations: ["dist/migrations/*.js"],
});
