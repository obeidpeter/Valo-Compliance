import type { RequestHandler } from "express";
import { ZodError } from "zod";

export class InputComplexityError extends Error {}
/** A NUL character, which PostgreSQL cannot hold in text, so no request may carry one (SEC-003). */
const NUL = "\u0000";
/** What a person is told of a text that holds one. */
export const HIDDEN_CHARACTER =
  "This text holds a hidden character that cannot be saved. Remove it and try again.";
/** Where in a request a NUL character was found: the field's path, never the text itself. */
export class HiddenCharacterError extends Error {
  constructor(readonly path: string[]) {
    super("A request holds a NUL character.");
  }
}
/** Before all schema validation, including unconstrained objects/collections.
 * Patched collection validators do not replace an overall structural budget. Every key and text is
 * also read for a NUL character. */
export function assertInputBudget(input: unknown) {
  const stack: { value: unknown; depth: number; path: string[] }[] = [{ value: input, depth: 0, path: [] }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth, path } = stack.pop()!;
    if (++nodes > 4096 || depth > 20)
      throw new InputComplexityError("Request structure exceeds the supported complexity limit.");
    if (typeof value === "string") {
      if (value.includes(NUL)) throw new HiddenCharacterError(path);
      continue;
    }
    if (value === null || typeof value !== "object") continue;
    const entries: [string, unknown][] = Array.isArray(value)
      ? value.map((entry, index) => [String(index), entry])
      : Object.entries(value);
    if (entries.length > (Array.isArray(value) ? 256 : 128))
      throw new InputComplexityError("Request collection exceeds the supported size limit.");
    for (const [key, entry] of entries) {
      if (key.includes(NUL)) throw new HiddenCharacterError(path);
      stack.push({ value: entry, depth: depth + 1, path: [...path, key] });
    }
  }
}
/** The query's names and values, and the path's own text, read for a NUL character. */
function assertNoHiddenCharacter(query: unknown, path: string) {
  for (const [key, value] of Object.entries((query ?? {}) as Record<string, unknown>))
    for (const text of [key, ...(Array.isArray(value) ? value : [value])].flat())
      if (typeof text === "string" && text.includes(NUL)) throw new HiddenCharacterError(["query"]);
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // A malformed address names no route, which answers it as one it does not have.
  }
  if (decoded.includes(NUL)) throw new HiddenCharacterError(["path"]);
}
export const requestComplexityLimit: RequestHandler = (req, res, next) => {
  try {
    assertInputBudget(req.body);
    assertNoHiddenCharacter(req.query, req.path);
    next();
  } catch (error) {
    // Answered as any detail the schemas do not take: 422, naming where it was, never what.
    if (error instanceof HiddenCharacterError) {
      next(new ZodError([{ code: "custom", path: error.path, message: HIDDEN_CHARACTER, input: undefined }]));
      return;
    }
    if (!(error instanceof InputComplexityError)) {
      next(error);
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.status(413).json({ code: "INPUT_COMPLEXITY_LIMIT", error: error.message });
  }
};
export function safeValidationFields(issues: readonly { path: PropertyKey[]; message: string }[]) {
  return issues
    .slice(0, 32)
    .map((i) => ({ path: i.path.map(String).join(".").slice(0, 256), message: i.message.slice(0, 320) }));
}
