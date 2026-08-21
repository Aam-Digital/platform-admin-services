import { ApiProperty } from "@nestjs/swagger";
import {
  APP_CONFIG_OVERRIDE_DESCRIPTION,
  INSTANCE_MODES,
  INSTANCE_STATUSES,
  InstanceMode,
  InstanceStatus,
  MODE_DESCRIPTION,
} from "../instance.entity";

export class InstanceResponseDto {
  @ApiProperty({ example: "my-organization" })
  name: string;

  @ApiProperty({ example: "en-US" })
  locale: string;

  @ApiProperty({ example: "admin@my-organization.org" })
  ownerEmail: string;

  @ApiProperty({ enum: INSTANCE_STATUSES, example: "active" })
  status: InstanceStatus;

  @ApiProperty({
    description:
      "Further hostnames the instance is served on, besides `<name>.<cluster domain>`.",
    example: ["my-organization.aam-digital.com"],
    type: [String],
  })
  alternativeHostnames: string[];

  @ApiProperty({
    description: MODE_DESCRIPTION,
    enum: INSTANCE_MODES,
    example: "standard",
  })
  mode: InstanceMode;

  @ApiProperty({
    description:
      `${APP_CONFIG_OVERRIDE_DESCRIPTION} \`null\` when none are set — the ` +
      "normal case, and also returned to every caller of this endpoint.",
    type: "object",
    additionalProperties: true,
    nullable: true,
    example: null,
  })
  appConfigOverride: Record<string, unknown> | null;
}
