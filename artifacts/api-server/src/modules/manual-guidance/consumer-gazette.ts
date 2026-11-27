import { sha256 } from "@workspace/valo-core";
import { AMENDMENT_RECORD_DAYS, guideSourceDecision, type AmendmentRecord } from "../publication";
import type { ManualRegulatorySource } from "@workspace/db";
import type { readManualOfficialSource } from "../sources";

export const consumerGazetteLead = "FCCPC-GAZETTE-2018";
const gazette: AmendmentRecord = {
  instrument: consumerGazetteLead,
  title: "Federal Competition and Consumer Protection Act 2018, Official Gazette No. 18",
  url: "https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf",
  rawSha256: "aa942cdef860387e8f984de52666e5683d12d6e2813cb47b10335e0bf82a07f5",
  commencement: { printed: "30th Day of January, 2019", effectiveFrom: "2019-01-30T00:00:00+01:00" },
  searches: [
    {
      place: "National Assembly’s list of Acts",
      url: "https://nass.gov.ng/documents/magazine_track/?draw=1&start=0&length=500&search%5Bvalue%5D=&search%5Bregex%5D=false",
      searchedAt: "2026-11-22T16:22:50.501Z",
      rawSha256: "25274f83bbd57258cfa1e835ff7ba50fbe14e22227b3c9f5c154bb5c5810872e",
      found: "None of the 182 records named a competition or consumer protection Act.",
    },
    {
      place: "National Assembly’s bill tracker",
      url: "https://nass.gov.ng/documents/bill_track/?draw=1&start=0&length=3000&search%5Bvalue%5D=&search%5Bregex%5D=false",
      searchedAt: "2026-11-22T16:22:50.957Z",
      rawSha256: "7b5d0c91b99792af3adde4395df027d64a1dd7090092d8ea8b73e569584c08f6",
      found:
        "Searched 2,660 entries for competition and consumer protection. The tracker lists the 2016 and 2018 bills. No entry identified an enacted amendment to the cited sections.",
    },
    {
      place: "Commission’s consumer rights register",
      url: "https://fccpc.gov.ng/consumers/consumer-rights-responsibilities/rights-responsibilities/",
      searchedAt: "2026-11-22T16:22:50.067Z",
      rawSha256: "44c58adac0fdd16194ba640f4942ddc969de32882d4dbe10b04453c0e6768756",
      found:
        "The regulator continues to point to Part XV. Its short sales-record summary adds a request condition absent from the printed section 118. The article follows the enacted words, checked on Gazette pages A62–A63.",
    },
  ],
  amendments: [],
  notRead: [],
  conflicts: [],
  limits:
    "The review covered the identified articles and printed pages, the Commission’s guidance and the published Assembly indexes. It was not an exhaustive Gazette or case-law search.",
};

// Each entry binds the full article read to the printed law read alongside it. The low-quality OCR
// is never used to attest to statutory wording. A changed document or article requires a new review.
const readings: Record<string, { bodySha256: string; sections: string[]; locator: string; sample: string }> =
  {
    "GUD-16": {
      bodySha256: "7e5e115295330f87df70cbc263e8187f35f16adf39a71b83cf9f9ccd47c859af",
      sections: ["115", "118"],
      locator:
        "Sections 115 and 118, Gazette pp. A61–A63 (PDF pp. 63–65). Price display, conflicting prices and the contents of a transaction record.",
      sample: "Except where it is impracticable to do so",
    },
    "GUD-17": {
      bodySha256: "928bff50a48c8289adadf30280135c9d1b98622a7a1afa60dcd6aeb47540b773",
      sections: ["117", "122", "131", "132", "167"],
      locator:
        "Sections 117, 122, 131 and 132 and the definition of consumer, Gazette pp. A62, A64, A70 and A86 (PDF pp. 64, 66, 72 and 88). Used goods, conditional refunds, quality and the three-month remedy.",
      sample: "without penalty and at the undertaking’s risk and expense",
    },
    "GUD-18": {
      bodySha256: "6a66088dbc05c27ce366082267ce0ec5d7bb4ee3b0352786fa48d8f8dafcdb6f",
      sections: ["120", "127", "128", "129", "130"],
      locator:
        "Sections 120 and 127–130, Gazette pp. A63 and A67–A70 (PDF pp. 65 and 69–72). Cancellation charges, notice, prohibited terms and service remedies.",
      sample: "gross negligence",
    },
  };

export function hasConsumerReading(id: string) {
  return Object.hasOwn(readings, id);
}

export function checkConsumerGazette(
  id: string,
  body: string,
  capture: Awaited<ReturnType<typeof readManualOfficialSource>> | undefined,
  now: Date,
): { sources: ManualRegulatorySource[]; holds: string[] } {
  const reading = readings[id];
  if (!reading || !capture || sha256(body) !== reading.bodySha256)
    return {
      sources: [],
      holds: ["The article or the Official Gazette scan needs a fresh page-by-page comparison."],
    };
  const decision = guideSourceDecision(
    {
      id,
      recordedLocator: reading.locator,
      text: reading.sample,
      hash: sha256(reading.sample),
      sections: reading.sections,
      instrument: {
        id: consumerGazetteLead,
        kind: "act",
        url: capture.url,
        title: gazette.title,
        issuingBody: "Federal Republic of Nigeria",
        rawSha256: capture.rawChecksum,
        retrievedAt: capture.checkedAt,
        effectiveFrom: gazette.commencement.effectiveFrom,
      },
    },
    now,
    [gazette],
  );
  if (decision.status !== "approved") return { sources: [], holds: decision.reasons };
  const validThrough = new Date(
    Math.min(...gazette.searches.map((s) => Date.parse(s.searchedAt))) + AMENDMENT_RECORD_DAYS * 86_400_000,
  ).toISOString();
  return {
    sources: [
      {
        url: gazette.url,
        title: gazette.title,
        locator: reading.locator,
        rawSha256: capture.rawChecksum,
        validThrough,
        retrievedAt: capture.checkedAt,
        retrieval: capture.retrieval,
        issuingBody: "Federal Republic of Nigeria",
        effectiveFrom: gazette.commencement.effectiveFrom,
      },
    ],
    holds: [],
  };
}
