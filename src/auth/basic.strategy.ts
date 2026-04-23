import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PassportStrategy } from "@nestjs/passport";
import { BasicStrategy as Strategy } from "passport-http";

@Injectable()
export class BasicAuthStrategy extends PassportStrategy(Strategy, "basic") {
  private readonly adminPassword: string;

  constructor(configService: ConfigService) {
    super();
    this.adminPassword = configService.get<string>("ADMIN_PASSWORD", "");
  }

  validate(username: string, password: string) {
    if (!this.adminPassword) {
      throw new UnauthorizedException("Basic auth is disabled.");
    }
    if (username === "admin" && password === this.adminPassword) {
      return { username: "admin", role: "admin" };
    }
    throw new UnauthorizedException("Invalid credentials.");
  }
}
