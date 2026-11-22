import type { PublicationBundle } from "@workspace/valo-core";
import type { GuidePassage } from "./guidance-passages";
import { guidanceOfficialHosts } from "./guidance-policy";

/**
 * What "current" means for an official text a guide quotes (decision 0017, point 2).
 *
 * A source may be marked approved, with its operative text confirmed and its amendments resolved,
 * only on the strength of an amendment record for its text: where the text was fetched, when it
 * commenced, each official place searched for later amendments, each amending instrument found
 * and what it does to the sections quoted, and every open question. The record must be recent,
 * describe the very file the passages were extracted from, and leave nothing open about a section
 * a guide quotes.
 *
 * A record cannot prove that no later instrument exists. Only a search of every gazette could, and
 * only a qualified person could give an opinion on it. Nothing here is legal review.
 */
export const AMENDMENT_RECORD_DAYS = 30;

export type AmendmentSearch = {
  /** The official place looked in. */
  place: string;
  url: string;
  searchedAt: string;
  /** The SHA-256 of what the address returned. */
  rawSha256: string;
  found: string;
};
export type AmendingInstrument = {
  title: string;
  url: string;
  rawSha256: string;
  capturedAt: string;
  /** Its commencement, as it prints it. */
  commencement: string;
  /** The retained passage holding its provisions on the text, where one is kept. */
  passage?: string;
  /**
   * Each section of the text it changes: its own opening words on that section, and the words of
   * the section it deletes or replaces. A passage of that section is unaffected only when it holds
   * none of those words. Where none are recorded, every passage of the section counts as changed.
   */
  sections: Record<string, { quote: string; removes: readonly string[] }>;
};
export type AmendmentRecord = {
  /** The official text's id, as its passages name it. */
  instrument: string;
  title: string;
  url: string;
  /** The file the record describes. A different file needs a new record. */
  rawSha256: string;
  commencement: { printed: string; effectiveFrom: string };
  searches: readonly AmendmentSearch[];
  amendments: readonly AmendingInstrument[];
  /** Instruments that may amend the text and have not been read. While one is listed, no source
   * from the text is resolved. */
  notRead: readonly { title: string; why: string }[];
  /**
   * Where the text has more than one official copy and they are known to differ: the sections whose
   * wording in this copy has been compared with the other. A passage of any other section is not
   * confirmed as the operative text. Undefined when one official copy is known.
   */
  comparedSections?: Record<
    string,
    {
      method: string;
      on: string;
      /**
       * Where only parts of a long section were compared: the opening words of each part that was.
       * A quotation from the section is confirmed only when it holds one of them.
       */
      only?: readonly string[];
    }
  >;
  /** Differences and open questions. An open one holds every passage of the sections it names. */
  conflicts: readonly { about: string; sections: readonly string[] | "all"; open: boolean; note: string }[];
  limits: string;
};

const DAY = 86_400_000;
const flat = (text: string) => text.replace(/\s+/g, " ").toLowerCase();
const onOfficialHost = (url: string) => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" && (guidanceOfficialHosts as readonly string[]).includes(parsed.hostname)
    );
  } catch {
    return false;
  }
};

export type SourceDecision = {
  status: "approved" | "held";
  operativeTextConfirmed: boolean;
  amendmentsResolved: boolean;
  /** Why the source is not marked current; empty when it is. */
  reasons: string[];
};

/**
 * The decision on one passage as a source, worked out from its text's amendment record.
 *
 * An official page is not an Act: nothing amends it, and it says what it says when it is read. It is
 * approved as what the official address served, and the release binds it to a capture taken within
 * a day.
 */
export function guideSourceDecision(
  passage: GuidePassage,
  now: Date,
  records: readonly AmendmentRecord[] = guideAmendmentRecords,
  /** The quotations a guide binds to the passage, where the caller knows them. */
  quotes?: readonly string[],
): SourceDecision {
  const text = passage.instrument;
  if (text.kind === "official_page") {
    const official = onOfficialHost(text.url);
    return {
      status: official ? "approved" : "held",
      operativeTextConfirmed: official,
      amendmentsResolved: official,
      reasons: official ? [] : ["the page is not on an official host in the policy"],
    };
  }
  const record = records.find((r) => r.instrument === text.id);
  if (!record)
    return {
      status: "held",
      operativeTextConfirmed: false,
      amendmentsResolved: false,
      reasons: ["no amendment record exists for this text"],
    };

  const textReasons: string[] = [];
  if (record.rawSha256 !== text.rawSha256 || record.url !== text.url)
    textReasons.push(
      "the amendment record describes a different file from the one the passage was read from",
    );
  if (record.commencement.effectiveFrom !== text.effectiveFrom)
    textReasons.push("the amendment record gives a different commencement");
  if (!onOfficialHost(record.url)) textReasons.push("the text is not on an official host in the policy");
  if (record.comparedSections) {
    const compared = record.comparedSections;
    const uncompared = passage.sections.filter((s) => !compared[s]);
    if (uncompared.length || !passage.sections.length)
      textReasons.push(
        `the official copies of this text differ, and section ${uncompared.join(", ") || "(none named)"} has not been compared between them`,
      );
    // A section compared in part confirms only quotations from the parts that were compared.
    for (const section of passage.sections) {
      const parts = compared[section]?.only;
      if (!parts) continue;
      const within = (quote: string) => parts.some((part) => flat(quote).includes(flat(part)));
      if (!quotes?.length || !quotes.every(within))
        textReasons.push(
          `section ${section} has been compared between the official copies only in part, and a quotation is from outside that part`,
        );
    }
  }

  const reasons: string[] = [];
  const searched = record.searches.map((s) => Date.parse(s.searchedAt));
  if (!searched.length) reasons.push("no official place was searched for later amendments");
  else if (searched.some((at) => !Number.isFinite(at) || at > +now))
    reasons.push("a search for later amendments is dated in the future or not at all");
  else if (Math.min(...searched) + AMENDMENT_RECORD_DAYS * DAY <= +now)
    reasons.push(`the search for later amendments is more than ${AMENDMENT_RECORD_DAYS} days old`);
  if (record.searches.some((s) => !onOfficialHost(s.url) || !/^[a-f0-9]{64}$/.test(s.rawSha256)))
    reasons.push("a place searched is not on an official host in the policy, or has no checksum");
  for (const unread of record.notRead)
    reasons.push(`not yet read, and able to amend this text: ${unread.title} (${unread.why})`);
  const words = flat(passage.text);
  for (const amending of record.amendments) {
    if (!onOfficialHost(amending.url) || !/^[a-f0-9]{64}$/.test(amending.rawSha256))
      reasons.push(`${amending.title} is not held as a capture from an official host in the policy`);
    for (const section of passage.sections) {
      const change = amending.sections[section];
      if (!change) continue;
      if (!change.removes.length || change.removes.some((removed) => words.includes(flat(removed))))
        reasons.push(
          `${amending.title} changes section ${section}, and the passage may hold the old wording`,
        );
    }
  }
  for (const conflict of record.conflicts) {
    if (!conflict.open) continue;
    if (conflict.sections === "all" || passage.sections.some((s) => conflict.sections.includes(s)))
      reasons.push(`an open question touches this passage: ${conflict.about}`);
  }

  const operativeTextConfirmed = textReasons.length === 0;
  const amendmentsResolved = operativeTextConfirmed && reasons.length === 0;
  return {
    status: amendmentsResolved ? "approved" : "held",
    operativeTextConfirmed,
    amendmentsResolved,
    reasons: [...textReasons, ...reasons],
  };
}

/** A bundle source with the decision its passage's record supports. */
export function decidedSource(
  source: PublicationBundle["sources"][number],
  decision: SourceDecision,
): PublicationBundle["sources"][number] {
  return {
    ...source,
    status: decision.status,
    operativeTextConfirmed: decision.operativeTextConfirmed,
    amendmentsResolved: decision.amendmentsResolved,
  };
}

const BUDGET_OFFICE = "https://budgetoffice.gov.ng/index.php";
const NASS_ACTS_LIST =
  "https://nass.gov.ng/documents/magazine_track/?draw=1&start=0&length=500&search%5Bvalue%5D=&search%5Bregex%5D=false";
const NAFDAC_GUIDELINES_INDEX = "https://nafdac.gov.ng/regulatory-resources/guidelines/";
// What each record of a food regulator's guideline did not do.
const NAFDAC_GUIDELINE_LIMITS =
  "The search covers the regulator's own guidelines index and the guideline's own address, on the days shown. The index calls most copies uncontrolled; what that means for a copy's standing was not established. Whether a regulation or an Act made since changes what the guideline says was not looked for. No Gazette index was searched and no court decision was looked for.";
const NASS_BILL_TRACKER =
  "https://nass.gov.ng/documents/bill_track/?draw=1&start=0&length=3000&search%5Bvalue%5D=&search%5Bregex%5D=false";

/**
 * The amendment records held today: for the two Acts GUD-01 to GUD-10 quote, for the Act and the
 * directive GUD-11 to GUD-15 quote, and for the eight guidelines GUD-19 to GUD-26 quote. Each says what was done and what was not: see `notRead`,
 * `comparedSections`, `conflicts` and `limits`.
 */
export const guideAmendmentRecords: readonly AmendmentRecord[] = [
  {
    instrument: "CAC-CAMA-2020",
    title: "Companies and Allied Matters Act 2020",
    url: "https://icrp.cac.gov.ng/assets/docs/CAMA-NOTE%20FINAL-FULL-VERSION.pdf",
    rawSha256: "d39745af4eaeceb8dbdc3678bb5d072b48ad5e022ead3b1cec7f94b88b01a2c8",
    commencement: { printed: "[7th Day of August, 2020]", effectiveFrom: "2020-08-07T00:00:00+01:00" },
    searches: [
      {
        place: "National Assembly: its list of Acts and publications",
        url: NASS_ACTS_LIST,
        searchedAt: "2026-11-21T19:51:43Z",
        rawSha256: "25274f83bbd57258cfa1e835ff7ba50fbe14e22227b3c9f5c154bb5c5810872e",
        found: "182 entries. None names the Companies and Allied Matters Act.",
      },
      {
        place: "National Assembly: Nigeria Tax Act 2025",
        url: "https://nass.gov.ng/documents/download/11249",
        searchedAt: "2026-11-21T19:52:57Z",
        rawSha256: "41abf6887bc58a3c97116fd9a048aa91ad49c1cab156f39065a58401c0fce94f",
        found: "The Act does not name the Companies and Allied Matters Act.",
      },
      {
        place: "National Assembly: Nigeria Tax Administration Act 2025",
        url: "https://nass.gov.ng/documents/download/11250",
        searchedAt: "2026-11-21T17:50:37Z",
        rawSha256: "eb3ea717052f48492cc6441ad23f9e7ac2ad4782395db1c391580cc1adef20e2",
        found:
          'The Act names the Companies and Allied Matters Act once, to define "Company". It changes nothing in it.',
      },
      {
        place: "Corporate Affairs Commission: its resources page",
        url: "https://www.cac.gov.ng/resources",
        searchedAt: "2026-11-21T19:51:21Z",
        rawSha256: "8df0e8fae0ec39d2f66082021942209b899cb2ffdd40ba3b8fd46b6b888211bd",
        found: "The page links to the Commission's procedures and fees. It lists no amending instrument.",
      },
      {
        place: "Budget Office of the Federation: Finance Act 2021",
        url: `${BUDGET_OFFICE}/resources/internal-resources/budget-documents/finance-act-2021/download`,
        searchedAt: "2026-11-21T20:19:08Z",
        rawSha256: "12fea86def009aade42b2cff875ee8f25b9b8fe2cfe2580b850cfc3003d28ba5",
        found:
          "Thirteen parts, none for the Companies and Allied Matters Act. It names that Act once, in a provision on capital gains.",
      },
      {
        place: "Budget Office of the Federation: Finance Act 2023",
        url: `${BUDGET_OFFICE}/finance-act-2023/finance-act-2023-2/download`,
        searchedAt: "2026-11-21T20:19:21Z",
        rawSha256: "9264789296e39bdd104480dec3e28a5c7170dbca97887f8b24586d0416baf11b",
        found:
          "A scanned copy. Its arrangement of sections, read from the page images, lists twelve parts, none for the Companies and Allied Matters Act.",
      },
      {
        place: "Budget Office of the Federation: the Gazette with the Finance Act 2019",
        url: `${BUDGET_OFFICE}/resources/internal-resources/policy-documents/ogp/2020-finance-act/download`,
        searchedAt: "2026-11-21T20:18:56Z",
        rawSha256: "7bcbccd05494fba233b0305167fc4302c12dcdf6249d027d968b549d311e9760",
        found:
          "The Official Gazette of 14 January 2020 with the Finance Act 2019, made before the Companies and Allied Matters Act 2020.",
      },
      {
        place: "National Assembly: Nigeria Revenue Service (Establishment) Act 2025",
        url: "https://nass.gov.ng/documents/download/11251",
        searchedAt: "2026-11-21T20:21:45Z",
        rawSha256: "c100f5f10b089ae9a162c0c05fe8ba425b0b79ae936065aa0788893a8ef2b2a8",
        found:
          "The Act names the Companies and Allied Matters Act once, for directors' duties. It changes nothing in it.",
      },
      {
        place: "National Assembly: Joint Revenue Board of Nigeria (Establishment) Act 2025",
        url: "https://nass.gov.ng/documents/download/11247",
        searchedAt: "2026-11-21T20:21:46Z",
        rawSha256: "97b648230dee2f6fc1e9f5248343dfb8d6c6d17b4c2d38abe661abee6201e458",
        found:
          "The Act names the Companies and Allied Matters Act once, for directors' duties. It changes nothing in it.",
      },
    ],
    amendments: [
      {
        title: "Business Facilitation (Miscellaneous Provisions) Act 2022",
        url: "https://nipc.gov.ng/assets/resources/business-facilitation-miscellaneous-provisions-act-2022/business-facilitation-misc-provisions-act-2022.pdf",
        rawSha256: "c268648489af515bad45694197fa80d6ba8f5c0485a8cc0bf56cfa08b1417b14",
        capturedAt: "2026-11-14T08:33:25.251Z",
        commencement: "[8th Day of February, 2023]",
        passage: "BFA-PART-I",
        sections: {
          "78": {
            quote:
              "Section 78 of the Principal Act is amended in subsection (3) by inserting after paragraph (b), a new paragraph “(c)”",
            removes: [],
          },
          "127": {
            quote:
              "Section 127 of the Principal Act is amended by substituting for subsection (1), a new subsection “(1)”",
            removes: [],
          },
          "142": { quote: "Section 142 of the Principal Act is amended in", removes: [] },
          "149": { quote: "Section 149 of the Principal Act is amended by", removes: [] },
          "154": {
            quote:
              "Section 154 of the Principal Act is amended in subsection (1) by substituting for the words “one month”, the expression",
            removes: [],
          },
          "171": {
            quote:
              "Section 171 of the Principal Act is amended by inserting after subsection (6), a new subsection “(7)”",
            removes: [],
          },
          "181": { quote: "Section 181 of the Principal Act is amended by", removes: [] },
          "207": {
            quote:
              "Section 207 of the Principal Act is amended by substituting for subsection (4), a new subsection “(4)”",
            removes: [],
          },
          "222": {
            quote:
              "Section 222 of the Principal Act is amended by inserting in subsection (13), in alphabetical order, the interpretations of",
            removes: [],
          },
          "240": {
            quote: "Section 240 (2) of the Principal Act is amended by deleting the word",
            removes: [],
          },
          "244": { quote: "Section 244 of the Principal Act is amended by", removes: [] },
          "248": {
            quote:
              "Section 248 (1) of the Principal Act is amended by inserting after the words, “show of hands”, the words “or electronic voting”",
            removes: [],
          },
          "275": { quote: "Section 275 of the Principal Act is amended by", removes: [] },
          "283": {
            quote:
              "Section 283 of the Principal Act is amended by substituting for paragraph (c), a new paragraph “(c)”",
            removes: [],
          },
          "307": {
            quote:
              "Section 307 of the Principal Act is amended by substituting for subsection (3), a new subsection “(3)”",
            removes: [],
          },
          "378": {
            quote:
              "Section 378 of the Principal Act is amended by substituting for subsection (1), a new subsection “(1)”",
            removes: [],
          },
          "394": {
            quote:
              "Section 394 of the Principal Act is amended by substituting for subsection (2), a new subsection “(2)”",
            removes: [],
          },
          "572": {
            quote:
              "Section 572 of the Principal Act is amended in paragraph (a), by substituting for the expression “a sum exceeding N200,000”",
            removes: [],
          },
          "658": {
            quote:
              "Section 658 of the Principal Act is amended in subsection (6), by substituting for the words “period of years”",
            removes: [],
          },
          // The one amended section a guide quotes. Only the named definition goes; a passage of
          // section 868 that does not hold it is unchanged.
          "868": {
            quote:
              "Section 868 of the Principal Act is amended by deleting the definition of “insolvency practitioner”.",
            removes: ["insolvency practitioner"],
          },
        },
      },
      {
        // A scanned copy: no passage of it is kept. Its long title names the Companies and Allied
        // Matters Act No. 3, 2020, and its Part XII holds one section, as its arrangement prints it.
        title: "Finance Act 2020",
        url: `${BUDGET_OFFICE}/resources/internal-resources/budget-documents/finance-act-2020/download`,
        rawSha256: "9b9148fcc191df6f42738e6fe4f4280f7dd087a794f52682a529dbe7cdeb3633",
        capturedAt: "2026-11-21T20:18:32Z",
        commencement:
          "This Act takes effect from 1 January, 2021 or such other date that shall be indicated by the National Assembly by law (or by Presidential Order).",
        // The whole of section 432 is replaced, so every passage of it counts as changed.
        sections: { "432": { quote: "60. Substitution for section 432.", removes: [] } },
      },
    ],
    notRead: [],
    conflicts: [],
    limits:
      "The search covers the National Assembly's published list, the four revenue Acts of 2025, the Finance Acts of 2020, 2021 and 2023 as the Budget Office serves them, and the Commission's resources page, on the days shown, and the Business Facilitation Act as captured on 14 November 2026; its host could not be reached on 21 November. The Finance Acts of 2020 and 2023 are scanned copies, read from their page images by an AI assistant. Whether a Finance Act later than 2023 exists was not established. No Gazette index was searched and no court decision was looked for.",
  },
  {
    instrument: "NASS-NTAA-2025",
    title: "Nigeria Tax Administration Act 2025",
    url: "https://nass.gov.ng/documents/download/11250",
    rawSha256: "eb3ea717052f48492cc6441ad23f9e7ac2ad4782395db1c391580cc1adef20e2",
    // The National Assembly's copy prints 26 June 2025; the later day, which the Gazette copy
    // prints, is used: under either copy the Act is in force from it.
    commencement: { printed: "[26th June, 2025]", effectiveFrom: "2026-01-01T00:00:00+01:00" },
    searches: [
      {
        place: "National Assembly: its list of Acts and publications",
        url: NASS_ACTS_LIST,
        searchedAt: "2026-11-21T19:51:43Z",
        rawSha256: "25274f83bbd57258cfa1e835ff7ba50fbe14e22227b3c9f5c154bb5c5810872e",
        found:
          "182 entries. One names the Nigeria Tax Administration Act: the Act itself. None is an Act amending it.",
      },
      {
        place: "National Assembly: Nigeria Tax Act 2025",
        url: "https://nass.gov.ng/documents/download/11249",
        searchedAt: "2026-11-21T19:52:57Z",
        rawSha256: "41abf6887bc58a3c97116fd9a048aa91ad49c1cab156f39065a58401c0fce94f",
        found:
          "Its repeals (section 195) and consequential amendments (section 196) do not name the Nigeria Tax Administration Act.",
      },
      {
        place: "National Assembly: Nigeria Revenue Service (Establishment) Act 2025",
        url: "https://nass.gov.ng/documents/download/11251",
        searchedAt: "2026-11-21T20:21:45Z",
        rawSha256: "c100f5f10b089ae9a162c0c05fe8ba425b0b79ae936065aa0788893a8ef2b2a8",
        found:
          "The Act refers to the Nigeria Tax Administration Act and repeals the Federal Inland Revenue Service (Establishment) Act 2007. It changes nothing in the Nigeria Tax Administration Act.",
      },
      {
        place: "National Assembly: Joint Revenue Board of Nigeria (Establishment) Act 2025",
        url: "https://nass.gov.ng/documents/download/11247",
        searchedAt: "2026-11-21T20:21:46Z",
        rawSha256: "97b648230dee2f6fc1e9f5248343dfb8d6c6d17b4c2d38abe661abee6201e458",
        found:
          "The Act refers to the Nigeria Tax Administration Act once. Its consequential amendment deletes section 86 of the Personal Income Tax Act; it changes nothing in the Nigeria Tax Administration Act.",
      },
    ],
    amendments: [],
    notRead: [],
    // The Gazette copy the revenue service serves is a scanned image. Its machine-read text is too
    // unreliable to compare by machine, so each section is compared by reading.
    comparedSections: {
      "4": {
        method:
          'Read by an AI assistant against page A 266 of the Gazette copy. The two read the same, except that the Gazette copy says "for the purpose of compliance" where the National Assembly\'s copy says "for the purposes of compliance".',
        on: "2026-11-21",
      },
      "7": {
        method:
          'Read by an AI assistant against page A 267 of the Gazette copy. The two read the same, except that subsections (2) and (4) of the National Assembly\'s copy add "of this section" after the subsection they name.',
        on: "2026-11-21",
      },
      "11": {
        method:
          'Read by an AI assistant against pages A 269 and A 270 of the Gazette copy. The two read the same, except that the Gazette copy writes "Nigeria Tax Act, 2025" where the National Assembly\'s copy writes "Nigeria Tax Act", three times, and in subsection (6)(b) says "pursuant to paragraph (a) of this subsection" where the National Assembly\'s copy says "under paragraph (a)".',
        on: "2026-11-21",
      },
      "31": {
        method:
          'Read by an AI assistant against the Gazette copy\'s words, kept as NTAA-NRS-31-COMPARATOR, and its page A 281. The two read the same, except that subsection (3) of the National Assembly\'s copy adds "of this section" after "subsection (1)".',
        on: "2026-11-21",
      },
      "33": {
        method:
          "Read by an AI assistant against page A 281 of the Gazette copy. The two read the same word for word; the National Assembly's copy has one comma more, in subsection (4)(b).",
        on: "2026-11-21",
      },
      "147": {
        method:
          "The three definitions the guides quote were read by an AI assistant against pages A 330 and A 332 of the Gazette copy. They read the same; the Gazette copy writes the defined terms without capital letters. The rest of section 147 was not compared.",
        on: "2026-11-21",
        only: ['"Nigerian Company" means', '"Tax Authority" means', '"Taxable Person" means'],
      },
    },
    conflicts: [
      {
        about: "the day the Act commenced, and the words of section 148",
        sections: ["148"],
        open: true,
        note: "The National Assembly's copy prints 26 June 2025 at its head, and its section 148 gives the Act's name only. The Gazette copy served by the revenue service prints 1 January 2026 at its head, and its section 148 says the Act comes into effect on 1 January 2025. Both places in the Gazette copy were read from the page images by an AI assistant on 21 November 2026. Under every one of these the Act is in force from 1 January 2026, the day used here. No guide states when the Act commenced, and none may while this is open.",
      },
      {
        about: "small differences of wording between the two official copies",
        sections: ["4", "7", "11", "31"],
        open: false,
        note: 'Section 4: "purpose" in the Gazette copy, "purposes" in the National Assembly\'s. Sections 7(2), 7(4) and 31(3): the National Assembly\'s copy adds "of this section". Section 11: the Gazette copy adds ", 2025" after "Nigeria Tax Act" three times, and words subsection (6)(b) differently. None is in a number, a time limit or who must act. The guides quote the National Assembly\'s copy.',
      },
    ],
    limits:
      "The search covers the National Assembly's published list and the other three revenue Acts of 2025 on the days shown. The Gazette copy is a scanned image: sections 4, 7, 11, 31 and 33 and three definitions of section 147 were compared with it by reading its page images, and no other section was. No Gazette index was searched and no court decision was looked for.",
  },
  {
    instrument: "NDPC-NDPA-2023",
    title: "Nigeria Data Protection Act 2023",
    url: "https://ndpc.gov.ng/wp-content/uploads/2024/03/Nigeria_Data_Protection_Act_2023.pdf",
    rawSha256: "5bfb22cf7b344e92ecca9b80decf73db694a0d1000c4f42188f46e047d8df075",
    commencement: { printed: "[12th Day of June, 2023]", effectiveFrom: "2023-06-12T00:00:00+01:00" },
    searches: [
      {
        place: "National Assembly: its list of Acts and publications",
        url: NASS_ACTS_LIST,
        searchedAt: "2026-11-22T00:03:51Z",
        rawSha256: "25274f83bbd57258cfa1e835ff7ba50fbe14e22227b3c9f5c154bb5c5810872e",
        found:
          "182 entries. None names the Nigeria Data Protection Act. The list does not hold every Act: it does not hold this one.",
      },
      {
        place: "National Assembly: its bill tracker",
        url: NASS_BILL_TRACKER,
        searchedAt: "2026-11-22T00:05:45Z",
        rawSha256: "7b5d0c91b99792af3adde4395df027d64a1dd7090092d8ea8b73e569584c08f6",
        found:
          "2,660 bills. One names the Act: SB.648, a Senate bill to make social media platforms keep offices in Nigeria. The tracker shows its first reading on 21 November 2024 and its second on 18 March 2025, and no committee stage or third reading.",
      },
      {
        place: "Nigeria Data Protection Commission: its resources page",
        url: "https://ndpc.gov.ng/resources/",
        searchedAt: "2026-11-22T00:04:12Z",
        rawSha256: "e2e1be060ea62c5c0477e8e89c9c2d4d6488d2335d095acd532f86fb79a6ca55",
        found:
          "25 documents. The Act is offered at the address this copy was fetched from. No amending Act is among them.",
      },
      {
        place: "National Assembly: Nigeria Tax Administration Act 2025",
        url: "https://nass.gov.ng/documents/download/11250",
        searchedAt: "2026-11-21T17:50:37Z",
        rawSha256: "eb3ea717052f48492cc6441ad23f9e7ac2ad4782395db1c391580cc1adef20e2",
        found:
          "The Act names data protection once, in section 142, which leaves other Acts on data protection as they are. It changes nothing in the Nigeria Data Protection Act.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [
      {
        about: "a bill before the Senate to amend the Act",
        sections: "all",
        open: false,
        note: "SB.648 would add duties for social media platforms. A bill changes nothing until it is passed and assented to, and the National Assembly's tracker shows no third reading. A web search on 22 November 2026 found press reports of July 2026 about a bill of this kind, and none saying it had been passed; those reports are not official and were read only as search results. The bill's own file came back empty that day and was not read. If it becomes law, this record is out of date and every passage of the Act must be read again.",
      },
    ],
    limits:
      "The search covers the National Assembly's published list and its bill tracker, the Commission's resources page and the Nigeria Tax Administration Act 2025, on the days shown. The National Assembly's list does not hold every Act. No Gazette index was searched, no court decision was looked for, and the bill before the Senate was not read.",
  },
  {
    instrument: "NDPC-GAID-2025",
    title: "Nigeria Data Protection Act General Application and Implementation Directive 2025",
    url: "https://ndpc.gov.ng/wp-content/uploads/2025/07/NDP-ACT-GAID-2025-MARCH-20TH.pdf",
    rawSha256: "e4359e90c9a11cd772f9605c797d6f36af000c58a27bfba251fa37a89824cc5a",
    // The directive prints the day it was issued and no day for taking effect. The later day
    // reported for it is used: see `conflicts`.
    commencement: {
      printed: "Issued under my hand this 20th Day of March, 2025",
      effectiveFrom: "2025-09-19T00:00:00+01:00",
    },
    searches: [
      {
        place: "Nigeria Data Protection Commission: its resources page",
        url: "https://ndpc.gov.ng/resources/",
        searchedAt: "2026-11-22T00:04:12Z",
        rawSha256: "e2e1be060ea62c5c0477e8e89c9c2d4d6488d2335d095acd532f86fb79a6ca55",
        found:
          "25 documents. The directive is offered at the address this copy was fetched from. No later edition of it and no amending directive is among them.",
      },
      {
        place: "Nigeria Data Protection Commission: its home page",
        url: "https://ndpc.gov.ng/",
        searchedAt: "2026-11-22T00:04:00Z",
        rawSha256: "99e6cfb34fcf50712134c9e7b1ca88e274da3f5cb7d745c1ee52c9e48853d3ef",
        found:
          "The page links to the directive at the same address. No line of the page mentions an amendment or a later directive.",
      },
      {
        place: "Nigeria Data Protection Commission: its guidance notice of 26 June 2026",
        url: "https://ndpc.gov.ng/wp-content/uploads/2026/06/Guidance-Notice-on-CPD-for-Data-Protection-Officers.pdf",
        searchedAt: "2026-11-22T00:04:37Z",
        rawSha256: "4ad25919d158653eb5037f3ebfafe83d80666161eeb7c40742cbdf73cc8bbc2d",
        found:
          "Guidance on Article 14 and Schedule 3 of the directive, the assessment of data protection officers. It does not say that it amends the directive.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [
      {
        about: "the day the directive took effect",
        sections: "all",
        open: false,
        note: "The directive prints the day it was issued, 20 March 2025, and no day for taking effect. A web search on 22 November 2026 found law firms' notes and press reports saying the Commission set 19 September 2025. No statement of that day was found on the Commission's own site. The later day is used here: on either account the directive is in force from it. No guide states when the directive took effect.",
      },
    ],
    limits:
      "The search covers the Commission's home page, its resources page and its guidance notice of 26 June 2026, on the day shown. The Commission's news pages were not read through. No Gazette index was searched and no court decision was looked for. Whether the Commission has said anything elsewhere that changes how the directive applies was not established.",
  },
  {
    instrument: "NAFDAC-FSAN-GDL-004-03",
    title:
      "Guidelines for Production Inspection of Micro Scale Food Manufacturing Facilities in Nigeria (New Applicants)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guidelines-for-Inspection-of-Micro-Scale-Enterprises-in-Nigeria.pdf",
    rawSha256: "e886bb426318c246fe0795fd3861e0c1b90f95629f6ac67aed4acb5c79f757d3",
    commencement: { printed: "Effective Date: 13/10/2025", effectiveFrom: "2025-10-13T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Uncontrolled" and a review date of 12 October 2030. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guidelines-for-Inspection-of-Micro-Scale-Enterprises-in-Nigeria.pdf",
        searchedAt: "2026-11-21T17:50:23Z",
        rawSha256: "e886bb426318c246fe0795fd3861e0c1b90f95629f6ac67aed4acb5c79f757d3",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-FSAN-GDL-005-03",
    title: "Guidelines for Production Inspection of Small Scale Food Enterprises in Nigeria (New Applicants)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guidelines-for-Inspection-of-Small-Scale-Enterprises.pdf",
    rawSha256: "ed0eb2e3c7a93cefc8ceb7be1e49485c07f41d3b67bf5638c66e43649e71108b",
    commencement: { printed: "Effective Date: 13/10/2025", effectiveFrom: "2025-10-13T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Uncontrolled" and a review date of 12 October 2030. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guidelines-for-Inspection-of-Small-Scale-Enterprises.pdf",
        searchedAt: "2026-11-21T17:50:21Z",
        rawSha256: "ed0eb2e3c7a93cefc8ceb7be1e49485c07f41d3b67bf5638c66e43649e71108b",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-FSAN-GDL-001-03",
    title:
      "Guidelines for Inspection and Requirements for Pre-packaged Food Manufacturing/Packaging Facilities in Nigeria",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guideline-for-Inspection-and-Requirements-for-Pre-Packaged-Food-Facilities-in-Nigeria.pdf",
    rawSha256: "73d97cf33bce46abd7a49a0861a1d1b2d2882f641d2c2418855bec96c4e0a01e",
    commencement: { printed: "Effective Date: 22/10/2025", effectiveFrom: "2025-10-22T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Uncontrolled" and a review date of 21 October 2030. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guideline-for-Inspection-and-Requirements-for-Pre-Packaged-Food-Facilities-in-Nigeria.pdf",
        searchedAt: "2026-11-21T17:50:25Z",
        rawSha256: "73d97cf33bce46abd7a49a0861a1d1b2d2882f641d2c2418855bec96c4e0a01e",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-FRRA-GDL-002-01",
    title: "Guidelines for Registration of Pre-packaged Food Products Made in Nigeria",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FR_and_R/Guidelines-for-Registration-of-Food-Products-Made-in-Nigeria.pdf",
    rawSha256: "cd126bb61bd7593b35d1a1ea4ef4f2ee6ce294cbc538cd777a63b1c72bf8204a",
    commencement: { printed: "Effective Date: 01/03/2026", effectiveFrom: "2026-03-01T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Published (Uncontrolled)" and a review date of 28 February 2031. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FR_and_R/Guidelines-for-Registration-of-Food-Products-Made-in-Nigeria.pdf",
        searchedAt: "2026-11-21T17:50:24Z",
        rawSha256: "cd126bb61bd7593b35d1a1ea4ef4f2ee6ce294cbc538cd777a63b1c72bf8204a",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-FSAN-GDL-006-03",
    title: "Current Good Manufacturing Practice Guidelines for Food and Food Products (Revised)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Current-Good-Manufacturing-Practice-Guidelines-for-Food-and-Food-Products.pdf",
    rawSha256: "c01d8664329296b37977144d5c1c224576e56e29d87a0e234e71912f430f0f42",
    commencement: { printed: "Effective Date: 13/10/2025", effectiveFrom: "2025-10-13T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Uncontrolled" and a review date of 12 October 2030. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Current-Good-Manufacturing-Practice-Guidelines-for-Food-and-Food-Products.pdf",
        searchedAt: "2026-11-21T17:50:17Z",
        rawSha256: "c01d8664329296b37977144d5c1c224576e56e29d87a0e234e71912f430f0f42",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-FSAN-GDL-008-03",
    title: "NAFDAC Guidelines for Food Hygienic Practices (NGFHP)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/NAFDAC-Guidelines-for-Food-Hygienic-Practices.pdf",
    rawSha256: "f65f8912782749003aa7a2d09ad934480f9f799de671fe5e94a1fbdf7e1d7974",
    commencement: { printed: "Effective Date: 13/10/2025", effectiveFrom: "2025-10-13T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Uncontrolled" and a review date of 12 October 2030. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/NAFDAC-Guidelines-for-Food-Hygienic-Practices.pdf",
        searchedAt: "2026-11-21T17:50:19Z",
        rawSha256: "f65f8912782749003aa7a2d09ad934480f9f799de671fe5e94a1fbdf7e1d7974",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-IE-GDL-001-02",
    title:
      "Guidelines for Handling and Disposal of Unwholesome Medicines and NAFDAC Regulated Products in Nigeria",
    url: "https://www.nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/INVESTIGATION_ENFORCEMENT_GUIDELINES/Guidelines-for-Handling-and-Disposal-of-Unwholesome-Medicines-and-Other-NAFDAC-Regulated-Products.pdf",
    rawSha256: "5af7328e2d8b26dcaed2ddc493dce02d20b01b759dfb124a11ca2aed3ba4d239",
    commencement: { printed: "Effective Date: 26/11/2024", effectiveFrom: "2024-11-26T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Published" and a review date of 25 November 2029. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://www.nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/INVESTIGATION_ENFORCEMENT_GUIDELINES/Guidelines-for-Handling-and-Disposal-of-Unwholesome-Medicines-and-Other-NAFDAC-Regulated-Products.pdf",
        searchedAt: "2026-11-21T17:50:26Z",
        rawSha256: "5af7328e2d8b26dcaed2ddc493dce02d20b01b759dfb124a11ca2aed3ba4d239",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
  {
    instrument: "NAFDAC-FRR-GDL-003-01",
    title: "Guidelines for Advertisement of Food Products in Nigeria",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FR_and_R/Guidelines-for-Advertisement-Control-of-Food-Products-in-Nigeria-Revised.pdf",
    rawSha256: "31c5bb7228b000f51de736bcf9610fd5e2fa97b17a6b0d549083b958641f87ce",
    commencement: { printed: "Effective Date: 01/03/2026", effectiveFrom: "2026-03-01T00:00:00+01:00" },
    searches: [
      {
        place: "NAFDAC: its guidelines index",
        url: NAFDAC_GUIDELINES_INDEX,
        searchedAt: "2026-11-22T00:40:42Z",
        rawSha256: "f008dbaa73a937c84adc523aaea54017aabeed2389893469edaf4fcbe367cc99",
        found:
          'The page\'s table is filled by script from the same site. Read in a browser, its data lists 171 guidelines. This one is listed once, at the address this copy was fetched from, with the status "Published (Uncontrolled)" and a review date of 28 February 2031. No other edition of it is listed.',
      },
      {
        place: "NAFDAC: the guideline's own address",
        url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FR_and_R/Guidelines-for-Advertisement-Control-of-Food-Products-in-Nigeria-Revised.pdf",
        searchedAt: "2026-11-21T17:50:25Z",
        rawSha256: "31c5bb7228b000f51de736bcf9610fd5e2fa97b17a6b0d549083b958641f87ce",
        found: "The address returned the same file as on 14 November 2026.",
      },
    ],
    amendments: [],
    notRead: [],
    conflicts: [],
    limits: NAFDAC_GUIDELINE_LIMITS,
  },
];
