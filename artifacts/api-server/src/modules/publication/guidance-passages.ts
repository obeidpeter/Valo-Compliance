import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot } from "./operational-policy";

/**
 * The official passages a guide's claims can be bound to, and the texts they come from.
 *
 * `retainedGuidePassages` reads the passages kept in the repository with the guidance drafts: exact
 * extracts of the official files fetched on 14 November 2026, each with its own SHA-256. They let a
 * guide's claim map be built and checked without the network. A guide is prepared for release
 * against fresh captures instead; nothing here says a text is current.
 */
export type GuideInstrument = {
  id: string;
  url: string;
  /** The official text's name as a guide's source list prints it. */
  title: string;
  issuingBody: string;
  retrievedAt: string;
  /** The day the text took effect, as the text itself prints it. */
  effectiveFrom: string;
};
export type GuidePassage = {
  id: string;
  /** Where the passage is in its text, as it was recorded when it was extracted. */
  recordedLocator: string;
  text: string;
  hash: string;
  instrument: GuideInstrument;
};
export type GuidePassages = (id: string) => GuidePassage | undefined;

const paths = {
  registrationTax: "docs/content-candidates/source-evidence/registration-tax-passages.json",
  registrationTaxRetrieval: "docs/content-candidates/source-evidence/registration-tax-retrieval.json",
  businessName: "docs/content-candidates/business-name-source-passages.json",
  businessNameRetrieval: "docs/content-candidates/business-name-source-retrieval.json",
  businessNameCandidate: "docs/valo/evidence/business-name/candidate.json",
} as const;

type Extracted = {
  passageID: string;
  sourceID: string;
  locator: string;
  exactExtractedText: string;
  textSHA256: string;
};
type Retrieval = { id: string; url: string; retrievedAt: string; rawSHA256: string; httpStatus: number };

function fail(code: string): never {
  throw Error(code);
}

export function retainedGuidePassages(
  read: (path: string) => string = (path) => readFileSync(resolve(publicationWorkspaceRoot(), path), "utf8"),
): GuidePassages {
  // Parsed JSON; each caller states the shape it reads from the retained file.
  const json = (path: string): unknown => JSON.parse(read(path));
  const tax = json(paths.registrationTax) as {
    sources: Record<string, { rawSHA256: string }>;
    passages: Extracted[];
  };
  const name = json(paths.businessName) as { passages: Extracted[] };
  const retrieved = (path: string, id: string) => {
    const r = (json(path) as Retrieval[]).find((x) => x.id === id);
    if (!r || r.httpStatus !== 200) fail(`GUIDE_PASSAGES_RETRIEVAL_MISSING:${id}`);
    return r;
  };
  const cama = retrieved(paths.businessNameRetrieval, "cama_2020"),
    ntaa = retrieved(paths.registrationTaxRetrieval, "ntaa_nass_2025");
  // The two passage files name one copy of each Act by the checksum of the file it was read from.
  if (
    tax.sources["CAC-CAMA-2020"]?.rawSHA256 !== cama.rawSHA256 ||
    tax.sources["NASS-NTAA-2025"]?.rawSHA256 !== ntaa.rawSHA256
  )
    fail("GUIDE_PASSAGES_SOURCE_IDENTITY_CHANGED");

  const passages = new Map<string, GuidePassage>();
  const add = (p: GuidePassage) => {
    if (sha256(p.text) !== p.hash) fail(`GUIDE_PASSAGE_CHANGED:${p.id}`);
    const known = passages.get(p.id);
    if (known && known.hash !== p.hash) fail(`GUIDE_PASSAGE_CONFLICT:${p.id}`);
    passages.set(p.id, p);
  };
  const instruments: Record<string, GuideInstrument> = {
    cama: {
      id: "CAC-CAMA-2020",
      url: cama.url,
      title: "Companies and Allied Matters Act 2020",
      issuingBody: "Corporate Affairs Commission (official copy)",
      retrievedAt: new Date(cama.retrievedAt).toISOString(),
      effectiveFrom: "2020-08-07T00:00:00+01:00",
    },
    ntaa: {
      id: "NASS-NTAA-2025",
      url: ntaa.url,
      title: "Nigeria Tax Administration Act 2025",
      issuingBody: "National Assembly of Nigeria (official copy)",
      retrievedAt: new Date(ntaa.retrievedAt).toISOString(),
      // The National Assembly's copy prints 26 June 2025 and the revenue service's copy prints
      // 1 January 2026. The later day is used: the Act is in force from it under either copy. The
      // difference itself is a matter for the Act's amendment record (decision 0017, point 2).
      effectiveFrom: "2026-01-01T00:00:00+01:00",
    },
  };
  const byRecordedSource: Record<string, GuideInstrument | undefined> = {
    "CAC-CAMA-2020": instruments.cama,
    cama_2020: instruments.cama,
    "NASS-NTAA-2025": instruments.ntaa,
  };
  for (const p of [...tax.passages, ...name.passages]) {
    const instrument = byRecordedSource[p.sourceID];
    // Passages of texts no guide here cites (the comparison copy, the amending Act, the Copyright
    // Act) are left out, not guessed at.
    if (!instrument) continue;
    add({
      id: p.passageID,
      recordedLocator: p.locator,
      text: p.exactExtractedText,
      hash: p.textSHA256,
      instrument,
    });
  }
  // Each effective date above is the one the retained text prints.
  const commencement = passages.get("CAMA-COMMENCEMENT")?.text ?? "";
  if (!commencement.includes("[7th Day of August, 2020]")) fail("GUIDE_PASSAGES_COMMENCEMENT_CHANGED");

  // The Corporate Affairs Commission's page on registering a business name, as captured for the
  // business-name rule candidate.
  const candidate = json(paths.businessNameCandidate) as {
    references: { sourceId: string; url: string; fetchedAt: string }[];
    passages: { id: string; text: string; hash: string }[];
    locators: Record<string, string>;
  };
  const process = candidate.passages.find((p) => p.id === "process"),
    reference = candidate.references.find((r) => r.sourceId === "CAC-BN-PROCESS");
  if (!process || !reference || !candidate.locators.process) fail("GUIDE_PASSAGES_PROCESS_PAGE_MISSING");
  const fetchedAt = new Date(reference.fetchedAt).toISOString();
  add({
    id: "CAC-BN-PROCESS",
    recordedLocator: candidate.locators.process,
    text: process.text,
    hash: process.hash,
    instrument: {
      id: "CAC-BN-PROCESS",
      url: reference.url,
      title: "Corporate Affairs Commission: business name registration page",
      issuingBody: "Corporate Affairs Commission",
      retrievedAt: fetchedAt,
      // A service page has no commencement: it is known to say this from the time it was captured.
      effectiveFrom: fetchedAt,
    },
  });
  return (id) => passages.get(id);
}
