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
  comparedSections?: Record<string, { method: string; on: string }>;
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
    const uncompared = passage.sections.filter((s) => !record.comparedSections![s]);
    if (uncompared.length || !passage.sections.length)
      textReasons.push(
        `the official copies of this text differ, and section ${uncompared.join(", ") || "(none named)"} has not been compared between them`,
      );
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

const NASS_ACTS_LIST =
  "https://nass.gov.ng/documents/magazine_track/?draw=1&start=0&length=500&search%5Bvalue%5D=&search%5Bregex%5D=false";

/**
 * The amendment records held today, for the two Acts GUD-01 to GUD-10 quote. Each says what was
 * done and what was not. Neither is complete: see `notRead`, `comparedSections` and `limits`.
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
    ],
    notRead: [
      {
        title: "The Finance Acts made since 2020",
        why: "a Finance Act can amend other Acts, the National Assembly's list holds none of them, and no copy on an official host in the policy has been found",
      },
    ],
    conflicts: [],
    limits:
      "The search covers the National Assembly's published list, the two 2025 tax Acts and the Commission's resources page on the days shown, and the Business Facilitation Act as captured on 14 November 2026; its host could not be reached on 21 November. No Gazette index was searched and no court decision was looked for.",
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
    ],
    amendments: [],
    notRead: [],
    // The Gazette copy the revenue service serves is a scanned image. Its machine-read text is too
    // unreliable to compare by machine, so each section is compared by reading.
    comparedSections: {
      "31": {
        method:
          'Read by an AI assistant against the Gazette copy\'s words, kept as NTAA-NRS-31-COMPARATOR. The two read the same, except that subsection (3) of the National Assembly\'s copy adds "of this section" after "subsection (1)".',
        on: "2026-11-21",
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
        about: "three words in section 31(3)",
        sections: ["31"],
        open: false,
        note: 'The National Assembly\'s copy says "under subsection (1) of this section"; the Gazette copy says "under subsection (1)". Both point to the same subsection.',
      },
    ],
    limits:
      "The search covers the National Assembly's published list and the Nigeria Tax Act 2025 on the days shown. The Gazette copy is a scanned image and has been compared with this copy for section 31 only. No Gazette index was searched and no court decision was looked for.",
  },
];
