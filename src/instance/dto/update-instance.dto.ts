import { ApiProperty } from "@nestjs/swagger";
import { IsIn } from "class-validator";
import { INSTANCE_STATUSES, InstanceStatus } from "../instance.entity";

export class UpdateInstanceDto {
  @ApiProperty({
    description:
      "`inactive` hibernates the instance: it drops out of the deployment " +
      "manifest, so the next deployment tears down its namespace, its " +
      "Keycloak realm and its database. The record and the name are kept. " +
      "`active` puts it back into the manifest.",
    enum: INSTANCE_STATUSES,
    example: "inactive",
  })
  @IsIn(INSTANCE_STATUSES)
  status: InstanceStatus;
}
