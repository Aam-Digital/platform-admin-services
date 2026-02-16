import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, Matches } from "class-validator";

/**
 * Pattern for valid instance names (subdomains).
 * Must start and end with alphanumeric, may contain hyphens, 3-63 chars total.
 */
export const INSTANCE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

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
}
