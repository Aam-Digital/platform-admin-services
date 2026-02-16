import {
    CanActivate,
    ExecutionContext,
    Injectable,
    Logger,
    UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import * as net from "net";

/**
 * Guard for the Brevo webhook endpoint.
 * Validates the shared-secret query parameter and optionally
 * restricts requests to known Brevo IP ranges.
 */
@Injectable()
export class BrevoWebhookGuard implements CanActivate {
  private readonly logger = new Logger(BrevoWebhookGuard.name);
  private readonly token: string;
  private readonly allowedCidrs: string[];

  constructor(private readonly configService: ConfigService) {
    this.token = this.configService.getOrThrow<string>("BREVO_WEBHOOK_TOKEN");

    const raw = this.configService.get<string>("BREVO_ALLOWED_IPS", "");
    this.allowedCidrs = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const queryToken = req.query["token"] as string | undefined;

    if (!queryToken || queryToken !== this.token) {
      this.logger.warn("Brevo webhook: invalid or missing token");
      throw new UnauthorizedException("Invalid or missing webhook token.");
    }

    if (this.allowedCidrs.length > 0) {
      const clientIp = this.extractClientIp(req);
      if (!this.isIpAllowed(clientIp)) {
        this.logger.warn(
          `Brevo webhook: rejected request from IP ${clientIp}`,
        );
        throw new UnauthorizedException(
          "Request from non-whitelisted IP address.",
        );
      }
    }

    return true;
  }

  private extractClientIp(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    return req.ip ?? req.socket.remoteAddress ?? "";
  }

  private isIpAllowed(ip: string): boolean {
    return this.allowedCidrs.some((cidr) => this.ipInCidr(ip, cidr));
  }

  private ipInCidr(ip: string, cidr: string): boolean {
    if (!net.isIPv4(ip)) {
      return false;
    }

    const [range, bitsStr] = cidr.split("/");
    const bits = bitsStr ? parseInt(bitsStr, 10) : 32;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;

    const ipNum = this.ipToInt(ip);
    const rangeNum = this.ipToInt(range);

    return (ipNum & mask) === (rangeNum & mask);
  }

  private ipToInt(ip: string): number {
    return ip
      .split(".")
      .reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
  }
}
