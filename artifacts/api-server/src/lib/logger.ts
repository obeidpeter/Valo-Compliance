import pino, { type DestinationStream } from "pino";
import { safeError } from "./safe-error";
import { setting } from "../platform/settings";

const isProduction = setting("NODE_ENV") === "production";

export function createApplicationLogger(destination?: DestinationStream) {
  return pino(
    {
      level: setting("LOG_LEVEL") ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "body",
        "payload",
        "prompt",
        "document",
        "profile",
      ],
      // Errors keep class, code and stack frames; never free text.
      serializers: { err: safeError },
      hooks: {
        // pino copies err.message into msg when no message is given. Always supply one
        // (the event name) so an error message can never become the log message.
        logMethod(args, method) {
          if (args.length === 1 && typeof args[0] === "object" && args[0] !== null) {
            const event = (args[0] as { event?: unknown }).event;
            return method.apply(this, [args[0], typeof event === "string" ? event : "log"]);
          }
          return method.apply(this, args);
        },
      },
      ...(isProduction || destination || setting("VALO_PRETTY_LOGS") !== "1"
        ? {}
        : {
            transport: {
              target: "pino-pretty",
              options: { colorize: true },
            },
          }),
    },
    destination,
  );
}
export const logger = createApplicationLogger();
