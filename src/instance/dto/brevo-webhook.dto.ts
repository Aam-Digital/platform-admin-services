import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
    IsEmail,
    IsInt,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export class BrevoWebhookAttributes {
  @ApiProperty({ description: 'Instance name to create.', example: 'test-mon16' })
  @IsString()
  AAM_SYSTEM: string;

  // Allow additional Brevo attributes
  [key: string]: unknown;
}

export class BrevoWebhookDto {
  @ApiPropertyOptional({ example: 'workflow-action-processor' })
  @IsOptional()
  @IsString()
  appName?: string;

  @ApiProperty()
  @IsObject()
  @ValidateNested()
  @Type(() => BrevoWebhookAttributes)
  attributes: BrevoWebhookAttributes;

  @ApiPropertyOptional({ example: 34 })
  @IsOptional()
  @IsInt()
  contact_id?: number;

  @ApiProperty({
    description: 'Email of the contact, used as owner email.',
    example: 'webmaster@aam-digital.com',
  })
  @IsEmail()
  email: string;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  step_id?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  workflow_id?: number;
}
