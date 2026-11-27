import assert from "node:assert/strict";
import { test } from "node:test";
import { allowUnsavedExit, hasUnsavedChanges, registerUnsavedGuard } from "./use-unsaved-navigation";

test("hasUnsavedChanges reflects registered dirty guards and clears on allowUnsavedExit or cleanup", () => {
  let dirty = true;
  let bypassed = false;
  const unregister = registerUnsavedGuard({
    dirty: () => !bypassed && dirty,
    holds: () => !bypassed && dirty,
    hold: () => undefined,
    moved: () => undefined,
    allowExit: () => {
      bypassed = true;
    },
  });
  try {
    assert.equal(hasUnsavedChanges(), true);
    dirty = false;
    assert.equal(hasUnsavedChanges(), false);
    dirty = true;
    assert.equal(hasUnsavedChanges(), true);
    allowUnsavedExit();
    assert.equal(hasUnsavedChanges(), false);
  } finally {
    unregister();
  }
  assert.equal(hasUnsavedChanges(), false);
});
