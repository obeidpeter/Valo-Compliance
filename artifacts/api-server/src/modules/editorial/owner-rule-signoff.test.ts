import assert from "node:assert/strict";
import test from "node:test";
import {
  allSourceLeads,
  assess,
  checkerFactsSchema,
  digest,
  evaluateOwnerRuleBundle,
  ownerConfirmedChecks,
  ownerRuleDisclosure,
  ownerRuleMatchesBundle,
  planRuleRelease,
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

test("each rule prepared in the repository could be signed against copies of its official texts that hold its passages: its evidence passes and every scenario gives the result it expects", async () => {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const { capturedGuidePassages, guideAmendmentRecords, guidancePolicy, retainedGuidePassages } =
    await import("../publication");
  const root = fileURLToPath(new URL("../../../../../", import.meta.url));
  // The words of the two Acts as the research notes kept them. The guides cut the data protection
  // Act's passages from a capture by their opening and closing words and checksums, so a copy that
  // holds these words holds exactly those passages.
  const ndpaResearch = JSON.parse(
    readFileSync(`${root}docs/content-candidates/source-evidence/ndpa-captured-passages.json`, "utf8"),
  ) as { passages: { id: string; exactText: string }[] };
  const ndpaWords = ndpaResearch.passages.map((p) => p.exactText).join("\n");
  const retained = retainedGuidePassages();
  const camaWords = ["CAMA-814"].map((id) => retained(id)!.text).join("\n");
  const ntaaWords = ["NTAA-11", "NTAA-147-DEFINITIONS"].map((id) => retained(id)!.text).join("\n");
  const f33Words = ["NAFDAC-F33-PAGE-2", "NAFDAC-F33-PAGE-7"].map((id) => retained(id)!.text).join("\n\f");
  const record = (instrument: string) => guideAmendmentRecords.find((r) => r.instrument === instrument)!;
  const records = [
    record("CAC-CAMA-2020"),
    record("NDPC-NDPA-2023"),
    record("NASS-NTAA-2025"),
    record("NAFDAC-CAP-F33"),
  ];
  // A day after the latest search the records describe, so the test holds when they are refreshed,
  // and no earlier than midday on the scenarios' date, which the checker will not assess ahead of.
  const latest = Math.max(...records.flatMap((r) => r.searches.map((s) => Date.parse(s.searchedAt))));
  const scenarioDay = Date.parse(`${signoff.ownerRuleCandidates[0]!.scenarios[0]!.asOfDate}T12:00:00Z`);
  const now = new Date(Math.max(latest + 86_400_000, scenarioDay));
  const checkedAt = new Date(+now - 3_600_000).toISOString();
  const copy = (leadId: string, text: string, rawChecksum: string, n: number) => ({
    leadId,
    url: allSourceLeads.find((l) => l.id === leadId)!.url,
    snapshotId: `00000000-0000-4000-8000-00000000000${n}`,
    checkedAt,
    rawChecksum,
    textChecksum: sha256(text),
    text,
  });
  const captures = [
    copy("SV-010", `Front matter. ${camaWords} More text.`, record("CAC-CAMA-2020").rawSha256, 1),
    copy("S04", `Front matter.\n${ndpaWords}\nMore text.`, record("NDPC-NDPA-2023").rawSha256, 2),
    copy("NASS-NTAA-2025", `Front matter. ${ntaaWords} More text.`, record("NASS-NTAA-2025").rawSha256, 3),
    copy("NAFDAC-CAP-F33", `Front matter.\f${f33Words}\fMore text.`, record("NAFDAC-CAP-F33").rawSha256, 4),
  ];
  const { policy } = await guidancePolicy();
  assert.equal(policy.ownerApproved, true);
  assert.equal(signoff.ownerRuleCandidates.length, 4);
  for (const candidate of signoff.ownerRuleCandidates) {
    const id = candidate.rule.id;
    const prepared = signoff.prepareOwnerRule(candidate, {
      version: 1,
      captures,
      passages: capturedGuidePassages(captures),
      records: guideAmendmentRecords,
      policy,
      confirmed: ownerConfirmedChecks,
      now,
    });
    assert.deepEqual(prepared.holds, [], id);
    assert.deepEqual(
      evaluateOwnerRuleBundle(prepared.bundle, now),
      { decision: "eligible", reasons: [] },
      id,
    );
    assert.equal(ownerRuleMatchesBundle(prepared.rule, prepared.bundle), true, id);
    // The owner's adoption is the rights record, and the rule says how it was released.
    assert.equal(prepared.bundle.rights.status, "cleared");
    assert.match(prepared.bundle.rights.evidence, /adopts it as Valo's own/);
    // Each rule carries the owner's own answer for it; the product-registration rule, which the owner
    // did not answer for, the words the owner left the decision to the coding agent in.
    const answer =
      id === "ntaa-11-company-return"
        ? '("I adopt it too")'
        : id === "nafdac-f33-product-registration"
          ? '("Implement all (make the best decisions for me)")'
          : '("I adopt it")';
    assert.ok(prepared.bundle.rights.evidence.includes(answer), id);
    assert.equal(prepared.bundle.rights.evidenceHash, sha256(prepared.bundle.rights.evidence));
    assert.equal(prepared.rule.provenance, "owner_signoff");
    const plan = planRuleRelease({
      candidate: prepared.rule,
      current: [],
      scenarios: candidate.scenarios,
      profiles: [],
      now,
      asOfDate: candidate.scenarios[0]!.asOfDate,
      trustedManifestHashes: new Set<string>(),
    });
    assert.deepEqual(plan.reasons, [], id);
    for (const s of plan.scenarios) {
      assert.equal(s.passed, true, `${id}: ${s.id} gave ${s.actualLabel}`);
      assert.ok(s.critical && s.actualReason && s.actualNextStep, `${id}: ${s.id}`);
    }
    // EDP-008: what the customer is shown says the rule was released on the owner's sign-off, and
    // not that it was AI drafted and reviewed.
    const shown = candidate.scenarios.find((s) => s.expectedLabel !== null)!;
    assert.deepEqual(
      assess(shown.facts, [prepared.rule], shown.asOfDate, now, {
        trustedManifestHashes: new Set([prepared.rule.manifestHash]),
      }).items.map((item) => item.releaseNotice),
      [ownerRuleDisclosure],
      id,
    );
    // Each label a scenario expects is one the checker gives, and the rule's sources hold its quotes.
    assert.ok(new Set(candidate.scenarios.map((s) => s.expectedLabel)).size >= 3, id);
    for (const source of prepared.rule.sources) {
      const text = prepared.bundle.sources.find((b) => b.id === source.id)!.text;
      assert.ok(text.includes(source.quote), `${id}: ${source.id}`);
    }
  }
});
