import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, ValidateIf } from "class-validator";

const DESCRIPTION = (feature: string, needs?: string) =>
  `\`true\` switches \`${feature}\` on, \`false\` off; leaving the field out ` +
  "keeps what is stored." +
  (needs ? ` Needs \`${needs}\`.` : "");

// Not @IsOptional(), which would let `null` through as if the field were
// absent: `null` has no meaning here, so it is refused like any other
// non-boolean.
const isPresent = (_: unknown, value: unknown) => value !== undefined;

/**
 * One optional field per `FEATURES` entry, each applied only when present, so
 * that one feature can be switched without restating the others. Any other key
 * is rejected by the global `forbidNonWhitelisted`.
 */
export class UpdateFeaturesDto {
  @ApiPropertyOptional({
    description: `${DESCRIPTION("permissions")} Permission checks on every read and write.`,
    example: true,
  })
  @ValidateIf(isPresent)
  @IsBoolean()
  permissions?: boolean;

  @ApiPropertyOptional({
    description: `${DESCRIPTION("backend", "permissions")} The server-side API.`,
    example: true,
  })
  @ValidateIf(isPresent)
  @IsBoolean()
  backend?: boolean;

  @ApiPropertyOptional({
    description: `${DESCRIPTION("reporting", "backend")} Reports calculated on the server.`,
  })
  @ValidateIf(isPresent)
  @IsBoolean()
  reporting?: boolean;

  @ApiPropertyOptional({
    description: `${DESCRIPTION("export", "backend")} Document exports from templates.`,
  })
  @ValidateIf(isPresent)
  @IsBoolean()
  export?: boolean;

  @ApiPropertyOptional({
    description: `${DESCRIPTION("notifications", "backend")} Notifications of changes users subscribe to.`,
  })
  @ValidateIf(isPresent)
  @IsBoolean()
  notifications?: boolean;
}
