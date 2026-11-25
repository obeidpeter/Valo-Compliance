import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editorMissingScope,
  ownerMissingScope,
  recordFiled,
  recordStates,
  recordWaiting,
  relatedTemplateLine,
  templateNumbers,
} from "./guidance-record";

// CMP-001 (docs/architecture/guidance-record.md, slice 1): the words for a regulatory guide's record on
// the staff library, the drafts panel and the owner's panel.
test("a regulatory guide's record is typed, listed and asked for in plain words", () => {
  assert.deepEqual(templateNumbers(" tpl-16, TPL-17;TPL-16  tpl-11 "), ["TPL-16", "TPL-17", "TPL-11"]);
  assert.deepEqual(templateNumbers("   "), []);
  assert.equal(
    relatedTemplateLine({ number: "TPL-16", title: "Employment contract" }),
    "TPL-16 Employment contract",
  );
  assert.equal(relatedTemplateLine({ number: "TPL-16", title: null }), "TPL-16");
  assert.match(editorMissingScope, /say whom it applies to/);
  assert.match(ownerMissingScope, /A Content editor saves a new version/);
  assert.equal(
    recordWaiting(1, "1").split(".")[0],
    "1 filed regulatory guide does not yet say whom it applies to, while its draft does",
  );
  assert.equal(
    recordWaiting(24, "24").split(".")[0],
    "24 filed regulatory guides do not yet say whom they apply to, while their drafts do",
  );
  assert.match(recordWaiting(2, "2"), /put them in customer words before the owner signs/);
  assert.equal(
    recordFiled(2, "2"),
    "Filed the record of 2 regulatory guides as a new draft version. Each is private until the owner signs it.",
  );
  assert.match(recordStates.unwritten, /A Content editor writes it/);
});
