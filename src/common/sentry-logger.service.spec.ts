import { Logger } from "@nestjs/common";
import * as Sentry from "@sentry/nestjs";
import { SentryLogger } from "./sentry-logger.service";

jest.mock("@sentry/nestjs", () => ({
  captureException: jest.fn(),
  captureMessage: jest.fn(),
}));

describe("SentryLogger", () => {
  let logger: SentryLogger;
  const captureMessage = Sentry.captureMessage as jest.Mock;
  const captureException = Sentry.captureException as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    logger = new SentryLogger();
    // silence the console output of the underlying ConsoleLogger
    jest.spyOn(process.stdout, "write").mockReturnValue(true);
    jest.spyOn(process.stderr, "write").mockReturnValue(true);
  });

  afterEach(() => {
    Logger.overrideLogger(false);
    jest.restoreAllMocks();
  });

  it("should send a warning with the object param as extra details", () => {
    logger.warn("Brevo webhook: rejected request from IP", {
      clientIp: "1.2.3.4",
    });

    expect(captureMessage).toHaveBeenCalledWith(
      "Brevo webhook: rejected request from IP",
      { level: "warning", extra: { details: { clientIp: "1.2.3.4" } } },
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("should send the same message for different details, so Sentry groups them", () => {
    logger.warn("rejected request from IP", { clientIp: "1.2.3.4" });
    logger.warn("rejected request from IP", { clientIp: "5.6.7.8" });

    const [firstMessage] = captureMessage.mock.calls[0];
    const [secondMessage] = captureMessage.mock.calls[1];
    expect(firstMessage).toBe(secondMessage);
  });

  it("should send multiple object params as an array of details", () => {
    logger.warn("something odd", { a: 1 }, { b: 2 });

    expect(captureMessage).toHaveBeenCalledWith("something odd", {
      level: "warning",
      extra: { details: [{ a: 1 }, { b: 2 }] },
    });
  });

  it("should omit extra when no object params are passed", () => {
    logger.warn("plain warning");

    expect(captureMessage).toHaveBeenCalledWith("plain warning", {
      level: "warning",
    });
  });

  it("should ignore the trailing context string ConsoleLogger appends", () => {
    logger.error("failed to do the thing", "MyService");

    expect(captureMessage).toHaveBeenCalledWith("failed to do the thing", {
      level: "error",
    });
  });

  it("should capture an Error as an exception", () => {
    const error = new Error("boom");

    logger.error(error, { instance: "my-org" });

    expect(captureException).toHaveBeenCalledWith(error, {
      level: "error",
      extra: { details: { instance: "my-org" } },
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it("should capture an Error passed as an additional param", () => {
    const error = new Error("boom");

    logger.error("failed", error);

    expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
  });

  it("should still print through the underlying ConsoleLogger", () => {
    logger.warn("printed warning", { clientIp: "1.2.3.4" });

    const printed = (process.stdout.write as jest.Mock).mock.calls
      .map(([chunk]) => String(chunk))
      .join("");
    expect(printed).toContain("printed warning");
    expect(printed).toContain("1.2.3.4");
  });

  // The call sites use `new Logger(context)`, not SentryLogger directly.
  // Nest routes those through the overridden logger and appends the context
  // as a trailing param — so exercise that exact path, not just the class.
  it("should capture warnings logged through an ordinary Logger", () => {
    Logger.overrideLogger(logger);

    new Logger("BrevoWebhookGuard").warn(
      "Brevo webhook: rejected request from IP",
      { clientIp: "1.2.3.4" },
    );

    expect(captureMessage).toHaveBeenCalledWith(
      "Brevo webhook: rejected request from IP",
      { level: "warning", extra: { details: { clientIp: "1.2.3.4" } } },
    );
  });

  it("should not send log/debug messages to Sentry", () => {
    logger.log("just an info message");
    logger.debug("just a debug message");

    expect(captureMessage).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
});
