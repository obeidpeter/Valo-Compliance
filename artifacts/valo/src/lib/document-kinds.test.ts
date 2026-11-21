import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { DOCUMENT_PURPOSES } from "./document-kinds";

test("every document the workspace can start says what it is for, in a short sentence that promises nothing", () => {
  assert.deepEqual(Object.keys(DOCUMENT_PURPOSES).sort(), [...GUIDED_TEMPLATE_IDS].sort());
  // DOC-003: a template "never promise[s] enforceability, suitability or official approval".
  const promise =
    /\b(legal(ly)?|binding|enforce|valid|compl(y|iant|iance)|official|approved|guarantee|protect|ensure|proof|prove|certif|lawyer|court)\w*/i;
  for (const id of GUIDED_TEMPLATE_IDS) {
    const purpose = DOCUMENT_PURPOSES[id];
    assert.ok(purpose.length >= 15 && purpose.length <= 60, `${id}: ${purpose}`);
    assert.match(purpose, /^[A-Z].*\.$/, `${id} is a sentence`);
    assert.doesNotMatch(purpose, promise, `${id}: ${purpose}`);
    assert.ok(GUIDED_SPECS_V1[id].title.length > 0, id);
  }
});
