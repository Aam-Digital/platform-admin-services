import "./instrument";

import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";
import { SentryLogger } from "./common/sentry-logger.service";

async function bootstrap() {
  // SentryLogger mirrors `warn` and `error` logs to Sentry, which the
  // built-in logger does not do (it bypasses the global `console`).
  const app = await NestFactory.create(AppModule, {
    logger: new SentryLogger(),
  });
  app.enableCors();

  // Trust proxy headers (for IP extraction behind reverse proxy)
  const expressApp = app.getHttpAdapter().getInstance();
  expressApp.set("trust proxy", true);

  // Global prefix
  app.setGlobalPrefix("api/v1");

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // OpenAPI / Swagger
  const config = new DocumentBuilder()
    .setTitle("Aam Digital Admin API")
    .setDescription("Instance Management Module")
    .setVersion("1.0.0")
    .addBearerAuth()
    .addBasicAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup("api/docs", app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Application running on port ${port}`);
  console.log(`Swagger UI: http://localhost:${port}/api/docs`);
}

bootstrap();
