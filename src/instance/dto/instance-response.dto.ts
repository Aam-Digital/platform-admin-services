import { ApiProperty } from "@nestjs/swagger";
import { INSTANCE_STATUSES, InstanceStatus } from "../instance.entity";

export class InstanceResponseDto {
  @ApiProperty({ example: "my-organization" })
  name: string;

  @ApiProperty({ example: "en-US" })
  locale: string;

  @ApiProperty({ example: "admin@my-organization.org" })
  ownerEmail: string;

  @ApiProperty({ enum: INSTANCE_STATUSES, example: "active" })
  status: InstanceStatus;
}
