import { test } from "node:test";
import assert from "node:assert/strict";
import {
  editorMissingScope,
  pageHeadings,
  sourceLine,
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

// CMP-001 (docs/architecture/guidance-record.md, slice 2): the guide's page says whom it is for and names
// each source's issuing body and the day its text took effect, on a Lagos clock.
test("a guide's page says whom it is for, and who issued each source and when its text took effect", () => {
  assert.deepEqual(pageHeadings, {
    appliesTo: "Who this is for",
    actionEvidence: "What to do and keep",
    relatedTemplates: "Related templates",
  });
  assert.equal(
    sourceLine({
      issuingBody: "Nigeria Data Protection Commission",
      effectiveFrom: "2023-06-12T00:00:00+01:00",
    }),
    "Issued by Nigeria Data Protection Commission, in effect from 12 Jun 2023",
  );
  // 23:30 UTC on 31 July is 1 August in Lagos.
  assert.equal(sourceLine({ effectiveFrom: "1971-07-31T23:30:00Z" }), "In effect from 1 Aug 1971");
  assert.equal(
    sourceLine({ issuingBody: "Corporate Affairs Commission" }),
    "Issued by Corporate Affairs Commission",
  );
  assert.equal(sourceLine({}), null);
});
