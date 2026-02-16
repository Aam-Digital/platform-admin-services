import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { BrevoWebhookGuard } from "./guards/brevo-webhook.guard";
import { InstanceController } from "./instance.controller";
import { Instance } from "./instance.entity";
import { InstanceService } from "./instance.service";

@Module({
  imports: [TypeOrmModule.forFeature([Instance])],
  controllers: [InstanceController],
  providers: [InstanceService, BrevoWebhookGuard],
  exports: [InstanceService],
})
export class InstanceModule {}
