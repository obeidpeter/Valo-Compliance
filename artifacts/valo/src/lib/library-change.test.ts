import { test } from "node:test";
import assert from "node:assert/strict";
import { changeHint, changeLabel, updatedLine } from "./library-change";

// CMP-005 (docs/architecture/guidance-currency.md, slice 3): the words for what changed in a version
// released after an earlier one.
test("a version released after an earlier one asks what changed, and its page says when it was updated and what changed", () => {
  assert.equal(changeLabel, "What changed in this version?");
  assert.equal(
    changeHint(2),
    "Version 2 was released before. Readers see this note on the entry's page, and customers who hold or used the template are told it. In 20 to 1,000 characters.",
  );
  // On a Lagos clock: 23:30 UTC on 25 November is 26 November in Lagos.
  assert.equal(
    updatedLine({ on: "2026-11-25T23:30:00Z", note: "The payment clause now names the due date" }),
    "Updated on 26 Nov 2026. What changed: The payment clause now names the due date.",
  );
  assert.equal(
    updatedLine({ on: "2026-11-25T09:00:00Z", note: "  It now covers deposits.  " }),
    "Updated on 25 Nov 2026. What changed: It now covers deposits.",
  );
});
