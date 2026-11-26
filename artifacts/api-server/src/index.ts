import { initializeApplicationRuntime } from "./platform/valo-runtime-activation";
import app from "./app";
import { logger } from "./platform/logger";
import { setting } from "./platform/settings";
import { startRequestCountWriter } from "./modules/operations";

const rawPort = setting("PORT");

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

await initializeApplicationRuntime();
const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// The request counts reach the database once a minute (docs/architecture/alerts.md, part 3). In
// production, which serves only the health check, there is nothing to count.
const stopCounting = setting("NODE_ENV") === "production" ? async () => {} : startRequestCountWriter(logger);

for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.once(signal, () => {
    // The last minute's counts are written once no request is left.
    server.close(() => void stopCounting().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 75000).unref();
  });
