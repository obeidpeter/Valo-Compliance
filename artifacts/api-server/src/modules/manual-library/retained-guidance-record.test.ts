import assert from "node:assert/strict";
import test, { afterEach, beforeEach } from "node:test";
import { baselineTemplates } from "@workspace/valo-core";
import { readGuidanceIntake } from "../publication";
import { guidanceRecord } from "./index";
import { retainedDrafts } from "./retained";
import { guideSection, guidanceRecordFromSection, recordWords } from "./retained-guidance-record";

// The retained drafts are read only in development, as the staff library is used only there.
const originalNodeEnv = process.env.NODE_ENV;
beforeEach(() => {
  process.env.NODE_ENV = "development";
});
afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

const ids = Array.from({ length: 30 }, (_, i) => `GUD-${String(i + 1).padStart(2, "0")}`);
const registered = new Set(baselineTemplates.map((template) => template.id));

// CMP-001 (docs/architecture/guidance-record.md, slice 1): the loader fills a retained guide's record
// from its own editorial lines, word for word, and writes nothing a draft does not say.
test("each retained guide's record is its own pinned draft's words, and nothing a draft does not say", async () => {
  const filled = {
    appliesTo: [] as string[],
    actionEvidence: [] as string[],
    relatedTemplates: [] as string[],
  };
  for (const id of ids) {
    // The reader checks the file's checksum against the intake manifest, so these are the pinned bytes.
    const { section, provenance } = await readGuidanceIntake(id);
    const own = guideSection(provenance.sourceText, id, section.title);
    const record = guidanceRecordFromSection(id, own);
    const words = recordWords(own);
    for (const field of ["appliesTo", "actionEvidence"] as const) {
      const value = record[field];
      if (value === null) continue;
      filled[field].push(id);
      assert.ok(words.includes(value), `${id} ${field}: ${value}`);
      // Nothing from the customer text: the record comes from the editorial lines after it.
      assert.ok(!section.body.includes(value), `${id} ${field} is not customer text`);
    }
    if (record.relatedTemplates.length) filled.relatedTemplates.push(id);
    for (const number of record.relatedTemplates) {
      assert.ok(registered.has(number), `${id}: ${number} is registered`);
      assert.ok(own.includes(number), `${id}: ${number} is in its draft`);
    }
    // The same check an editor's draft goes through: nothing is cut or refused.
    assert.deepEqual(
      guidanceRecord({ kind: "regulatory_article", ...record }),
      {
        appliesTo: record.appliesTo,
        actionEvidence: record.actionEvidence,
        relatedTemplates: record.relatedTemplates.length ? record.relatedTemplates : null,
      },
      id,
    );
  }
  const range = (from: number, to: number) => ids.slice(from - 1, to);
  // GUD-01 to GUD-18 and GUD-27 to GUD-30 say whom they apply to, and two of the eight food guides.
  assert.deepEqual(filled.appliesTo, [...range(1, 18), "GUD-20", "GUD-23", ...range(27, 30)]);
  assert.deepEqual(filled.actionEvidence, range(1, 10));
  assert.deepEqual(filled.relatedTemplates, [...range(11, 18), ...range(27, 30)]);
});

test("the record stops where each draft's line turns to something else", async () => {
  const record = async (id: string) => {
    const { section, provenance } = await readGuidanceIntake(id);
    return guidanceRecordFromSection(id, guideSection(provenance.sourceText, id, section.title));
  };
  // "Action / evidence" stops before the related content, which names guides, not templates.
  assert.equal(
    (await record("GUD-01")).actionEvidence,
    "confirm facts, check official route; retain existing registration record and any court-appointment evidence if relevant.",
  );
  // The metadata's scope stops before its related template, and the template number is kept alone.
  const gud11 = await record("GUD-11");
  assert.equal(
    gud11.appliesTo,
    "scope=controller transparency; required facts=role, collection source, purposes, audiences, systems, recipients, retention, automation; unknown facts remain unanswered.",
  );
  assert.deepEqual(gud11.relatedTemplates, ["TPL-29"]);
  // Emphasis marks are not words.
  assert.match((await record("GUD-15")).appliesTo!, /; no provider\/country clearance\.$/);
  assert.deepEqual((await record("GUD-16")).relatedTemplates, ["TPL-30"]);
  assert.equal(
    (await record("GUD-20")).appliesTo,
    "actual Nigerian pre-packaged food manufacturer/packer; do not infer from sector label.",
  );
  assert.deepEqual(await record("GUD-19"), { appliesTo: null, actionEvidence: null, relatedTemplates: [] });
  // The employment guides' related templates, in the order the drafts give them.
  assert.deepEqual((await record("GUD-27")).relatedTemplates, ["TPL-16", "TPL-17", "TPL-11"]);
  assert.deepEqual((await record("GUD-28")).relatedTemplates, ["TPL-16", "TPL-26", "TPL-28"]);
});

test("the retained drafts carry each guide's record beside its text, and the text is unchanged", async () => {
  const guides = (await retainedDrafts()).filter((draft) => draft.kind === "regulatory_article");
  assert.equal(guides.length, 30);
  for (const draft of guides) {
    const { section, provenance } = await readGuidanceIntake(draft.retainedId);
    assert.equal(draft.body, section.body, draft.retainedId);
    assert.deepEqual(
      draft.record,
      guidanceRecordFromSection(
        draft.retainedId,
        guideSection(provenance.sourceText, draft.retainedId, section.title),
      ),
      draft.retainedId,
    );
  }
});

test("only a regulatory article has a record, within its limits", () => {
  assert.deepEqual(guidanceRecord({ kind: "template" }), {
    appliesTo: null,
    actionEvidence: null,
    relatedTemplates: null,
  });
  assert.throws(
    () => guidanceRecord({ kind: "practical_guide", appliesTo: "Anyone" }),
    /Only a regulatory article says whom it applies to/,
  );
  assert.throws(
    () => guidanceRecord({ kind: "regulatory_article", appliesTo: "x".repeat(801) }),
    /in up to 800 characters/,
  );
  assert.throws(
    () =>
      guidanceRecord({ kind: "regulatory_article", appliesTo: "Employers", relatedTemplates: ["TPL-41"] }),
    /registered numbers/,
  );
  assert.throws(
    () =>
      guidanceRecord({
        kind: "regulatory_article",
        appliesTo: "Employers",
        relatedTemplates: ["TPL-01", "TPL-02", "TPL-03", "TPL-04", "TPL-05", "TPL-06", "TPL-07"],
      }),
    /up to 6/,
  );
  assert.deepEqual(
    guidanceRecord({
      kind: "regulatory_article",
      appliesTo: "  Employers with staff.\r\n",
      actionEvidence: " ",
      relatedTemplates: ["TPL-16", " TPL-16"],
    }),
    { appliesTo: "Employers with staff.", actionEvidence: null, relatedTemplates: ["TPL-16"] },
  );
});
