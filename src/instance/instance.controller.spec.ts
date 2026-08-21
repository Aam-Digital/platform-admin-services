import { ConfigModule } from "@nestjs/config";
import { Test, TestingModule } from "@nestjs/testing";
import { BrevoWebhookDto } from "./dto";
import { InstanceController } from "./instance.controller";
import { InstanceService } from "./instance.service";

describe("InstanceController", () => {
  let controller: InstanceController;
  let service: { create: jest.Mock };

  beforeEach(async () => {
    service = { create: jest.fn().mockResolvedValue({}) };

    const module: TestingModule = await Test.createTestingModule({
      // for the guards on the controller, which are not exercised here
      imports: [
        ConfigModule.forRoot({
          ignoreEnvFile: true,
          load: [
            () => ({
              BREVO_WEBHOOK_TOKEN: "test-token",
              BREVO_ALLOWED_IPS: "",
            }),
          ],
        }),
      ],
      controllers: [InstanceController],
      providers: [{ provide: InstanceService, useValue: service }],
    }).compile();

    controller = module.get(InstanceController);
  });

  describe("brevoWebhook", () => {
    it("should not let the webhook set alternative hostnames", async () => {
      // A hostname becomes an Ingress host in the cluster, so it must only be
      // settable by an admin. The global ValidationPipe already rejects the
      // unknown property; this covers the mapping itself, which is what keeps
      // the webhook harmless if that configuration ever changes.
      const payload = {
        email: "someone@example.com",
        attributes: { AAM_SYSTEM: "brevo-org" },
        alternativeHostnames: ["admin.aam-digital.app"],
      } as BrevoWebhookDto;

      await controller.brevoWebhook(payload, "token");

      expect(service.create).toHaveBeenCalledWith({
        name: "brevo-org",
        ownerEmail: "someone@example.com",
      });
    });
  });
});
