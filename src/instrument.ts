import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import { version } from "../package.json";

/**
 * Sentry must be initialised before anything else is imported.
 * This file is imported at the very top of main.ts.
 */
Sentry.init({
  // set by CI for each image build (release, edge or `0.0.0-pr.<n>`)
  release: version,
  dsn: process.env.SENTRY_DSN,
  environment: process.env.SENTRY_ENVIRONMENT ?? "development",
  integrations: [nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profileSessionSampleRate: 1.0,
});
