import { ApiProperty } from "@nestjs/swagger";

export class InstanceResponseDto {
  @ApiProperty({ example: "my-organization" })
  name: string;

  @ApiProperty({ example: "en-US" })
  locale: string;

  @ApiProperty({ example: "admin@my-organization.org" })
  ownerEmail: string;

  @ApiProperty({
    description:
      "Further hostnames the instance is served on, besides `<name>.<cluster domain>`.",
    example: ["my-organization.aam-digital.com"],
    type: [String],
  })
  alternativeHostnames: string[];
}
