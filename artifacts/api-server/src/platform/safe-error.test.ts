import test from "node:test";
import assert from "node:assert/strict";
import { safeError } from "./safe-error";

test("error serialisation keeps diagnostics but never free text", () => {
  const marker = "SYNTHETIC_PRIVATE_customer@example.test_42";
  const inner = Object.assign(new Error(`duplicate key ${marker}`), {
    code: "23505",
    detail: `Key (email)=(${marker}) already exists.`,
  });
  const outer = new TypeError(marker, { cause: inner });
  outer.name = marker;
  const serialised = safeError(outer);
  assert.equal(JSON.stringify(serialised).includes(marker), false);
  assert.equal(serialised.class, "TypeError");
  assert.ok(serialised.frames && serialised.frames.length > 0 && serialised.frames[0]!.startsWith("at "));
  assert.equal(serialised.cause?.class, "Error");
  assert.equal(serialised.cause?.code, "23505");
});

test("messages that look like error codes are still never logged", () => {
  const marker = "SYNTHETIC_PRIVATE_HTTP_A_B_912836";
  const error = new Error(marker);
  error.name = marker;
  assert.equal(JSON.stringify(safeError(error)).includes(marker), false);
});

test("plain objects from pino-http's wrapper keep a CamelCase type but not names or messages", () => {
  const marker = "SYNTHETIC_PRIVATE_value";
  const wrapped = {
    type: "RangeError",
    message: marker,
    stack: `RangeError: ${marker}\n    at frame (file.ts:1:1)`,
  };
  assert.deepEqual(safeError(wrapped), { class: "RangeError", frames: ["at frame (file.ts:1:1)"] });
  assert.equal(safeError({ type: marker }).class, "Unknown");
  assert.deepEqual(safeError("plain string"), { class: "string" });
});
