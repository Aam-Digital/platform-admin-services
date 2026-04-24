import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtOrBasicAuthGuard extends AuthGuard(["jwt", "basic"]) {
  handleRequest<T>(err: Error | null, user: T, _info: Error | null): T {
    if (err || !user) {
      throw new UnauthorizedException(
        "Authentication required. Provide a valid JWT Bearer token or Basic auth credentials.",
      );
    }
    return user;
  }
}
