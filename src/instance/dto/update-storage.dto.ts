import { ApiProperty } from "@nestjs/swagger";
import { Matches, MaxLength } from "class-validator";
import {
  STORAGE_LIMIT_DESCRIPTION,
  STORAGE_LIMIT_PATTERN,
} from "../instance.entity";

export class UpdateStorageDto {
  @ApiProperty({
    description: STORAGE_LIMIT_DESCRIPTION,
    pattern: "^[1-9][0-9]*(Mi|Gi|Ti)$",
    example: "5Gi",
    maxLength: 16,
  })
  // the length of the `storage_limit` column
  @MaxLength(16)
  @Matches(STORAGE_LIMIT_PATTERN, {
    message: 'storageLimit must be a whole number of Mi, Gi, or Ti, e.g. "5Gi"',
  })
  storageLimit: string;
}
