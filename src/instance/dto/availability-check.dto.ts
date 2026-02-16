import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class AvailabilityCheckDto {
  @ApiProperty({
    description: "The instance name that was checked.",
    example: "my-organization",
  })
  name: string;

  @ApiProperty({
    description: "Whether the name is available for registration.",
  })
  available: boolean;

  @ApiPropertyOptional({
    description: "Reason if the name is not available.",
    enum: ["taken", "invalid", "reserved"],
    nullable: true,
  })
  reason?: "taken" | "invalid" | "reserved" | null;
}
