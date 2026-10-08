import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, ValidateIf } from "class-validator";

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
    description:
      "`true` switches `permissions` on, `false` off; leaving the field out " +
      "keeps what is stored. Permission checks on every read and write.",
    example: true,
  })
  @ValidateIf(isPresent)
  @IsBoolean()
  permissions?: boolean;
}
