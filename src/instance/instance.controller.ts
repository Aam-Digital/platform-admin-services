import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import {
  AvailabilityCheckDto,
  BrevoWebhookDto,
  CreateInstanceDto,
  InstanceResponseDto,
} from "./dto";
import { BrevoWebhookGuard } from "./guards/brevo-webhook.guard";
import { InstanceService } from "./instance.service";
import { JwtAuthGuard } from "@/auth/jwt-auth.guard";

@ApiTags("Instances")
@Controller("instances")
export class InstanceController {
  constructor(private readonly instanceService: InstanceService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: "Get all instances",
    operationId: "getAllInstances",
  })
  @ApiOkResponse({
    description: "List of all registered instances.",
    type: [InstanceResponseDto],
  })
  @ApiUnauthorizedResponse({
    description: "Authentication required or token invalid.",
  })
  async findAll(): Promise<InstanceResponseDto[]> {
    return this.instanceService.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Create a new instance",
    operationId: "createInstance",
  })
  @ApiCreatedResponse({
    description: "Instance created successfully.",
    type: InstanceResponseDto,
  })
  @ApiConflictResponse({ description: "Instance name is already taken." })
  @ApiUnauthorizedResponse({
    description: "Authentication required or token invalid.",
  })
  async create(@Body() dto: CreateInstanceDto): Promise<InstanceResponseDto> {
    return this.instanceService.create(dto);
  }

  @Post("webhook/brevo")
  @UseGuards(BrevoWebhookGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Brevo webhook to create a new instance",
    operationId: "createInstanceFromBrevoWebhook",
  })
  @ApiQuery({
    name: "token",
    required: true,
    description:
      "Shared secret passphrase to authenticate the webhook request.",
  })
  @ApiCreatedResponse({
    description: "Instance created from webhook.",
    type: InstanceResponseDto,
  })
  @ApiConflictResponse({ description: "Instance name is already taken." })
  @ApiUnauthorizedResponse({
    description:
      "Invalid or missing passphrase, or request from non-whitelisted IP.",
  })
  async brevoWebhook(
    @Body() dto: BrevoWebhookDto,
    @Query("token") _token: string,
  ): Promise<InstanceResponseDto> {
    const createDto: CreateInstanceDto = {
      name: dto.attributes.AAM_SYSTEM,
      ownerEmail: dto.email,
    };
    return this.instanceService.create(createDto);
  }

  @Get("check/:name")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: "Check instance name availability",
    operationId: "checkInstanceNameAvailable",
  })
  @ApiParam({
    name: "name",
    description: "The instance name (subdomain) to check.",
    example: "my-organization",
  })
  @ApiOkResponse({
    description: "Availability check result.",
    type: AvailabilityCheckDto,
  })
  @ApiTooManyRequestsResponse({ description: "Rate limit exceeded." })
  async checkAvailability(
    @Param("name") name: string,
  ): Promise<AvailabilityCheckDto> {
    return this.instanceService.checkAvailability(name);
  }
}
