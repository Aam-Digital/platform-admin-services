import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { BasicAuthStrategy } from "./basic.strategy";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { JwtOrBasicAuthGuard } from "./jwt-or-basic-auth.guard";
import { JwtStrategy } from "./jwt.strategy";

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: "jwt" }),
    JwtModule.register({}),
  ],
  providers: [
    JwtStrategy,
    BasicAuthStrategy,
    JwtAuthGuard,
    JwtOrBasicAuthGuard,
  ],
  exports: [JwtAuthGuard, JwtOrBasicAuthGuard],
})
export class AuthModule {}
