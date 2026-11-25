import { manualJointTaxIdUrl, manualMinistryLabourUrl, sha256 } from "@workspace/valo-core";
import type { ManualRegulatorySource } from "@workspace/db";
import {
  AMENDMENT_RECORD_DAYS,
  capturedGuidePassages,
  guideAmendmentRecords,
  guidePassageIds,
  type AmendmentRecord,
  type GuidePassages,
} from "../publication";
import type { readManualOfficialSource } from "../sources";

type Capture = Awaited<ReturnType<typeof readManualOfficialSource>>;
const jointPageTextSha256 = "976849d7a83b7045ba28d6d8db4a9ccbfcb42c8b7ce6e346d274424d9554359d";
const ministryEditionSha256 = "a53b7028b803a6c4a6879df5f63aee2c9abda98bef71de5210e73630bd6fd4bc";
const registeredEditionSha256 = "ee8bf3aa6607d6322327b51cc882f139d3e9a3c5bff9243b360dc122daae3eb6";
const ministryLocations: Record<string, string> = {
  "GUD-27": "Sections 7 and 91, PDF pp. 7–8 and 54. Written particulars and the definition of worker.",
  "GUD-28":
    "Sections 5(1), (5), (7) and 91, PDF pp. 5–6 and 54. Deductions, overpayments and the definition of worker.",
  "GUD-29": "Sections 18 and 91, PDF pp. 12–13 and 54. Annual holidays and the definition of worker.",
  "GUD-30": "Section 54, PDF pp. 30–31. Maternity protection, pay conditions, nursing and notice.",
};

export const hasMinistryComparison = (id: string) => Object.hasOwn(ministryLocations, id);

/** Keep each issuer attached to the text it actually served. The manual permission is for
 * one canonical page. A changed visible page needs a new reading against the joint notice. */
export function manualCheckedPassages(captures: readonly Capture[]): GuidePassages {
  const usual = capturedGuidePassages(captures);
  const page = captures.find((c) => c.leadId === "JRB-TAXID-HOW" && c.url === manualJointTaxIdUrl);
  return (id) => {
    if (id !== "TAXID-HOW-IT-WORKS") return usual(id);
    if (!page || sha256(page.text.trim()) !== jointPageTextSha256) return undefined;
    return {
      id,
      recordedLocator: "How Tax ID Retrieval Works",
      text: page.text.trim(),
      hash: jointPageTextSha256,
      sections: [],
      instrument: {
        id: page.leadId,
        kind: "official_page",
        title: "Joint Revenue Board: how Tax ID retrieval works",
        issuingBody: "Joint Revenue Board",
        url: page.url,
        rawSha256: page.rawChecksum,
        retrievedAt: page.checkedAt,
        effectiveFrom: page.checkedAt,
      },
    };
  };
}

const comparedSections: NonNullable<AmendmentRecord["comparedSections"]> = {
  "5": {
    method:
      "Compared the deductions section, including the proviso, with the Ministry copy and printed Cap. L1 pp. 5–6.",
    on: "2026-11-22",
  },
  "7": {
    method: "Compared the written particulars section with the Ministry copy and printed Cap. L1 pp. 7–8.",
    on: "2026-11-22",
  },
  "18": {
    method: "Compared all four annual holiday subsections with the Ministry copy and printed Cap. L1 p. 13.",
    on: "2026-11-22",
  },
  "54": {
    method: "Compared the maternity section with the Ministry copy and printed Cap. L1 pp. 30–31.",
    on: "2026-11-22",
  },
  "91": {
    method: "Compared the worker definition and exclusions with the Ministry copy and printed Cap. L1 p. 54.",
    on: "2026-11-22",
    only: [
      '"worker" means any person who has entered into',
      "persons exercising administrative, executive, technical or professional",
    ],
  },
};

/** These findings apply only when both freshly fetched documents supply the full passages.
 * Other unread instruments, differences and their ordinary expiry still hold the release. */
export function compareManualEmployment(
  id: string,
  captures: readonly Capture[],
  passages: GuidePassages,
): { records?: readonly AmendmentRecord[]; sources: ManualRegulatorySource[]; holds: string[] } {
  if (!hasMinistryComparison(id)) return { sources: [], holds: [] };
  const base = guideAmendmentRecords.find((r) => r.instrument === "NIPC-LABOUR-ACT");
  const ministry = captures.find((c) => c.leadId === "NELEX-LABOUR-ACT" && c.url === manualMinistryLabourUrl);
  const registered = captures.find((c) => c.leadId === "NIPC-LABOUR-ACT");
  const keys = guidePassageIds(id);
  if (
    !base ||
    base.rawSha256 !== registeredEditionSha256 ||
    !ministry ||
    ministry.rawChecksum !== ministryEditionSha256 ||
    !registered ||
    registered.url !== base.url ||
    registered.rawChecksum !== base.rawSha256 ||
    !keys.length ||
    !keys.every((key) => {
      const p = passages(key);
      return p?.instrument.id === base.instrument && ministry.text.includes(p.text);
    })
  )
    return {
      sources: [],
      holds: ["The issuing Ministry’s edition and Valo’s registered copy need a fresh passage comparison."],
    };
  const record: AmendmentRecord = {
    ...base,
    comparedSections,
    notRead: base.notRead.filter((u) => u.title !== "Trade Union (Amendment) Act 2005"),
    conflicts: [
      ...base.conflicts.filter((c) => c.about !== "whether this copy can stand for the Act"),
      {
        about: "The printed Cap. L1 and the 2005 trade-union amendment",
        sections: Object.keys(comparedSections),
        open: false,
        note: "The Ministry supplies the same five passages. The printed Issue 1 corrects the heading and paragraph labels. The eleven provisions of the assented 2005 Act amend the Trade Unions Act. The Ministry’s printed Cap. T14, Issue 2 confirms the provisions on union membership and dues. These guides do not determine union dues under Labour Act section 5(3) or (4).",
      },
    ],
    limits:
      "Only the sections, definition, amendment and published Assembly indexes identified in the 22 November comparison were checked. The guides do not determine individual coverage or interpret union contributions. The Assembly’s damaged amendment file was not used as readable text.",
  };
  const validThrough = new Date(
    Math.min(...record.searches.map((s) => Date.parse(s.searchedAt))) + AMENDMENT_RECORD_DAYS * 86_400_000,
  ).toISOString();
  return {
    records: [record],
    holds: [],
    sources: [
      {
        url: ministry.url,
        title: "Federal Ministry of Labour and Employment: Labour Act",
        locator: ministryLocations[id]!,
        rawSha256: ministry.rawChecksum,
        retrievedAt: ministry.checkedAt,
        retrieval: ministry.retrieval,
        validThrough,
        // The Ministry's copy of the Act, which took effect on the day the registered copy prints.
        issuingBody: "Federal Ministry of Labour and Employment",
        effectiveFrom: base.commencement.effectiveFrom,
      },
    ],
  };
}
