import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional, ValidateIf } from "class-validator";
import {
  APP_CONFIG_OVERRIDE_DESCRIPTION,
  INSTANCE_MODES,
  InstanceMode,
  MODE_DESCRIPTION,
} from "../instance.entity";

/**
 * Both fields are optional and each is applied only when present: an absent
 * field leaves the stored value alone, so one of the two can be changed without
 * restating the other.
 */
export class UpdateAppConfigDto {
  @ApiPropertyOptional({
    description:
      `${MODE_DESCRIPTION} Moving a live system to \`demo\` stops it ` +
      "persisting what is entered into it; the data already in its " +
      "database is not erased.",
    enum: INSTANCE_MODES,
    example: "demo",
  })
  // Not @IsOptional(), which treats `null` the same as an absent field and
  // would let it through to a non-nullable column: `mode` has no unset state
  // like `appConfigOverride` does, so `null` here must be rejected, not the
  // stored value left alone.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(INSTANCE_MODES)
  mode?: InstanceMode;

  @ApiPropertyOptional({
    description:
      `${APP_CONFIG_OVERRIDE_DESCRIPTION} \`null\` unsets them. Never put ` +
      "a secret in here.",
    type: "object",
    additionalProperties: true,
    nullable: true,
    example: { session_type: "online" },
  })
  @IsOptional()
  @IsObject()
  appConfigOverride?: Record<string, unknown> | null;
}
