import { test } from "node:test";
import assert from "node:assert/strict";
import { reachLine, toldLine, withdrawalHelp } from "./library-reach";

// ADM-007 (docs/architecture/library-holds.md, slice 1): whom a staff-library withdrawal tells, said before
// it is made and counted after.
test("an entry says whom its withdrawal would tell, its form says it before the editor confirms, and a withdrawn edition says how many it told", () => {
  const none = { version: 2, workspaces: 0, bought: 0, documentWorkspaces: 0, documents: 0 };
  const some = { version: 2, workspaces: 3, bought: 1, documentWorkspaces: 2, documents: 5 };
  const one = { version: 1, workspaces: 1, bought: 0, documentWorkspaces: 1, documents: 1 };
  assert.equal(
    reachLine(none),
    "Withdrawing version 2 would tell no workspace: none bought this template or made a document from this version.",
  );
  assert.equal(
    reachLine(some),
    "Withdrawing version 2 would tell 3 workspaces: 1 bought this template, and 2 made 5 documents from this version.",
  );
  assert.equal(
    reachLine(one),
    "Withdrawing version 1 would tell 1 workspace: 1 made 1 document from this version.",
  );
  assert.equal(
    reachLine({ version: 3, workspaces: 1, bought: 1, documentWorkspaces: 0, documents: 0 }),
    "Withdrawing version 3 would tell 1 workspace: 1 bought this template.",
  );
  assert.equal(
    withdrawalHelp(2, true, some),
    "Readers can no longer open version 2. 3 workspaces are told, with this reason: 1 bought this template, and 2 made 5 documents from this version. Write it for them, in 20 to 1,000 characters.",
  );
  assert.equal(
    withdrawalHelp(1, true, one),
    "Readers can no longer open version 1. 1 workspace is told, with this reason: 1 made 1 document from this version. Write it for them, in 20 to 1,000 characters.",
  );
  assert.equal(
    withdrawalHelp(2, true, none),
    "Readers can no longer open version 2. No customer is told: none bought this template or made a document from this version. Write the reason for the record, in 20 to 1,000 characters.",
  );
  // Without the counts, as on a database the migration has not reached, it says what it said before.
  assert.equal(
    withdrawalHelp(2, true, null),
    "Readers can no longer open version 2. The customers who bought or used it are told, with this reason, so write it for them, in 20 to 1,000 characters.",
  );
  assert.equal(
    withdrawalHelp(1, false, null),
    "Readers can no longer open version 1. A guide has no buyers or documents, so no customer is told. Write the reason for the record, in 20 to 1,000 characters.",
  );
  assert.equal(toldLine(3), "Its withdrawal told 3 workspaces, with its reason.");
  assert.equal(toldLine(1), "Its withdrawal told 1 workspace, with its reason.");
  assert.equal(
    toldLine(0),
    "Its withdrawal told no workspace: none had bought the template or made a document from this version.",
  );
});
