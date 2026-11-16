import pino, { type DestinationStream } from "pino";

const isProduction = process.env.NODE_ENV === "production";

export function createApplicationLogger(destination?: DestinationStream) {
  return pino(
    {
      level: process.env.LOG_LEVEL ?? "info",
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
      serializers: { err: () => ({ type: "Error", detail: "Details withheld; correlate by request ID." }) },
      ...(isProduction || destination || process.env.VALO_PRETTY_LOGS !== "1"
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
