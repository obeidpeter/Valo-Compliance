import { onConnectionFailure } from "@workspace/db";
import type { Logger } from "pino";

/**
 * Logs each pooled database connection that failed while idle: which login it was, and the failure's
 * code, never its message. The pool has already dropped the connection, and the next query opens
 * another; a login the database now refuses fails there with its own code (docs/valo/secret-rotation.md).
 */
export function logConnectionFailures(logger: Pick<Logger, "warn">) {
  return onConnectionFailure((error, login) => {
    const code = (error as { code?: unknown }).code;
    logger.warn({ event: "db.connection_failed", login, code: typeof code === "string" ? code : "UNKNOWN" });
  });
}
