import { sha256 } from "@workspace/valo-core";
import {
  capturedPassages,
  capturedTexts,
  type CapturedPassage,
  type CapturedText,
} from "./guidance-captured-texts";
import {
  retainedGuidePassages,
  type GuideInstrument,
  type GuidePassage,
  type GuidePassages,
} from "./guidance-passages";

/**
 * The passages a guide is bound to when it is prepared for release: read from fresh captures of the
 * official addresses, not from the copies kept in the repository (decision 0017, point 2).
 *
 * A capture is what the daily source check stored for one address: the file's checksum, the text
 * extracted from it and when it was checked. Nothing here fetches anything.
 */
export type GuideCapture = {
  /** The source lead the capture is of. */
  leadId: string;
  url: string;
  snapshotId: string;
  /** When the address was last checked and found to serve this file. */
  checkedAt: string;
  rawChecksum: string;
  /** The text extracted from the file. */
  text: string;
};

/** The lead that serves each Act the guides quote. */
export const guideActLeads: Record<string, string> = {
  "CAC-CAMA-2020": "SV-010",
  "NASS-NTAA-2025": "NASS-NTAA-2025",
  "NAFDAC-CAP-F33": "NAFDAC-CAP-F33",
};

/**
 * The official pages the guides describe. A page's passage is the whole page as captured: a page is
 * short, and a guide's quotations are found in it by their own words.
 */
const pagePassages: Record<
  string,
  { leadId: string; instrument: Pick<GuideInstrument, "id" | "title" | "issuingBody"> }
> = {
  "CAC-BN-PROCESS": {
    leadId: "CAC-BN-PROCESS",
    instrument: {
      id: "CAC-BN-PROCESS",
      title: "Corporate Affairs Commission: business name registration page",
      issuingBody: "Corporate Affairs Commission",
    },
  },
  "CAC-PORTAL-NOTICE": {
    leadId: "S03",
    instrument: {
      id: "CAC-ICRP",
      title: "Corporate Affairs Commission: Company Registration Portal",
      issuingBody: "Corporate Affairs Commission",
    },
  },
  "TAXID-HOW-IT-WORKS": {
    leadId: "NRS-TAXID-HOW",
    instrument: {
      id: "NRS-TAXID-HOW",
      title: "Nigeria Revenue Service: how Tax ID retrieval works",
      issuingBody: "Nigeria Revenue Service",
    },
  },
};

/** The texts and passages kept only as a place and a checksum (guidance-captured-texts.ts). */
export type CapturedRecords = { texts: readonly CapturedText[]; passages: readonly CapturedPassage[] };
const recorded: CapturedRecords = { texts: capturedTexts, passages: capturedPassages };
/** A recorded passage and the text it is a passage of. */
function recordedPassage(id: string, records: CapturedRecords) {
  const passage = records.passages.find((p) => p.id === id);
  const of = passage && records.texts.find((text) => text.id === passage.text);
  return passage && of ? { passage, of } : undefined;
}

/** Every lead a guide's passages can be read from. */
export const guideCaptureLeads = [
  ...new Set([
    ...Object.values(guideActLeads),
    ...Object.values(pagePassages).map((p) => p.leadId),
    ...capturedTexts.map((text) => text.leadId),
  ]),
];

/**
 * The words of a passage that is kept only as a place and a checksum, cut from a capture's text.
 * Undefined unless the capture holds its opening words exactly once, its closing words after them,
 * and the words between have the passage's checksum.
 */
export function cutCapturedPassage(text: string, passage: Pick<CapturedPassage, "from" | "to" | "sha256">) {
  const start = text.indexOf(passage.from);
  if (start < 0 || text.indexOf(passage.from, start + 1) >= 0) return undefined;
  const end = text.indexOf(passage.to, start);
  if (end < 0) return undefined;
  const words = text.slice(start, end + passage.to.length).trim();
  return sha256(words) === passage.sha256 ? words : undefined;
}

/** The lead whose capture a passage is read from, where the passage is known. */
export function passageLead(
  id: string,
  retained: GuidePassages = retainedGuidePassages(),
  records: CapturedRecords = recorded,
) {
  const page = pagePassages[id];
  if (page) return page.leadId;
  const bound = recordedPassage(id, records);
  if (bound) return bound.of.leadId;
  const kept = retained(id);
  return kept?.instrument.kind === "act" ? guideActLeads[kept.instrument.id] : undefined;
}

/**
 * Passages read from the captures given.
 *
 * A passage of an Act kept in the repository is the retained passage, found word for word in
 * today's capture of the Act and dated and checksummed from that capture. A passage kept only as a
 * place and a checksum is cut from today's capture of its text, and supplied only when its words
 * have that checksum. If the capture does not hold a passage, it is not supplied, and the guide's
 * sentences that rest on it stay unbound. A page's passage is the page as captured.
 */
export function capturedGuidePassages(
  captures: readonly Omit<GuideCapture, "snapshotId">[],
  retained: GuidePassages = retainedGuidePassages(),
  records: CapturedRecords = recorded,
): GuidePassages {
  const byLead = new Map(captures.map((capture) => [capture.leadId, capture]));
  const read = (capture: Pick<GuideCapture, "checkedAt">) => new Date(capture.checkedAt).toISOString();
  return (id): GuidePassage | undefined => {
    const page = pagePassages[id];
    if (page) {
      const capture = byLead.get(page.leadId);
      const text = capture?.text.trim();
      if (!capture || !text) return undefined;
      return {
        id,
        recordedLocator: "the page as captured",
        text,
        hash: sha256(text),
        sections: [],
        instrument: {
          ...page.instrument,
          kind: "official_page",
          url: capture.url,
          rawSha256: capture.rawChecksum,
          retrievedAt: read(capture),
          // A page is known to say this from the time it was read.
          effectiveFrom: read(capture),
        },
      };
    }
    const bound = recordedPassage(id, records);
    if (bound) {
      const { passage, of } = bound;
      const capture = byLead.get(of.leadId);
      const words = capture && cutCapturedPassage(capture.text, passage);
      if (!capture || !words) return undefined;
      return {
        id,
        recordedLocator: passage.recordedLocator,
        text: words,
        hash: passage.sha256,
        sections: [...passage.sections],
        instrument: {
          id: of.id,
          kind: of.kind,
          url: capture.url,
          rawSha256: capture.rawChecksum,
          title: of.title,
          issuingBody: of.issuingBody,
          retrievedAt: read(capture),
          effectiveFrom: of.effectiveFrom,
        },
      };
    }
    const kept = retained(id);
    if (!kept || kept.instrument.kind !== "act") return undefined;
    const capture = byLead.get(guideActLeads[kept.instrument.id] ?? "");
    if (!capture || capture.url !== kept.instrument.url || !capture.text.includes(kept.text))
      return undefined;
    return {
      ...kept,
      instrument: { ...kept.instrument, rawSha256: capture.rawChecksum, retrievedAt: read(capture) },
    };
  };
}

/** Which capture each of a candidate's sources was read from: source id to snapshot id. */
export function guideSourceSnapshots(
  sources: readonly { id: string; url: string }[],
  captures: readonly GuideCapture[],
) {
  const snapshots: Record<string, string> = {};
  for (const source of sources) {
    const capture = captures.find((c) => c.url === source.url);
    if (!capture) throw Error(`GUIDE_SOURCE_CAPTURE_MISSING:${source.id}`);
    snapshots[source.id] = capture.snapshotId;
  }
  return snapshots;
}
