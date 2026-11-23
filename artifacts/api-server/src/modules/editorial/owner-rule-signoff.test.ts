import assert from "node:assert/strict";
import test from "node:test";
import {
  allSourceLeads,
  checkerFactsSchema,
  digest,
  evaluateOwnerRuleBundle,
  ownerConfirmedChecks,
  ownerRuleMatchesBundle,
  sha256,
} from "@workspace/valo-core";

// Decision 0020: how a prepared rule becomes the rule and bundle the owner signs. These are
// in-memory fixtures with synthetic text, a synthetic passage and a synthetic amendment record;
// nothing is read, released or reviewed.
process.env.DATABASE_URL ??= "postgresql://unused@localhost/unused";
const signoff = await import("./owner-rule-signoff");
const { guidanceOfficialHosts } = await import("../publication");
type Records = Parameters<typeof signoff.prepareOwnerRule>[1]["records"];
type Passage = NonNullable<ReturnType<Parameters<typeof signoff.prepareOwnerRule>[1]["passages"]>>;

const now = new Date("2026-11-14T12:00:00Z");
const lead = allSourceLeads.find(
  (l) =>
    l.url.startsWith("https://") &&
    (guidanceOfficialHosts as readonly string[]).includes(new URL(l.url).hostname),
)!;
const passageText = "1. Synthetic provision for a controlled test: keep a dated record of each sale.";
const quote = "keep a dated record of each sale";
const rawChecksum = sha256("synthetic official file");
const checkedAt = "2026-11-14T08:00:00.000Z";
const instrument = {
  id: "SYNTHETIC-ACT",
  kind: "act" as const,
  url: lead.url,
  rawSha256: rawChecksum,
  title: "Synthetic Act",
  issuingBody: "Synthetic test authority",
  retrievedAt: checkedAt,
  effectiveFrom: "2026-01-01T00:00:00+01:00",
};
const passage: Passage = {
  id: "SYNTHETIC-1",
  recordedLocator: "section 1; PDF1",
  text: passageText,
  hash: sha256(passageText),
  sections: ["1"],
  instrument,
};
const record = (change: Partial<Records[number]> = {}): Records[number] => ({
  instrument: "SYNTHETIC-ACT",
  title: "Synthetic Act",
  url: lead.url,
  rawSha256: rawChecksum,
  commencement: { printed: "[1st Day of January, 2026]", effectiveFrom: instrument.effectiveFrom },
  searches: [
    {
      place: "Synthetic official list of Acts",
      url: lead.url,
      searchedAt: "2026-11-10T00:00:00Z",
      rawSha256: "b".repeat(64),
      found: "Nothing later",
    },
  ],
  amendments: [],
  notRead: [],
  conflicts: [],
  limits: "A synthetic record for a test only.",
  ...change,
});
const policyContent = {
  version: "synthetic-owner-rule-policy",
  ownerApproved: true,
  allowedClasses: ["sourced_guidance"],
  jurisdictions: ["NG"],
  risks: ["privacy"],
  officialHosts: [new URL(lead.url).hostname],
  blockedActivities: ["bespoke legal opinions"],
};
const policy = { ...policyContent, hash: digest(policyContent) };
const facts = checkerFactsSchema.parse({
  legalForm: "company",
  registrationStatus: "registered",
  activities: ["retail"],
  state: "Lagos",
  lga: "unknown",
  employees: "unknown",
  turnoverBand: "unknown",
  turnoverYear: "unknown",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  premises: "unknown",
  manufacturing: "no",
  importing: "no",
  personalData: "unknown",
});
const candidate = (
  source: Partial<(typeof signoff.ownerRuleCandidates)[number]["sources"][number]> = {},
): (typeof signoff.ownerRuleCandidates)[number] => ({
  rule: {
    id: "synthetic-owner-rule",
    requirementVersionId: "synthetic-requirement-owner-rule",
    title: "Synthetic owner-signed rule; not Nigerian guidance",
    jurisdiction: { level: "federal" },
    validFrom: "2026-01-01",
    validTo: null,
    reason: "Synthetic reason why this may matter.",
    nextStep: "Synthetic next step.",
    relatedTemplateIds: [],
    condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
  },
  risk: "privacy",
  scope: "Synthetic sign-off testing only",
  limitations: "Not content for publication",
  assumptions: [],
  unresolvedMaterialIssues: [],
  missingEvidence: [],
  sources: [
    {
      id: "synthetic-source",
      passageId: "SYNTHETIC-1",
      leadId: lead.id,
      locator: "section 1",
      quote,
      ...source,
    },
  ],
  claims: [
    {
      text: "Synthetic claim",
      kind: "source_statement",
      sourceId: "synthetic-source",
      quote,
      locator: "section 1",
      numbers: [],
    },
  ],
  rights: {
    status: "cleared",
    evidence: "Synthetic rights fixture",
    evidenceHash: sha256("fixture"),
    commercialUse: true,
  },
  scenarios: [
    { id: "company", facts, asOfDate: "2026-11-14", expectedLabel: "Likely relevant", critical: true },
  ],
});
const capture = (text = `Front matter. ${passageText} More text.`, raw = rawChecksum) => ({
  leadId: lead.id,
  url: lead.url,
  snapshotId: "00000000-0000-4000-8000-000000000001",
  checkedAt,
  rawChecksum: raw,
  textChecksum: sha256(text),
  text,
});
/** The registry's passages as today's capture holds them, as `capturedGuidePassages` reads an Act's. */
const passagesIn = (captures: ReturnType<typeof capture>[]) => (id: string) => {
  const today = captures.find((c) => c.url === instrument.url);
  return id === passage.id && today?.text.includes(passage.text)
    ? {
        ...passage,
        instrument: { ...instrument, rawSha256: today.rawChecksum, retrievedAt: today.checkedAt },
      }
    : undefined;
};
const prepare = (
  input: Partial<Parameters<typeof signoff.prepareOwnerRule>[1]> & {
    captureList?: ReturnType<typeof capture>[];
  } = {},
  source: Parameters<typeof candidate>[0] = {},
) => {
  const captures = input.captureList ?? [capture()];
  return signoff.prepareOwnerRule(candidate(source), {
    version: 1,
    captures,
    passages: passagesIn(captures),
    records: [record()],
    policy,
    confirmed: ownerConfirmedChecks,
    now,
    ...input,
  });
};

test("a prepared rule whose passage today's copy holds, with a current amendment record and every check confirmed, makes a bundle the owner can sign", () => {
  const { rule, bundle, holds, snapshotIds, sourceCheckedAt, evidence } = prepare();
  assert.deepEqual(holds, []);
  assert.equal(rule.provenance, "owner_signoff");
  assert.equal(rule.status, "published");
  assert.deepEqual(evaluateOwnerRuleBundle(bundle, now), { decision: "eligible", reasons: [] });
  assert.ok(ownerRuleMatchesBundle(rule, bundle));
  assert.deepEqual(snapshotIds, { "synthetic-source": capture().snapshotId });
  assert.equal(bundle.sources[0]!.text, passageText);
  assert.equal(bundle.sources[0]!.effectiveFrom, instrument.effectiveFrom);
  assert.equal(bundle.sources[0]!.status, "approved");
  // The source check is the copy's check. The rule stays fresh until the earlier of 30 days after
  // it and 30 days after the amendment search.
  assert.equal(sourceCheckedAt.toISOString(), checkedAt);
  assert.equal(rule.sourceCheckedAt, checkedAt);
  assert.equal(rule.reviewBy, "2026-12-10T00:00:00.000Z");
  assert.deepEqual(evidence, [
    {
      passage: passageText,
      recordedLocator: "section 1; PDF1",
      effectiveFrom: instrument.effectiveFrom,
      amendments: {
        searchedAt: "2026-11-10T00:00:00.000Z",
        places: ["Synthetic official list of Acts"],
        read: [],
        notRead: [],
        open: [],
        limits: "A synthetic record for a test only.",
      },
    },
  ]);
  // The same inputs make the same manifest, so the version the owner reads is the one signed.
  assert.equal(prepare().rule.manifestHash, rule.manifestHash);
});

test("without the owner's confirmations the rule's scope and source stay unresolved, and the manifest differs", () => {
  const unconfirmed = prepare({ confirmed: [] });
  const reasons = evaluateOwnerRuleBundle(unconfirmed.bundle, now).reasons;
  assert.ok(reasons.includes("legal_scope_unverified"));
  assert.ok(reasons.includes("source_unresolved:synthetic-source"));
  for (const check of ownerConfirmedChecks) {
    const partial = prepare({ confirmed: ownerConfirmedChecks.filter((c) => c !== check) });
    assert.equal(evaluateOwnerRuleBundle(partial.bundle, now).decision, "hold", check);
  }
  assert.notEqual(unconfirmed.rule.manifestHash, prepare().rule.manifestHash);
});

test("the owner's confirmations do not resolve a source its amendment record does not", () => {
  const held = (records: Records, message: RegExp) => {
    const prepared = prepare({ records });
    assert.ok(
      prepared.holds.some((h) => message.test(h)),
      prepared.holds.join(" | "),
    );
    assert.equal(prepared.bundle.sources[0]!.status, "held");
    assert.ok(
      evaluateOwnerRuleBundle(prepared.bundle, now).reasons.includes("source_unresolved:synthetic-source"),
    );
  };
  held([], /no amendment record exists for this text/);
  held(
    [record({ searches: [{ ...record().searches[0]!, searchedAt: "2026-10-01T00:00:00Z" }] })],
    /more than 30 days old/,
  );
  held([record({ notRead: [{ title: "A synthetic later Act", why: "not yet fetched" }] })], /not yet read/);
  held(
    [
      record({
        conflicts: [{ about: "a synthetic open question", sections: ["1"], open: true, note: "Synthetic" }],
      }),
    ],
    /an open question touches this passage/,
  );
  // Today's capture is another file than the one the amendment record describes.
  const other = prepare({ captureList: [capture(undefined, sha256("a different file"))] });
  assert.ok(
    other.holds.some((h) => /describes a different file/.test(h)),
    other.holds.join(" | "),
  );
});

test("a rule is held without a current copy, when the copy lacks the passage or a quote, for an unregistered source, and for a quotation over the policy's 20 words", () => {
  const missing = prepare({ captureList: [] });
  assert.deepEqual(missing.holds, [
    `${lead.title} has no copy of its official source checked within the last day.`,
  ]);
  assert.deepEqual(missing.snapshotIds, {});
  // With no copy at all, the rule is dated now so its scenarios can be shown; it cannot be signed.
  assert.equal(missing.rule.sourceCheckedAt, now.toISOString());
  const changed = prepare({ captureList: [capture("The official copy now says something else.")] });
  assert.deepEqual(changed.holds, [`Today's copy of ${lead.title} does not hold passage SYNTHETIC-1.`]);
  const unquoted = prepare({}, { quote: "words the passage does not hold" });
  assert.ok(
    unquoted.holds.includes("Synthetic Act: passage SYNTHETIC-1 does not hold the words the rule quotes."),
  );
  const unknown = prepare({ captureList: [] }, { leadId: "SYNTHETIC-NOT-A-LEAD" });
  assert.deepEqual(unknown.holds, ["Passage SYNTHETIC-1 is not read from a registered official source."]);
  assert.ok(
    evaluateOwnerRuleBundle(unknown.bundle, now).reasons.includes("source_not_allowlisted:synthetic-source"),
  );
  const longText = `${passageText} ${Array.from({ length: 21 }, (_, i) => `word${i}`).join(" ")}`;
  const long = signoff.prepareOwnerRule(
    { ...candidate({ quote: longText.slice(passageText.length + 1) }), claims: [] },
    {
      version: 1,
      captures: [capture(longText)],
      passages: (id) =>
        id === passage.id ? { ...passage, text: longText, hash: sha256(longText) } : undefined,
      records: [record()],
      policy,
      confirmed: ownerConfirmedChecks,
      now,
    },
  );
  assert.ok(
    long.holds.includes("Synthetic Act: a quotation is 21 words; the guidance policy allows 20 in a row."),
  );
});

test("the screen says when and where a rule applies and what holds it in words", () => {
  assert.equal(
    signoff.describeRuleCondition({
      condition: {
        mode: "all",
        predicates: [
          { field: "legalForm", op: "eq", value: "company" },
          { field: "personalData", op: "in", value: ["yes", "not_sure"] },
        ],
      },
    }),
    "When legal form is company and personal data is one of yes, not sure.",
  );
  assert.equal(
    signoff.describeRuleCondition({
      condition: {
        mode: "any",
        predicates: [
          { field: "lga", op: "exists" },
          { field: "employees", op: "gte", value: 5 },
        ],
      },
    }),
    "When local government area is answered or employees is at least 5.",
  );
  assert.equal(
    signoff.describeRuleJurisdiction({ level: "federal" }),
    "Nigeria as a whole (a federal rule).",
  );
  assert.equal(
    signoff.ownerRuleHold("source_not_current:S1"),
    "Source S1 is not current: its check is out of date, or it is not in force.",
  );
  assert.equal(
    signoff.ownerRuleHold("critical_scenario_failed:company"),
    "Scenario company does not give the result it expects.",
  );
  assert.equal(signoff.ownerRuleHold("schema:candidate.hash:Invalid"), "The prepared rule is incomplete.");
  assert.equal(signoff.ownerRuleHold("something_new"), "Held: something_new.");
  assert.deepEqual(Object.keys(signoff.ownerCheckLabels).sort(), [...ownerConfirmedChecks].sort());
});

test("every rule prepared in the repository names registered sources and the guides' passages, quotes them within the policy's limit, and has a critical scenario", async () => {
  const { retainedGuidePassages, passageLead } = await import("../publication");
  const retained = retainedGuidePassages();
  const ids = signoff.ownerRuleCandidates.map((c) => c.rule.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of signoff.ownerRuleCandidates) {
    assert.ok(
      c.scenarios.some((s) => s.critical),
      c.rule.id,
    );
    for (const s of c.sources) {
      assert.ok(
        allSourceLeads.some((l) => l.id === s.leadId),
        `${c.rule.id}: ${s.leadId}`,
      );
      assert.equal(passageLead(s.passageId), s.leadId, `${c.rule.id}: ${s.passageId}`);
      const kept = retained(s.passageId);
      for (const q of [
        s.quote,
        ...c.claims.filter((claim) => claim.sourceId === s.id).map((claim) => claim.quote),
      ]) {
        if (kept) assert.ok(kept.text.includes(q), `${c.rule.id}: ${s.id}`);
        assert.ok(q.trim().split(/\s+/).length <= signoff.OWNER_RULE_QUOTE_WORDS, `${c.rule.id}: ${q}`);
      }
    }
  }
});
