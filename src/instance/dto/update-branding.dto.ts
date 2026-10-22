import { ApiProperty } from "@nestjs/swagger";
import { Matches, ValidateIf } from "class-validator";
import { BRANDING_DESCRIPTION, BRANDING_PATTERN } from "../instance.entity";

export class UpdateBrandingDto {
  @ApiProperty({
    description: `${BRANDING_DESCRIPTION} \`null\` goes back to the defaults.`,
    pattern: BRANDING_PATTERN.source,
    nullable: true,
    example: "codo",
  })
  // Not @IsOptional(): `null` is a value here, meaning "back to the
  // defaults", and has to reach the column rather than be treated as an
  // absent field. The field itself is required — a body with nothing in it
  // would otherwise be a silent no-op.
  @ValidateIf((_, value) => value !== null)
  @Matches(BRANDING_PATTERN, {
    message:
      "branding must be a lowercase name of at most 32 characters, e.g. " +
      '"codo", or null',
  })
  branding: string | null;
}
