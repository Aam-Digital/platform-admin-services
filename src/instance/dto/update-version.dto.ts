import { ApiProperty } from "@nestjs/swagger";
import { Matches, ValidateIf } from "class-validator";
import { VERSION_DESCRIPTION, VERSION_PATTERN } from "../instance.entity";

export class UpdateVersionDto {
  @ApiProperty({
    description: `${VERSION_DESCRIPTION} \`null\` unsets it.`,
    pattern: "^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$",
    nullable: true,
    example: "stable",
  })
  // Required, with `null` as the explicit unset: an absent field must not be
  // mistaken for one. The pattern also bounds the length to the column's.
  @ValidateIf((_, value) => value !== null)
  @Matches(VERSION_PATTERN, {
    message:
      'version must be an image tag, e.g. "stable" or "3.52.0", of at most ' +
      "128 characters",
  })
  version: string | null;
}
