import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { passportJwtSecret } from 'jwks-rsa';
import { ExtractJwt, Strategy } from 'passport-jwt';

const GITHUB_OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const GITHUB_OIDC_JWKS_URI = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly expectedAudience: string;
  private readonly expectedRepository: string;

  constructor(configService: ConfigService) {
    const audience = configService.getOrThrow<string>('GITHUB_OIDC_AUDIENCE');
    const repository = configService.getOrThrow<string>('GITHUB_REPOSITORY');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      algorithms: ['RS256'],
      issuer: GITHUB_OIDC_ISSUER,
      audience,
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
        jwksUri: GITHUB_OIDC_JWKS_URI,
      }),
    });

    this.expectedAudience = audience;
    this.expectedRepository = repository;
  }

  validate(payload: Record<string, unknown>) {
    // Verify the token belongs to our repository
    if (payload.repository !== this.expectedRepository) {
      throw new UnauthorizedException(
        `Token repository "${payload.repository}" does not match expected "${this.expectedRepository}".`,
      );
    }

    return {
      sub: payload.sub,
      repository: payload.repository,
      actor: payload.actor,
      ref: payload.ref,
      workflow: payload.workflow,
    };
  }
}
