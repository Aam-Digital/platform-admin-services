import { ApiProperty } from "@nestjs/swagger";
import {
  INSTANCE_MODES,
  INSTANCE_STATUSES,
  InstanceMode,
  InstanceStatus,
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

  @ApiProperty({ enum: INSTANCE_MODES, example: "standard" })
  mode: InstanceMode;

  @ApiProperty({
    description:
      "Raw `config.json` overrides, or `null` when none are set. Readable by " +
      "every caller of this endpoint, because it ends up in a file the " +
      "browser fetches anyway.",
    type: "object",
    additionalProperties: true,
    nullable: true,
    example: null,
  })
  appConfigOverride: Record<string, unknown> | null;
}
