/**
 * Serialises an error for logs without ever including free text. Messages,
 * names and database details can contain customer data, and private values can
 * look exactly like error codes, so no message is ever logged. Kept:
 * - the class name, when it is a plain CamelCase identifier;
 * - a well-formed `code` (for example a PostgreSQL SQLSTATE or ECONNREFUSED);
 * - stack frames only (`at ...` lines), which identify the throw site without
 *   the header line that repeats the name and message;
 * - the same, recursively, for `cause` (three levels).
 *
 * Accepts both Error instances and the plain objects that pino-http's wrapper
 * produces before calling a custom serializer.
 */
const CLASS_NAME = /^[A-Z][A-Za-z0-9]{0,60}$/;
const CODE = /^[A-Z0-9_]{2,40}$/;
const MAX_FRAMES = 12;

export type SafeError = {
  class: string;
  code?: string;
  frames?: string[];
  cause?: SafeError;
};

function className(value: object): string {
  const constructorName = (value as { constructor?: { name?: unknown } }).constructor?.name;
  if (typeof constructorName === "string" && constructorName !== "Object" && CLASS_NAME.test(constructorName))
    return constructorName;
  const type = (value as { type?: unknown }).type;
  return typeof type === "string" && CLASS_NAME.test(type) ? type : "Unknown";
}

export function safeError(value: unknown, depth = 0): SafeError {
  if (typeof value !== "object" || value === null) return { class: typeof value };
  const result: SafeError = { class: className(value) };
  const code = (value as { code?: unknown }).code;
  if (typeof code === "string" && CODE.test(code)) result.code = code;
  const stack = (value as { stack?: unknown }).stack;
  if (typeof stack === "string") {
    const frames = stack
      .split("\n")
      .filter((line) => /^\s+at /.test(line))
      .slice(0, MAX_FRAMES)
      .map((line) => line.trim().slice(0, 300));
    if (frames.length) result.frames = frames;
  }
  const cause = (value as { cause?: unknown }).cause;
  if (cause !== undefined && depth < 3) result.cause = safeError(cause, depth + 1);
  return result;
}
