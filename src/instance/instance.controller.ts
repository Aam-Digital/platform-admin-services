import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBasicAuth,
  ApiBearerAuth,
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { BasicAuthGuard } from "../auth/basic-auth.guard";
import { JwtOrBasicAuthGuard } from "../auth/jwt-or-basic-auth.guard";
import {
  AvailabilityCheckDto,
  BrevoWebhookDto,
  CreateInstanceDto,
  InstanceResponseDto,
  ListInstancesQueryDto,
  UpdateInstanceDto,
} from "./dto";
import { BrevoWebhookGuard } from "./guards/brevo-webhook.guard";
import { InstanceService } from "./instance.service";

/**
 * Where the cluster-side consequences of taking an instance down are described.
 * They belong to the deployment rather than to this API, so they are linked
 * rather than restated here, where they would go stale first.
 */
const INFRA_DEPLOYMENT_DOCS =
  "https://github.com/Aam-Digital/aam-cloud-infrastructure/tree/main/infra/aam-digital-instances";

/**
 * Documents the `confirm` query parameter of the endpoints that take an
 * instance down. See {@link InstanceService.setStatus}.
 */
const CONFIRM_QUERY = {
  name: "confirm",
  required: true,
  description:
    "Must repeat the instance name from the path. Valid credentials do not " +
    "establish that the caller meant this particular instance.",
} as const;

@ApiTags("Instances")
@Controller("instances")
export class InstanceController {
  constructor(private readonly instanceService: InstanceService) {}

  @Get()
  @UseGuards(JwtOrBasicAuthGuard)
  @ApiBearerAuth()
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Get all instances",
    operationId: "getAllInstances",
  })
  @ApiOkResponse({
    description:
      "The instances to deploy. Only the active ones unless `status` says " +
      "otherwise — the infrastructure destroys every instance missing here.",
    type: [InstanceResponseDto],
  })
  @ApiUnauthorizedResponse({
    description:
      "Authentication required – invalid or missing JWT token or Basic credentials.",
  })
  async findAll(
    @Query() query: ListInstancesQueryDto,
  ): Promise<InstanceResponseDto[]> {
    return this.instanceService.findAll(query.status);
  }

  @Post()
  @UseGuards(JwtOrBasicAuthGuard)
  @ApiBearerAuth()
  @ApiBasicAuth()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Create a new instance",
    operationId: "createInstance",
  })
  @ApiCreatedResponse({
    description: "Instance created successfully.",
    type: InstanceResponseDto,
  })
  @ApiConflictResponse({
    description:
      "The instance name is reserved or already taken, or one of the " +
      "`alternativeHostnames` is already used by another instance.",
  })
  @ApiUnauthorizedResponse({
    description:
      "Authentication required – invalid or missing JWT token or Basic credentials.",
  })
  async create(@Body() dto: CreateInstanceDto): Promise<InstanceResponseDto> {
    return this.instanceService.create(dto);
  }

  @Patch(":name")
  @UseGuards(BasicAuthGuard)
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Hibernate or re-activate an instance",
    description:
      "`inactive` drops the instance from the deployment manifest, so the " +
      "deployment triggered by this call tears the instance's cluster " +
      "resources down. The record and the name are kept, but there is no " +
      "automated way back in: re-activating provisions an empty instance " +
      "rather than restoring the old one. What is torn down and what the " +
      "cluster keeps is documented with the cluster deployment: " +
      INFRA_DEPLOYMENT_DOCS,
    operationId: "updateInstanceStatus",
  })
  @ApiParam({ name: "name", description: "The instance name (subdomain)." })
  @ApiQuery(CONFIRM_QUERY)
  @ApiOkResponse({
    description: "Updated instance.",
    type: InstanceResponseDto,
  })
  @ApiBadRequestResponse({ description: "Missing or mismatched `confirm`." })
  @ApiNotFoundResponse({ description: "No such instance." })
  @ApiUnauthorizedResponse({
    description: "Admin Basic auth credentials required.",
  })
  async updateStatus(
    @Param("name") name: string,
    @Body() dto: UpdateInstanceDto,
    @Ip() clientIp: string,
    @Query("confirm") confirm?: string,
  ): Promise<InstanceResponseDto> {
    return this.instanceService.setStatus(name, dto.status, confirm, clientIp);
  }

  @Delete(":name")
  @UseGuards(BasicAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Delete a hibernated instance",
    description:
      "Removes the record and frees the name. Only an already inactive " +
      "instance can be deleted, so the step that takes a system down is " +
      "always the reversible one. This does not erase the instance's data, " +
      "which outlives the record in the cluster and has to be purged there.",
    operationId: "deleteInstance",
  })
  @ApiParam({ name: "name", description: "The instance name (subdomain)." })
  @ApiQuery(CONFIRM_QUERY)
  @ApiNoContentResponse({ description: "Instance record deleted." })
  @ApiBadRequestResponse({ description: "Missing or mismatched `confirm`." })
  @ApiConflictResponse({ description: "Instance is still active." })
  @ApiNotFoundResponse({ description: "No such instance." })
  @ApiUnauthorizedResponse({
    description: "Admin Basic auth credentials required.",
  })
  async remove(
    @Param("name") name: string,
    @Ip() clientIp: string,
    @Query("confirm") confirm?: string,
  ): Promise<void> {
    return this.instanceService.remove(name, confirm, clientIp);
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
    // Built field by field on purpose: a hostname becomes an Ingress host in
    // the cluster, so it is set by an admin through `POST /instances` only and
    // must never be reachable from the webhook, whatever Brevo sends.
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
