import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  UpdateAppConfigDto,
} from "./dto";
import { BrevoWebhookGuard } from "./guards/brevo-webhook.guard";
import { InstanceService } from "./instance.service";

/**
 * Documents the `confirm` query parameter, which every admin route writing to
 * an existing instance requires. None of them is safe to aim at the wrong
 * instance, and none of them has an undo.
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

  @Get(":name")
  @UseGuards(JwtOrBasicAuthGuard)
  @ApiBearerAuth()
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Get a single instance",
    description:
      "The stored record, whatever its status — unlike the manifest from " +
      "`GET /instances`, which lists the active instances only.",
    operationId: "getInstance",
  })
  @ApiParam({ name: "name", description: "The instance name (subdomain)." })
  @ApiOkResponse({ description: "The instance.", type: InstanceResponseDto })
  @ApiNotFoundResponse({ description: "No such instance." })
  @ApiUnauthorizedResponse({
    description:
      "Authentication required – invalid or missing JWT token or Basic credentials.",
  })
  async findOne(@Param("name") name: string): Promise<InstanceResponseDto> {
    return this.instanceService.findOneOrFail(name);
  }

  @Post(":name/hibernate")
  @UseGuards(BasicAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Hibernate an instance",
    description:
      "Drops the instance from the deployment manifest, so the deployment " +
      "triggered by this call tears the instance's cluster resources down. " +
      "The record and the name are kept, but there is no automated way back " +
      "in: activating it again provisions an empty instance rather than " +
      "restoring this one. What is torn down and what the cluster keeps is " +
      "documented with the infrastructure code.",
    operationId: "hibernateInstance",
  })
  @ApiParam({ name: "name", description: "The instance name (subdomain)." })
  @ApiQuery(CONFIRM_QUERY)
  @ApiOkResponse({
    description:
      "The instance, now inactive. An already hibernated one is returned " +
      "unchanged and triggers no deployment.",
    type: InstanceResponseDto,
  })
  @ApiBadRequestResponse({ description: "Missing or mismatched `confirm`." })
  @ApiNotFoundResponse({ description: "No such instance." })
  @ApiConflictResponse({
    description:
      "The instance was changed or deleted while the request was in flight.",
  })
  @ApiUnauthorizedResponse({
    description: "Admin Basic auth credentials required.",
  })
  async hibernate(
    @Param("name") name: string,
    @Query("confirm") confirm?: string,
  ): Promise<InstanceResponseDto> {
    return this.instanceService.hibernate(name, confirm);
  }

  @Post(":name/activate")
  @UseGuards(BasicAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Activate a hibernated instance",
    description:
      "Puts the instance back into the deployment manifest, so the deployment " +
      "triggered by this call provisions it again. It comes back empty: " +
      "hibernating destroyed its database and nothing here restores one. " +
      "`confirm` is required as on every write to an existing instance — " +
      "aimed at the wrong hibernated name, this brings a system up under it.",
    operationId: "activateInstance",
  })
  @ApiParam({ name: "name", description: "The instance name (subdomain)." })
  @ApiQuery(CONFIRM_QUERY)
  @ApiOkResponse({
    description:
      "The instance, now active. An already active one is returned unchanged " +
      "and triggers no deployment.",
    type: InstanceResponseDto,
  })
  @ApiBadRequestResponse({ description: "Missing or mismatched `confirm`." })
  @ApiNotFoundResponse({ description: "No such instance." })
  @ApiConflictResponse({
    description:
      "The instance was changed or deleted while the request was in flight.",
  })
  @ApiUnauthorizedResponse({
    description: "Admin Basic auth credentials required.",
  })
  async activate(
    @Param("name") name: string,
    @Query("confirm") confirm?: string,
  ): Promise<InstanceResponseDto> {
    return this.instanceService.activate(name, confirm);
  }

  @Patch(":name/app-config")
  @UseGuards(BasicAuthGuard)
  @ApiBasicAuth()
  @ApiOperation({
    summary: "Change an instance's app configuration",
    description:
      "Sets the instance's `mode`, its raw `config.json` overrides, or both; " +
      "a field left out of the body keeps its stored value. The overrides are " +
      "stored as given and interpreted where they are applied, so a value " +
      "accepted here can still be refused or ignored by the deployment. " +
      "`confirm` is required as on every write to an existing instance, and " +
      "here nothing about the request looks dangerous: a change can stop an " +
      "instance persisting its data without taking it down, depending on the " +
      "contents of an override this API does not interpret.",
    operationId: "updateInstanceAppConfig",
  })
  @ApiParam({ name: "name", description: "The instance name (subdomain)." })
  @ApiQuery(CONFIRM_QUERY)
  @ApiOkResponse({
    description: "Updated instance.",
    type: InstanceResponseDto,
  })
  @ApiBadRequestResponse({
    description: "Missing or mismatched `confirm`, or an empty body.",
  })
  @ApiNotFoundResponse({ description: "No such instance." })
  @ApiConflictResponse({
    description: "The instance was deleted while the request was in flight.",
  })
  @ApiUnauthorizedResponse({
    description: "Admin Basic auth credentials required.",
  })
  async updateAppConfig(
    @Param("name") name: string,
    @Body() dto: UpdateAppConfigDto,
    @Query("confirm") confirm?: string,
  ): Promise<InstanceResponseDto> {
    return this.instanceService.updateAppConfig(name, dto, confirm);
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
    @Query("confirm") confirm?: string,
  ): Promise<void> {
    return this.instanceService.remove(name, confirm);
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
