import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Basic Auth with the admin password only, deliberately not accepting the
 * GitHub OIDC JWT that {@link JwtOrBasicAuthGuard} also allows.
 *
 * `JwtStrategy` authorizes a token by its `repository` claim, which is scoped
 * to a repository but not to a branch or a workflow: every workflow run in
 * `aam-cloud-infrastructure` can mint a token that passes. That is an
 * acceptable blast radius for reading and creating, but not for taking an
 * instance down.
 */
@Injectable()
export class BasicAuthGuard extends AuthGuard("basic") {
  handleRequest<T>(err: Error | null, user: T, _info: Error | null): T {
    if (err || !user) {
      throw new UnauthorizedException(
        "Admin Basic auth credentials are required for this operation.",
      );
    }
    return user;
  }
}
