import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
} from "class-validator";
import {
  INSTANCE_MODES,
  InstanceMode,
  MODE_DESCRIPTION,
} from "../instance.entity";

/**
 * Pattern for valid instance names (subdomains).
 * Must start and end with alphanumeric, may contain hyphens, 3-63 chars total.
 */
export const INSTANCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/**
 * Pattern for a full hostname: lowercase labels separated by dots, at least
 * two of them. Lowercase because the infrastructure applies the same pattern
 * and skips a manifest entry that does not match.
 *
 * See https://github.com/Aam-Digital/aam-cloud-infrastructure/blob/main/infra/aam-digital-instances/src/index.ts
 */
export const HOSTNAME_PATTERN =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export class CreateInstanceDto {
  @ApiProperty({
    description:
      "The instance name, used as subdomain (e.g. `my-org` → `my-org.aam-digital.com`).",
    pattern: "^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$",
    example: "my-organization",
  })
  @IsString()
  @Matches(INSTANCE_NAME_PATTERN, {
    message:
      "name must be a valid subdomain: 3-63 chars, lowercase alphanumeric and hyphens, must start and end with alphanumeric",
  })
  name: string;

  @ApiProperty({
    description: "Email address for the initial user account.",
    example: "admin@my-organization.org",
  })
  @IsEmail()
  ownerEmail: string;

  @ApiPropertyOptional({
    description: "Locale for the instance.",
    example: "en-US",
  })
  @IsOptional()
  @IsString()
  locale?: string;

  @ApiPropertyOptional({
    description:
      "Further hostnames the instance is served on, besides `<name>.<cluster domain>`. " +
      "Full lowercase hostnames; each one needs a DNS record pointing at the cluster " +
      "before the instance can serve it — until then no certificate can be issued " +
      "and browsers warn about the one they get.",
    example: ["my-organization.aam-digital.com", "app.my-organization.org"],
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @Matches(HOSTNAME_PATTERN, {
    each: true,
    message: "each alternative hostname must be a lowercase full hostname",
  })
  alternativeHostnames?: string[];

  @ApiPropertyOptional({
    description: `${MODE_DESCRIPTION} Defaults to \`standard\`.`,
    enum: INSTANCE_MODES,
    default: "standard",
  })
  // Not @IsOptional(): see the same field on UpdateAppConfigDto for why
  // `null` must be rejected rather than treated as absent.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(INSTANCE_MODES)
  mode?: InstanceMode;
}
