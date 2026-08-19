import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsIn, IsObject, IsOptional } from "class-validator";
import { INSTANCE_MODES, InstanceMode } from "../instance.entity";

/**
 * Both fields are optional and each is applied only when present: an absent
 * field leaves the stored value alone, so one of the two can be changed without
 * restating the other.
 */
export class UpdateAppConfigDto {
  @ApiPropertyOptional({
    description:
      "How the instance stores its data. Moving a live system to `demo` stops " +
      "it persisting what is entered into it; the data already in its " +
      "database is not erased.",
    enum: INSTANCE_MODES,
    example: "demo",
  })
  @IsOptional()
  @IsIn(INSTANCE_MODES)
  mode?: InstanceMode;

  @ApiPropertyOptional({
    description:
      "Raw overrides for the app's `config.json`, applied on top of what the " +
      "mode and the deployment defaults produce. `null` unsets them. " +
      "Stored as given: which settings are valid, and which of them the " +
      "deployment owns and therefore refuses to let through, is decided by " +
      "the infrastructure, so a value accepted here can still be ignored " +
      "when it is applied. `config.json` is fetched by the browser — never " +
      "put a secret in here.",
    type: "object",
    additionalProperties: true,
    nullable: true,
    example: { webmaster_email: "it@example.org" },
  })
  @IsOptional()
  @IsObject()
  appConfigOverride?: Record<string, unknown> | null;
}
