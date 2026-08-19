import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsOptional } from "class-validator";
import { INSTANCE_STATUSES } from "../instance.entity";

export const INSTANCE_STATUS_FILTERS = [...INSTANCE_STATUSES, "all"] as const;

export type InstanceStatusFilter = (typeof INSTANCE_STATUS_FILTERS)[number];

export class ListInstancesQueryDto {
  @ApiPropertyOptional({
    description:
      "Which instances to return. Defaults to `active`, which is the " +
      "deployment manifest: the infrastructure destroys every instance that " +
      "is not in the response.",
    enum: INSTANCE_STATUS_FILTERS,
    default: "active",
  })
  @IsOptional()
  @IsIn(INSTANCE_STATUS_FILTERS)
  status?: InstanceStatusFilter;
}
