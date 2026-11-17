import type { RequestHandler } from "express";

export class InputComplexityError extends Error {}
/** Before all schema validation, including unconstrained objects/collections.
 * Patched collection validators do not replace an overall structural budget. */
export function assertInputBudget(input: unknown) {
  const stack = [{ value: input, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop()!;
    if (++nodes > 4096 || depth > 20)
      throw new InputComplexityError("Request structure exceeds the supported complexity limit.");
    if (value === null || typeof value !== "object") continue;
    const entries = Array.isArray(value) ? value : Object.values(value);
    if (entries.length > (Array.isArray(value) ? 256 : 128))
      throw new InputComplexityError("Request collection exceeds the supported size limit.");
    for (const entry of entries) stack.push({ value: entry, depth: depth + 1 });
  }
}
export const requestComplexityLimit: RequestHandler = (req, res, next) => {
  try {
    assertInputBudget(req.body);
    next();
  } catch (error) {
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
