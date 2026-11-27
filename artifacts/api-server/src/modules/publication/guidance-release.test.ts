import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  allSourceLeads,
  digest,
  evaluatePublication,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import {
  AMENDMENT_RECORD_DAYS,
  guideAmendmentRecords,
  guideSourceDecision,
  type AmendmentRecord,
} from "./guidance-amendments";
import { buildGuideCandidate, guideClaimScopeProblems, repositoryBuiltGuideIds } from "./guidance-bundle";
import { capturedTexts } from "./guidance-captured-texts";
import {
  GUIDE_SHARED_WORDS_LIMIT,
  comparedWords,
  longestSharedRun,
  measureGuideCopying,
} from "./guidance-copying";
import { guidePageText } from "./guidance-document";
import { retainedGuidePassages, locatorSections, type GuidePassage } from "./guidance-passages";
import {
  GUIDANCE_POLICY_PATH,
  guidanceOfficialHosts,
  guidancePolicy,
  guidancePolicyApprovedHash,
  guidancePolicyBindsFile,
} from "./guidance-policy";
import { guideOpenReasons, reasonsOnlyReviewsClear } from "./guidance-release";
import { measureCandidateCopying } from "./guidance-rights";
import { operationalPolicy, publicationWorkspaceRoot } from "./operational-policy";
import { enhancedChecksFromReviews } from "./operational-review-contract";
import { assembledGuide } from "./guidance-release.fixtures";

/**
 * What still holds each guide, worked out by the gate from the guide's real state (decision 0017).
 * Where a test supplies an approval or a completed record of its own, it says so: those are
 * what-ifs inside the test, and they approve nothing.
 */

// A fixed day, the morning after the amendment records' searches were made. A source's decision
// depends on how old those searches are, and the retained copies of the official texts were fetched
// eight days before it.
const day = new Date("2026-11-22T08:00:00Z");
const passages = retainedGuidePassages();
const root = publicationWorkspaceRoot();
const policyFile = readFileSync(resolve(root, GUIDANCE_POLICY_PATH), "utf8");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/** A guide's bundle as it would be prepared on the fixed day, with both files passing inspection. */
const assembled = (
  id: string,
  options: { policy?: PublicationBundle["policy"]; records?: readonly AmendmentRecord[] } = {},
) => assembledGuide(id, day, { ...options, passages });
const failed = (bundle: PublicationBundle) =>
  bundle.mechanicalChecks.filter((check) => check.result !== "pass").map((check) => check.name);
/** The gate's reasons with each source's id left off, so guides can be compared. */
const kinds = (reasons: readonly string[]) =>
  [...new Set(reasons.map((r) => r.replace(/:(?!scope|rights).*$/, "")))].sort();

/** The policy as the owner approved it on 22 November 2026: the file as it stands. */
const approvedPolicy = async () => (await guidancePolicy()).policy;
/** The what-if: the same file with no approval recorded, as it stood before. Only tests suppose it. */
const withoutApproval = async () => (await guidancePolicy({ approvedHash: null })).policy;
/** The policy file as a test supposes it; there is no restriction file beside it. */
const supposedFile = (text: string) => async (path: string) =>
  path === GUIDANCE_POLICY_PATH ? text : Promise.reject(Object.assign(Error("no file"), { code: "ENOENT" }));
const record = (instrument: string) => guideAmendmentRecords.find((r) => r.instrument === instrument)!;
/** Records as they would stand with less done: an instrument left unread, and one section compared. */
const withUnread: AmendmentRecord[] = guideAmendmentRecords.map((r) =>
  r.instrument === "CAC-CAMA-2020"
    ? { ...r, notRead: [{ title: "A later amending Act", why: "supposed for this test" }] }
    : r,
);
const oneSectionCompared: AmendmentRecord[] = guideAmendmentRecords.map((r) =>
  r.comparedSections ? { ...r, comparedSections: { "31": r.comparedSections["31"]! } } : r,
);

test("the guidance policy is read from its file, which is the text the owner approved", async () => {
  // The approval recorded is of this file and no other: its checksum is the file's own.
  assert.equal(guidancePolicyApprovedHash(), sha256(policyFile));
  assert.equal(
    guidancePolicyApprovedHash(),
    "0dcd5221c7e075c8839df3f527fe639c2e2311d9e00f642dcfb8b0fee41a0a1b",
    "the checksum the owner named on 22 November 2026, for the corrected text",
  );
  // What the file says about its own approval is true whether or not a text of it is approved. The
  // first text the owner approved still called itself proposed; this one does not.
  assert.match(
    policyFile,
    /Status: \*\*this text is the policy only while its checksum is the one the product owner approved\.\*\*/,
  );
  for (const stale of ["has not approved this policy", "it is empty today", "recorded in this file"])
    assert.ok(!policyFile.includes(stale), stale);
  // No proposal is left beside it: the approved file is the only text of the policy.
  assert.ok(!existsSync(resolve(root, "docs/valo/policies/guidance-publication-policy.proposed.md")));
  const { policy, authority } = await guidancePolicy();
  assert.equal(policy.ownerApproved, true);
  // With no approval recorded, the same file is not an approved policy.
  assert.equal((await withoutApproval()).ownerApproved, false);
  assert.deepEqual(policy.allowedClasses, ["sourced_guidance"]);
  assert.deepEqual(policy.jurisdictions, ["NG"]);
  assert.ok(!policy.risks.includes("general"), "every guide takes the enhanced checks");
  assert.equal(policy.developmentOnly, true);
  assert.deepEqual(policy.officialHosts, [...guidanceOfficialHosts]);
  // The policy binds the file: its hash, and sentences that are in it.
  assert.equal(authority[0]!.hash, sha256(policyFile));
  assert.ok(guidancePolicyBindsFile(policy, policyFile));
  assert.ok(!guidancePolicyBindsFile(policy, policyFile.replace("20 words", "200 words")));
  assert.ok(
    policy.authorityRefs!.some((ref) => ref.quote.includes(`${GUIDE_SHARED_WORDS_LIMIT} words in a row`)),
  );
  // It is its own policy: a guide is never released under the templates' one.
  const templates = (await operationalPolicy()).policy;
  assert.notEqual(policy.hash, templates.hash);
  assert.notEqual(policy.version, templates.version);

  // An approval is the approved file's own hash. It approves that text and no other: with the
  // approval as it is recorded, an edited file is not approved.
  const approved = await guidancePolicy({ approvedHash: sha256(policyFile) });
  assert.equal(approved.policy.ownerApproved, true);
  assert.equal(approved.policy.hash, policy.hash, "the recorded approval is that approval");
  const edited = policyFile.replace("every 30 days", "every 60 days");
  const afterEdit = await guidancePolicy({ read: supposedFile(edited) });
  assert.equal(afterEdit.policy.ownerApproved, false, "an edit ends the approval");
  assert.notEqual(afterEdit.policy.version, approved.policy.version);
  // A file that drops a sentence the code depends on, or a host the code allows, is refused.
  await assert.rejects(
    () =>
      guidancePolicy({
        read: supposedFile(
          policyFile.replace("An AI\n   review is never called", "An AI review may be called"),
        ),
      }),
    /GUIDANCE_POLICY_EXCERPT_MISSING/,
  );
  await assert.rejects(
    () =>
      guidancePolicy({
        read: supposedFile(policyFile.replace("`fccpc.gov.ng`", "the consumer commission's site")),
      }),
    /GUIDANCE_POLICY_HOST_NOT_LISTED:fccpc\.gov\.ng/,
  );

  // The thirteen points are the ones decision 0017 puts to the owner, word for word.
  const decision = read("docs/architecture/decisions/0017-clear-guidance-holds.md").replace(/[>\s]+/g, " ");
  const points = policyFile.split("## The policy")[1]!.split("## The official hosts")[0]!;
  const numbered = points
    .split(/\n(?=\d{1,2}\. \*\*)/)
    .map((point) => point.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  assert.equal(numbered.length, 13);
  for (const point of numbered)
    assert.ok(decision.includes(point), `decision 0017 has: ${point.slice(0, 60)}`);
});

test("a guide explains official text and does not copy it: the longest shared run is measured", async () => {
  assert.deepEqual(comparedWords("Section 814(1): “Every individual, firm…”"), [
    "section",
    "814",
    "1",
    "every",
    "individual",
    "firm",
  ]);
  assert.deepEqual(
    longestSharedRun(
      "We keep the register at the head office.",
      "A register kept AT THE HEAD OFFICE, always.",
    ),
    {
      words: 4,
      run: "at the head office",
    },
  );
  assert.equal(longestSharedRun("nothing in common", "entirely different words").words, 0);
  assert.equal(longestSharedRun("", "some words").words, 0);

  let longest = 0;
  for (const id of repositoryBuiltGuideIds) {
    const built = await buildGuideCandidate(id, 1, passages, day);
    const measure = measureCandidateCopying(built);
    assert.equal(measure.limitWords, GUIDE_SHARED_WORDS_LIMIT);
    assert.equal(measure.measured.length, built.sources.length, id);
    assert.ok(measure.withinLimit, `${id} repeats ${measure.longestSharedWords} words in a row`);
    longest = Math.max(longest, measure.longestSharedWords);
  }
  // The ten guides as drafted: no guide repeats more than ten words in a row from a passage it cites.
  assert.equal(longest, 10);

  // A guide that copied a passage's words would fail, however the copy is punctuated or spaced.
  const built = await buildGuideCandidate("GUD-01", 1, passages, day);
  const own = guidePageText(built.candidate.body)!.body;
  const copied = comparedWords(built.sources[0]!.text).slice(10, 10 + GUIDE_SHARED_WORDS_LIMIT + 1);
  const copying = measureGuideCopying(`${own}\n${copied.join(",  ").toUpperCase()}`, built.sources);
  assert.equal(copying.longestSharedWords, GUIDE_SHARED_WORDS_LIMIT + 1);
  assert.equal(copying.withinLimit, false);
  const atLimit = measureGuideCopying(`${own}\n${copied.slice(1).join(" ")}`, built.sources);
  assert.equal(atLimit.longestSharedWords, GUIDE_SHARED_WORDS_LIMIT);
  assert.equal(atLimit.withinLimit, true);
});

test("each amendment record matches the retained texts it describes", () => {
  const retained = (path: string) => JSON.parse(read(path)) as unknown;
  const name = retained("docs/content-candidates/business-name-source-passages.json") as {
    passages: { passageID: string; exactExtractedText: string; textSHA256: string }[];
  };
  const text = (id: string) => {
    const passage = name.passages.find((p) => p.passageID === id)!;
    assert.equal(sha256(passage.exactExtractedText), passage.textSHA256, id);
    return passage.exactExtractedText.replace(/\s+/g, " ");
  };
  const retrieval = [
    ...(retained("docs/content-candidates/business-name-source-retrieval.json") as {
      url: string;
      rawSHA256: string;
      retrievedAt: string;
    }[]),
    ...(retained("docs/content-candidates/source-evidence/registration-tax-retrieval.json") as {
      url: string;
      rawSHA256: string;
      retrievedAt: string;
    }[]),
    retained("docs/content-candidates/source-evidence/nafdac_cap_f33_retrieval.json") as {
      url: string;
      rawSHA256: string;
      retrievedAt: string;
    },
  ];
  const cama = guideAmendmentRecords.find((r) => r.instrument === "CAC-CAMA-2020")!,
    ntaa = guideAmendmentRecords.find((r) => r.instrument === "NASS-NTAA-2025")!,
    f33 = guideAmendmentRecords.find((r) => r.instrument === "NAFDAC-CAP-F33")!;
  assert.equal(guideAmendmentRecords.length, 3 + capturedTexts.length);

  // Each record of an Act kept in the repository describes the very file its passages were read from.
  for (const record of [cama, ntaa, f33]) {
    const fetched = retrieval.find((r) => r.url === record.url);
    assert.equal(fetched?.rawSHA256, record.rawSha256, record.title);
  }
  // Each text read only from captures has a record of its own. The record describes the file at
  // the address of the text's lead, under the checksum the drafts' source evidence recorded for it
  // on 14 November 2026, and gives the day the text's passages are dated from.
  const evidence = [
    ...(
      retained("docs/content-candidates/source-evidence/privacy-consumer-sources.json") as {
        sources: { url: string; pdfSha256: string }[];
      }
    ).sources,
    ...(
      retained("docs/content-candidates/source-evidence/products-sources.json") as {
        url: string;
        sha256: string;
      }[]
    ).map((source) => ({ url: source.url, pdfSha256: source.sha256 })),
    ...(
      retained("docs/content-candidates/source-evidence/employment-sources.json") as {
        url: string;
        sha256: string;
      }[]
    ).map((source) => ({ url: source.url, pdfSha256: source.sha256 })),
  ];
  for (const text of capturedTexts) {
    const record = guideAmendmentRecords.find((r) => r.instrument === text.id);
    assert.ok(record, text.id);
    assert.equal(record.url, allSourceLeads.find((lead) => lead.id === text.leadId)?.url, text.id);
    assert.equal(evidence.find((source) => source.url === record.url)?.pdfSha256, record.rawSha256, text.id);
    assert.equal(record.commencement.effectiveFrom, text.effectiveFrom, text.id);
    assert.equal(record.title, text.title);
    // One text has an open question and an Act left unread: the reference copy of the Labour Act.
    // guidance-claims-captured.test.ts shows that every passage of it is held.
    const settled = record.notRead.length === 0 && record.conflicts.every((conflict) => !conflict.open);
    assert.equal(settled, text.id !== "NIPC-LABOUR-ACT", text.id);
  }
  // The guides' records were made before the fixed day these tests prepare guides on. A record made
  // since, for a checker rule (the NAFDAC Act's, on 24 November 2026), is only never dated ahead.
  const guideRecords = new Set([cama.instrument, ntaa.instrument, ...capturedTexts.map((t) => t.id)]);
  for (const record of guideAmendmentRecords) {
    assert.ok((guidanceOfficialHosts as readonly string[]).includes(new URL(record.url).hostname));
    assert.ok(record.searches.length >= 2, record.title);
    for (const search of record.searches) {
      assert.ok(
        (guidanceOfficialHosts as readonly string[]).includes(new URL(search.url).hostname),
        search.url,
      );
      assert.match(search.rawSha256, /^[a-f0-9]{64}$/);
      assert.ok(
        Date.parse(search.searchedAt) <= (guideRecords.has(record.instrument) ? +day : Date.now()),
        search.url,
      );
    }
    assert.ok(record.limits.includes("No Gazette index was searched"), "the record says what it did not do");
  }

  // The NAFDAC Act: its commencement as its retained text prints it, and nothing found to amend it.
  const f33Pages = retained("docs/content-candidates/source-evidence/nafdac_cap_f33_pages.json") as {
    pages: { pdfPage: number; exactExtractedText: string }[];
  };
  assert.ok(
    f33Pages.pages.find((p) => p.pdfPage === 2)!.exactExtractedText.includes(f33.commencement.printed),
  );
  assert.deepEqual([f33.amendments, f33.notRead, f33.conflicts], [[], [], []]);
  // The Act's own address was among the places searched, and served the file the record describes.
  assert.equal(f33.searches.find((search) => search.url === f33.url)?.rawSha256, f33.rawSha256);

  // The Companies Act: its commencement, and the two amending Acts found. The Business Facilitation
  // Act is checked against its retained text.
  assert.ok(text("CAMA-COMMENCEMENT").includes(cama.commencement.printed));
  const [bfa, finance] = cama.amendments;
  assert.equal(cama.amendments.length, 2);
  assert.equal(retrieval.find((r) => r.url === bfa!.url)?.rawSHA256, bfa!.rawSha256);
  assert.ok(text("BFA-COMMENCEMENT").includes(bfa!.commencement));
  const partOne = text(bfa!.passage!);
  // The record lists every section the amending Act's Part I changes, and no other.
  const amended = [...partOne.matchAll(/Amendment of section (\d+)/g)].map((m) => m[1]!);
  assert.equal(amended.length, 20);
  assert.deepEqual(Object.keys(bfa!.sections).sort(), [...amended].sort());
  for (const [section, change] of Object.entries(bfa!.sections)) {
    assert.ok(partOne.includes(change.quote), `section ${section}: ${change.quote}`);
    assert.match(change.quote, new RegExp(`^Section ${section}\\b`));
  }
  // Only section 868 records what goes, and the amending Act names it in those words.
  assert.deepEqual(
    Object.entries(bfa!.sections)
      .filter(([, change]) => change.removes.length)
      .map(([section]) => section),
    ["868"],
  );
  assert.ok(partOne.includes("deleting the definition of “insolvency practitioner”"));
  // The Finance Act 2020 is a scanned copy, so none of its text is kept. The record gives its one
  // change to the Act as its arrangement of sections prints it, and names nothing it removes: every
  // passage of section 432 counts as changed.
  assert.equal(finance!.title, "Finance Act 2020");
  assert.equal(finance!.passage, undefined);
  assert.deepEqual(finance!.sections, { "432": { quote: "60. Substitution for section 432.", removes: [] } });
  assert.equal(new URL(finance!.url).hostname, "budgetoffice.gov.ng");
  // Nothing known to be able to amend the Act is left unread, and the record says how far it went.
  assert.equal(cama.notRead.length, 0);
  assert.ok(cama.limits.includes("Whether a Finance Act later than 2023 exists was not established"));

  // The tax administration Act: the comparison of its two official copies is recorded as far as it
  // went, and the copies' disagreement about its commencement stays open.
  const tax = retained("docs/content-candidates/source-evidence/registration-tax-passages.json") as {
    passages: { passageID: string; exactExtractedText: string }[];
  };
  const taxText = (id: string) =>
    tax.passages.find((p) => p.passageID === id)!.exactExtractedText.replace(/\s+/g, " ");
  assert.deepEqual(Object.keys(ntaa.comparedSections!), ["4", "7", "11", "31", "33", "147"]);
  // Section 147 was compared for three definitions only, and each is in the retained passage.
  assert.deepEqual(ntaa.comparedSections!["147"]!.only, [
    '"Nigerian Company" means',
    '"Tax Authority" means',
    '"Taxable Person" means',
  ]);
  for (const opening of ntaa.comparedSections!["147"]!.only!)
    assert.ok(taxText("NTAA-147-DEFINITIONS").includes(opening), opening);
  // What the record says of the National Assembly's copy is what its retained passages say.
  assert.ok(taxText("NTAA-4").includes("for the purposes of compliance"));
  assert.ok(taxText("NTAA-7").includes("under subsection (1) of this section"));
  assert.ok(taxText("NTAA-7").includes("under subsection (3) of this section"));
  assert.ok(taxText("NTAA-11").includes("liable to pay tax under Nigeria Tax Act or"));
  assert.ok(taxText("NTAA-11").includes("under paragraph (a) is a paid agent"));
  // The retained words of the Gazette copy's section 31 bear that comparison out.
  const gazette = taxText("NTAA-NRS-31-COMPARATOR"),
    assembly = taxText("NTAA-31");
  for (const words of ["shall be kept for a period not less than six years", "be certified b"])
    assert.ok(gazette.includes(words) && assembly.includes(words), words);
  assert.ok(assembly.includes("under subsection (1) of this section shall be in English language"));
  assert.ok(!gazette.includes("of this section shall be in English"));
  assert.deepEqual(
    ntaa.conflicts.map((c) => [c.sections, c.open]),
    [
      [["148"], true],
      [["4", "7", "11", "31"], false],
    ],
  );
  assert.equal(ntaa.amendments.length, 0);
  assert.equal(ntaa.notRead.length, 0);
});

test("a source is marked current only on the strength of its text's amendment record", () => {
  const passage = (id: string) => passages(id)!;
  assert.deepEqual(locatorSections("section814(1)(a)-(c),814(2)(a)-(c); PDF405–406 / A405–A406"), ["814"]);
  assert.deepEqual(locatorSections("SchedulePartI paragraphs1–21; PDF9–13"), []);
  assert.deepEqual(passage("CAMA-868-forename").sections, ["868"]);

  // Today every passage the ten guides quote is marked current.
  const today = guideSourceDecision(passage("CAMA-814"), day);
  assert.deepEqual(today, {
    status: "approved",
    operativeTextConfirmed: true,
    amendmentsResolved: true,
    reasons: [],
  });
  for (const id of ["NTAA-4", "NTAA-7", "NTAA-11", "NTAA-31", "NTAA-33"])
    assert.equal(guideSourceDecision(passage(id), day).status, "approved", id);
  // Section 147 was compared in part: a quotation from a compared definition is confirmed, one from
  // another definition is not, and a passage with no quotation known is not.
  const definitions = passage("NTAA-147-DEFINITIONS");
  const defined = (quotes?: string[]) => guideSourceDecision(definitions, day, undefined, quotes);
  assert.equal(
    defined(['"Taxable Person" means person who carries out economic activity']).status,
    "approved",
  );
  assert.equal(defined(['"tax  authority"\n means the Nigeria Revenue Service']).status, "approved");
  for (const quotes of [
    undefined,
    [],
    ['"Company" means a company as defined under'],
    ['"Tax Authority" means', '"Person" includes'],
  ]) {
    const decision = defined(quotes);
    assert.deepEqual([decision.status, decision.operativeTextConfirmed], ["held", false]);
    assert.match(
      decision.reasons.join(" "),
      /section 147 has been compared between the official copies only in part/,
    );
  }
  // With less done, a passage is held: an instrument left unread holds every passage of its text,
  // and a section not compared between differing copies is not confirmed.
  const unread = guideSourceDecision(passage("CAMA-814"), day, withUnread);
  assert.deepEqual(
    [unread.status, unread.operativeTextConfirmed, unread.amendmentsResolved],
    ["held", true, false],
  );
  assert.deepEqual(unread.reasons, [
    "not yet read, and able to amend this text: A later amending Act (supposed for this test)",
  ]);
  assert.equal(guideSourceDecision(passage("NTAA-31"), day, oneSectionCompared).status, "approved");
  for (const id of ["NTAA-4", "NTAA-7", "NTAA-11", "NTAA-33", "NTAA-147-DEFINITIONS"]) {
    const decision = guideSourceDecision(passage(id), day, oneSectionCompared);
    assert.deepEqual([decision.status, decision.operativeTextConfirmed], ["held", false], id);
    assert.match(
      decision.reasons[0]!,
      /the official copies of this text differ, and section \d+ has not been compared/,
    );
  }
  // An official page is not an Act: it is approved as what the official address served.
  assert.equal(guideSourceDecision(passage("CAC-BN-PROCESS"), day).status, "approved");
  const elsewhere: GuidePassage = {
    ...passage("CAC-BN-PROCESS"),
    instrument: { ...passage("CAC-BN-PROCESS").instrument, url: "https://example.com/business-name" },
  };
  assert.equal(guideSourceDecision(elsewhere, day).status, "held");

  // What the two amending Acts found do to each passage.
  const approvedIn = (
    p: GuidePassage,
    at = day,
    records: readonly AmendmentRecord[] = guideAmendmentRecords,
  ) => guideSourceDecision(p, at, records).status === "approved";
  assert.ok(approvedIn(passage("CAMA-814")), "section 814 is not amended");
  // Section 868 is amended, by deleting one definition. A passage without that definition stands.
  assert.ok(approvedIn(passage("CAMA-868-forename")));
  assert.ok(approvedIn(passage("CAMA-868-initials")));
  const withDeleted: GuidePassage = {
    ...passage("CAMA-868-initials"),
    text: "“insolvency  practitioner” means a legal practitioner within the meaning of the Legal Practitioners Act",
  };
  assert.match(
    guideSourceDecision(withDeleted, day).reasons.join(" "),
    /Business Facilitation \(Miscellaneous Provisions\) Act 2022 changes section 868/,
  );
  // A passage of a section the amending Act rewrites is held: nothing records what was replaced.
  const rewritten: GuidePassage = { ...passage("CAMA-814"), sections: ["127"] };
  assert.ok(!approvedIn(rewritten));
  // So is a passage of section 432, which the Finance Act 2020 replaces whole.
  assert.match(
    guideSourceDecision({ ...passage("CAMA-814"), sections: ["432"] }, day).reasons.join(" "),
    /Finance Act 2020 changes section 432/,
  );
  // A passage that names no section of a text whose copies differ cannot be confirmed.
  assert.ok(!approvedIn({ ...passage("NTAA-31"), sections: [] }));
  // The open question about section 148 holds a passage of that section, and no other.
  const s148: GuidePassage = { ...passage("NTAA-31"), sections: ["148"] };
  assert.match(
    guideSourceDecision(s148, day, [
      { ...record("NASS-NTAA-2025"), comparedSections: { "148": { method: "supposed", on: "2026-11-21" } } },
    ]).reasons.join(" "),
    /an open question touches this passage: the day the Act commenced/,
  );
  // An open question about the copy itself also leaves the passage unconfirmed as the operative
  // text. One about anything else leaves the text confirmed and its amendments unresolved.
  const questioned = (aboutTheCopy: boolean) => {
    const decision = guideSourceDecision(passage("CAMA-814"), day, [
      {
        ...record("CAC-CAMA-2020"),
        conflicts: [
          {
            about: "supposed for this test",
            sections: "all",
            open: true,
            note: "Supposed for this test.",
            ...(aboutTheCopy ? { aboutTheCopy: true as const } : {}),
          },
        ],
      },
    ]);
    return [decision.status, decision.operativeTextConfirmed, decision.amendmentsResolved];
  };
  assert.deepEqual(questioned(true), ["held", false, false]);
  assert.deepEqual(questioned(false), ["held", true, false]);

  // A record lasts 30 days from its oldest search, and a search cannot be dated ahead.
  const lastDay = new Date(Date.parse("2026-11-21T17:50:37Z") + AMENDMENT_RECORD_DAYS * 86_400_000 - 1000);
  assert.ok(approvedIn(passage("CAMA-814"), lastDay));
  assert.match(
    guideSourceDecision(passage("CAMA-814"), new Date(+lastDay + 2000)).reasons.join(" "),
    /more than 30 days old/,
  );
  assert.ok(
    !approvedIn(passage("CAMA-814"), new Date("2026-11-21T18:00:00Z")),
    "a search dated after the day",
  );
  // A record describes one file. Another file, or no record, confirms nothing.
  const otherFile: GuidePassage = {
    ...passage("CAMA-814"),
    instrument: { ...passage("CAMA-814").instrument, rawSha256: sha256("a changed file") },
  };
  const changed = guideSourceDecision(otherFile, day);
  assert.deepEqual([changed.operativeTextConfirmed, changed.amendmentsResolved], [false, false]);
  assert.deepEqual(guideSourceDecision(passage("CAMA-814"), day, []).reasons, [
    "no amendment record exists for this text",
  ]);
  // A place searched that is not an official host holds.
  const strayHost = guideAmendmentRecords.map((r) => ({
    ...r,
    searches: [...r.searches, { ...r.searches[0]!, url: "https://example.com/acts" }],
  }));
  assert.ok(!approvedIn(passage("CAMA-814"), day, strayHost));
});

test("without the owner's approval the gate holds each guide built from the repository for the policy and what rests on it", async () => {
  // The what-if: the policy file with no approval recorded, as it stood until 22 November 2026.
  const policy = await withoutApproval();
  // What rests on the owner's approval of the policy: the policy itself, the rights record whose
  // basis it is, and the two mechanical checks that read them.
  const waitsOnApproval = [
    "check_failed_or_stale",
    "check_not_passed:rights",
    "check_not_passed:scope",
    "policy_not_owner_approved",
    "rights_not_cleared",
  ];
  // GUD-05 and GUD-08 each rest in part on an official page that is not kept in the repository.
  const unboundSentence = ["legal_scope_unverified", "material_uncertainty"];
  for (const id of repositoryBuiltGuideIds) {
    const { bundle, eligibility, rightsProblems } = await assembled(id, { policy });
    assert.equal(eligibility.decision, "hold", id);
    // Apart from the two reviews, these are the reasons, and there is no other.
    const expected = ["GUD-05", "GUD-08"].includes(id)
      ? [...waitsOnApproval, ...unboundSentence]
      : waitsOnApproval;
    assert.deepEqual(kinds(guideOpenReasons(eligibility)), [...expected].sort(), id);
    for (const reason of reasonsOnlyReviewsClear)
      assert.ok(eligibility.reasons.includes(reason), `${id}: ${reason}`);
    // Every source is marked current.
    assert.ok(
      bundle.sources.every((source) => source.status === "approved"),
      id,
    );
    assert.ok(!eligibility.reasons.some((reason) => reason.startsWith("source_")), id);
    // Eight of the ten mechanical checks pass. The two that fail read the policy and the rights
    // record, which would wait on the owner.
    assert.deepEqual(failed(bundle), ["scope", "rights"], id);
    // The rights record lacks one thing only: the owner's approval of its basis.
    assert.deepEqual(rightsProblems, ["rights_basis_not_approved_by_owner"], id);
    assert.equal(bundle.rights.status, "unknown");
    assert.equal(bundle.reviews.length, 0);
    assert.equal(bundle.manifest.status, "review");
  }
  // With an instrument left unread, the guides that quote its text are held on their sources too.
  const held = await assembled("GUD-01", { records: withUnread, policy });
  assert.deepEqual(
    kinds(guideOpenReasons(held.eligibility)),
    [...waitsOnApproval, ...unboundSentence, "source_unresolved"].sort(),
  );
  assert.ok(
    held.bundle.candidate.missingEvidence.every((line) => /is not marked current: not yet read/.test(line)),
  );
});

test("today a fully bound guide lacks only its two reviews, and two guides wait on a page that is not kept in the repository", async () => {
  // The policy as it stands: the owner approved the file on 22 November 2026.
  const policy = await approvedPolicy();
  assert.equal(policy.ownerApproved, true);
  // Every sentence of these guides is bound to a retained passage.
  const bound = ["GUD-01", "GUD-02", "GUD-03", "GUD-04", "GUD-06", "GUD-07", "GUD-09", "GUD-10"];
  for (const id of bound) {
    const { bundle, eligibility, built } = await assembled(id, { policy });
    assert.deepEqual(guideOpenReasons(eligibility), [], id);
    assert.deepEqual(failed(bundle), [], id);
    assert.equal(bundle.rights.status, "cleared", id);
    assert.equal(bundle.candidate.legalScopeStatus, "verified", id);
    assert.deepEqual(bundle.candidate.missingEvidence, [], id);
    assert.ok(
      bundle.sources.every((s) => s.status === "approved"),
      id,
    );
    assert.deepEqual(await guideClaimScopeProblems(bundle, built.claimScope, day), [], id);
    // It is still held: nothing but two passing reviews makes a bundle eligible.
    assert.equal(eligibility.decision, "hold", id);
    assert.deepEqual([...eligibility.reasons].sort(), [...reasonsOnlyReviewsClear].sort(), id);
  }
  // The two guides that rest on a page not kept in the repository stay held on that sentence.
  for (const id of ["GUD-05", "GUD-08"]) {
    const { bundle, eligibility } = await assembled(id, { policy });
    assert.deepEqual(
      kinds(guideOpenReasons(eligibility)),
      ["check_failed_or_stale", "check_not_passed:scope", "legal_scope_unverified", "material_uncertainty"],
      id,
    );
    assert.deepEqual(failed(bundle), ["scope"], id);
    assert.equal(bundle.rights.status, "cleared", id);
  }

  // With two reviews that both pass, each answering all five enhanced checks from the guide's own
  // sources, the gate's answer is eligible. The reviews here are made up for the test.
  const { bundle } = await assembled("GUD-01", { policy });
  const evidenceHash = digest(bundle.sources);
  const passage = bundle.sources[0]!.text.slice(0, 200);
  const reviews = (["factual", "challenge"] as const).map((role) => ({
    role,
    output: {
      verdict: "pass" as const,
      findings: [],
      missingEvidence: [],
      observations: [],
      enhancedChecks: (
        ["controlling_text", "amendments", "effective_dates", "exceptions", "jurisdiction"] as const
      ).map((name) => ({ name, result: "pass" as const, passage, note: "synthetic" })),
    },
  }));
  const reviewed: PublicationBundle = {
    ...bundle,
    reviews: reviews.map(({ role }) => ({
      runId: `synthetic-${role}`,
      model: "synthetic",
      promptVersion: "synthetic",
      candidateHash: bundle.candidate.hash,
      evidenceHash,
      role,
      verdict: "pass",
      findings: [],
      receivedOtherVerdict: false,
    })),
    enhancedChecks: enhancedChecksFromReviews(bundle, reviews),
  };
  reviewed.manifest = {
    ...bundle.manifest,
    status: "eligible",
    reviewHash: digest({ draft: reviewed.draftRun, reviews: reviewed.reviews }),
    checksHash: digest({ mechanical: reviewed.mechanicalChecks, enhanced: reviewed.enhancedChecks }),
  };
  assert.deepEqual(evaluatePublication(reviewed, day), { decision: "eligible", reasons: [] });
  // The same bundle a day after its review date is held again.
  assert.equal(
    evaluatePublication(reviewed, new Date(Date.parse(bundle.candidate.reviewBy!) + 86_400_000)).decision,
    "hold",
  );
  // And one review that does not pass holds it.
  const oneHolds = structuredClone(reviewed);
  oneHolds.reviews[1]!.verdict = "hold";
  oneHolds.manifest.reviewHash = digest({ draft: oneHolds.draftRun, reviews: oneHolds.reviews });
  assert.ok(evaluatePublication(oneHolds, day).reasons.includes("review_not_clear:challenge"));
});

test("a candidate whose claims or sources were changed after it was built is found out", async () => {
  const policy = await approvedPolicy();
  const { bundle, built } = await assembled("GUD-01", { policy });
  const problems = (change: (b: PublicationBundle) => void, scope = built.claimScope) => {
    const altered = structuredClone(bundle);
    change(altered);
    return guideClaimScopeProblems(altered, scope, day);
  };
  assert.deepEqual(await problems(() => undefined), []);
  // A claim dropped, a quotation shortened, or a source marked current by hand.
  assert.match(
    (await problems((b) => void b.candidate.claims.pop())).join(" "),
    /not what the claim map yields/,
  );
  assert.match(
    (await problems((b) => (b.candidate.claims[0]!.quote = b.candidate.claims[0]!.quote.slice(0, 40)))).join(
      " ",
    ),
    /not what the claim map yields/,
  );
  // Built while an instrument was unread, its Companies Act sources are held. Marking them current
  // by hand is found out, because the record does not support it.
  const { bundle: heldBundle, built: builtHeld } = await assembled("GUD-01", { records: withUnread });
  assert.equal(heldBundle.sources.find((source) => source.id === "CAMA-814")!.status, "held");
  const marked = structuredClone(heldBundle);
  for (const source of marked.sources)
    Object.assign(source, { status: "approved", operativeTextConfirmed: true, amendmentsResolved: true });
  assert.match(
    (await guideClaimScopeProblems(marked, builtHeld.claimScope, day, withUnread)).join(" "),
    /the decision recorded for CAMA-814 is not the one its amendment record supports/,
  );
  // A source's words changed, even with its hash made to match, no longer bear the quotation out.
  assert.match(
    (
      await problems((b) => {
        const source = b.sources.find((s) => s.id === "CAMA-814")!;
        source.text = source.text.replace("shall be registered", "may be registered");
        source.hash = sha256(source.text);
      })
    ).join(" "),
    /no longer builds from the candidate's sources: GUIDE_CLAIM_QUOTE_ANCHOR|not what the claim map yields/,
  );
  // A claim scope recorded for another map, or naming a passage the candidate does not hold.
  assert.match(
    (await problems(() => undefined, { ...built.claimScope, mapDigest: sha256("another map") })).join(" "),
    /the claim map has changed/,
  );
  assert.match(
    (
      await problems(() => undefined, {
        ...built.claimScope,
        passages: built.claimScope.passages.slice(1),
      })
    ).join(" "),
    /a source has no recorded passage/,
  );
});

// Decision 0018 and docs/architecture/reviewed-route.md, part 2: a guide's bundle is judged as any
// version's is. The development owner's check of its sources is not part of the bundle: the publish command
// asks for it before it saves an eligible guide, and the publisher and the database ask again at release.
// Those are tested against a database (the real-bindings test and the migration test).
test("a sourced guide that passes every check is eligible by its bundle, the owner's check being asked for at release", async () => {
  const { evaluatePublication } = await import("@workspace/valo-core");
  const { evaluateOperationalRelease } = await import("./publication-publisher");
  const { syntheticRuleRelease } = await import("../../test-support/synthetic-rule-release");
  const { bundle } = syntheticRuleRelease({
    ruleId: "synthetic-sourced-guidance",
    version: 1,
    condition: { mode: "all", predicates: [{ field: "legalForm", op: "eq", value: "company" }] },
    source: {
      url: "https://www.cac.gov.ng/synthetic-passage",
      text: "Synthetic official passage for a controlled test.",
      quote: "Synthetic official passage",
    },
    now: new Date(),
  });
  assert.equal(bundle.candidate.contentClass, "sourced_guidance");
  assert.deepEqual(evaluateOperationalRelease(bundle), { decision: "eligible", reasons: [] });
  assert.deepEqual(evaluateOperationalRelease(bundle), evaluatePublication(bundle));
});
