import { ApiPropertyOptional } from "@nestjs/swagger";
import { Matches, ValidateIf } from "class-validator";
import { VERSION_PATTERN } from "../instance.entity";

const UNSET =
  "`null` unsets it, back to the deployment's default; leaving the field " +
  "out keeps what is stored.";

const TAG_MESSAGE =
  'each version must be an image tag, e.g. "stable" or "3.52.0", of at most ' +
  "128 characters";

// Not @IsOptional(), which would let `null` through only by accident of
// treating it like an absent field: here the two mean different things.
const isSet = (_: unknown, value: unknown) =>
  value !== undefined && value !== null;

/**
 * One optional field per `VERSION_COMPONENTS` entry, each applied only when
 * present, so that one component can be changed without restating the others.
 * Any other key is rejected by the global `forbidNonWhitelisted`.
 */
export class UpdateVersionsDto {
  @ApiPropertyOptional({
    description: `Image tag of \`ndb-core\`. ${UNSET}`,
    pattern: VERSION_PATTERN.source,
    nullable: true,
    example: "stable",
  })
  @ValidateIf(isSet)
  @Matches(VERSION_PATTERN, { message: TAG_MESSAGE })
  "ndb-core"?: string | null;

  @ApiPropertyOptional({
    description: `Image tag of \`aam-services\`. ${UNSET}`,
    pattern: VERSION_PATTERN.source,
    nullable: true,
    example: "stable",
  })
  @ValidateIf(isSet)
  @Matches(VERSION_PATTERN, { message: TAG_MESSAGE })
  "aam-services"?: string | null;

  @ApiPropertyOptional({
    description: `Image tag of \`replication-backend\`. ${UNSET}`,
    pattern: VERSION_PATTERN.source,
    nullable: true,
    example: "stable",
  })
  @ValidateIf(isSet)
  @Matches(VERSION_PATTERN, { message: TAG_MESSAGE })
  "replication-backend"?: string | null;
}
