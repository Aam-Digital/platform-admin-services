import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { TypeOrmModule } from "@nestjs/typeorm";
import { SentryModule } from "@sentry/nestjs/setup";
import { AuthModule } from "./auth/auth.module";
import { Instance } from "./instance/instance.entity";
import { InstanceModule } from "./instance/instance.module";

@Module({
  imports: [
    // Sentry must be first
    SentryModule.forRoot(),

    ConfigModule.forRoot({ isGlobal: true }),

    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        host: config.get<string>("POSTGRES_HOST", "localhost"),
        port: config.get<number>("POSTGRES_PORT", 5432),
        username: config.get<string>("POSTGRES_USER", "aam_admin"),
        password: config.get<string>("POSTGRES_PASSWORD", "aam_admin_secret"),
        database: config.get<string>("POSTGRES_DB", "aam_admin"),
        entities: [Instance],
        synchronize: config.get<string>("NODE_ENV") !== "production",
        logging: config.get<string>("NODE_ENV") !== "production",
      }),
    }),

    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 30 }],
    }),

    AuthModule,
    InstanceModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
