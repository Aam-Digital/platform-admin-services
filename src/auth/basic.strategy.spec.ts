import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { BasicAuthStrategy } from "./basic.strategy";

describe("BasicAuthStrategy", () => {
  function createStrategy(adminPassword: string): BasicAuthStrategy {
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === "ADMIN_PASSWORD") return adminPassword;
        return defaultValue;
      }),
    } as unknown as ConfigService;

    return new BasicAuthStrategy(configService);
  }

  it("should return admin user for valid credentials", () => {
    const strategy = createStrategy("secret123");
    const result = strategy.validate("admin", "secret123");
    expect(result).toEqual({ username: "admin", role: "admin" });
  });

  it("should throw UnauthorizedException for wrong password", () => {
    const strategy = createStrategy("secret123");
    expect(() => strategy.validate("admin", "wrong")).toThrow(
      UnauthorizedException,
    );
  });

  it("should throw UnauthorizedException for wrong username", () => {
    const strategy = createStrategy("secret123");
    expect(() => strategy.validate("notadmin", "secret123")).toThrow(
      UnauthorizedException,
    );
  });

  it("should throw UnauthorizedException when ADMIN_PASSWORD is not set", () => {
    const strategy = createStrategy("");
    expect(() => strategy.validate("admin", "anything")).toThrow(
      UnauthorizedException,
    );
    expect(() => strategy.validate("admin", "anything")).toThrow(
      "Basic auth is disabled.",
    );
  });
});
