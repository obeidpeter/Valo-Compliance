import { digest, sha256 } from "@workspace/valo-core";
import type { ManualRegulatorySource } from "@workspace/db";
import { sql } from "drizzle-orm";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";
import {
  buildGuideCandidate,
  AMENDMENT_RECORD_DAYS,
  guideAmendmentRecords,
  capturedGuidePassages,
  guidePassageIds,
  mappedGuideIds,
  passageLead,
  readGuidanceIntake,
} from "../publication";
import { readManualOfficialSource, referenceFor } from "../sources";
import { consumerGazetteLead, hasConsumerReading, checkConsumerGazette } from "./consumer-gazette";

type Capture = Awaited<ReturnType<typeof readManualOfficialSource>>;
export const manualGuidanceIds = Array.from(
  { length: 30 },
  (_, i) => "GUD-" + String(i + 1).padStart(2, "0"),
);

export async function registeredManualGuidance(title: string, body: string) {
  for (const id of manualGuidanceIds) {
    const { section } = await readGuidanceIntake(id);
    if (section.title === title && section.body === body) return id;
  }
  return undefined;
}
const neededLeads = (id: string) =>
  mappedGuideIds.includes(id)
    ? [
        ...new Set(
          guidePassageIds(id)
            .map((p) => passageLead(p))
            .filter((v): v is string => Boolean(v)),
        ),
      ]
    : hasConsumerReading(id)
      ? [consumerGazetteLead]
      : [];

/** Fetch a shared instrument once per batch. Only fixed source-register IDs can select an address. */
export async function checkManualRegulatorySources(ids: readonly string[]) {
  assertDevelopmentRuntime();
  const idsToCheck = [...new Set(ids)];
  if (!idsToCheck.length || idsToCheck.some((id) => !manualGuidanceIds.includes(id)))
    throw Error("MANUAL_REGULATORY_CANDIDATE_INVALID");
  const started = new Date();
  const leads = [...new Set(idsToCheck.flatMap(neededLeads))];
  const captures: Capture[] = [];
  const failed = new Set<string>();
  for (let i = 0; i < leads.length; i += 3) {
    const group = leads.slice(i, i + 3);
    const reads = await Promise.allSettled(
      group.map((lead) => {
        const pinned = guideAmendmentRecords.find((r) => r.url === referenceFor(lead).url);
        return readManualOfficialSource(lead, pinned?.rawSha256);
      }),
    );
    for (const [idx, read] of reads.entries()) {
      if (read.status === "fulfilled") captures.push(read.value);
      else failed.add(group[idx]!);
    }
  }
  const evaluatedAt = new Date();
  const passages = capturedGuidePassages(captures);
  const results = [];
  const { db, valoManualRegulatoryChecks } = await import("@workspace/db");
  for (const id of idsToCheck) {
    const { section } = await readGuidanceIntake(id);
    const holds: string[] = neededLeads(id)
      .filter((lead) => failed.has(lead))
      .map((lead) => `The official source ${lead} could not be read.`);
    const sources: ManualRegulatorySource[] = [];
    if (hasConsumerReading(id)) {
      const result = checkConsumerGazette(
        id,
        section.body,
        captures.find((c) => c.leadId === consumerGazetteLead),
        evaluatedAt,
      );
      sources.push(...result.sources);
      holds.push(...result.holds);
    } else if (!mappedGuideIds.includes(id))
      holds.push("Valo has no verified sentence-to-source map for this article.");
    else {
      try {
        const proof = await buildGuideCandidate(id, 1, passages, evaluatedAt);
        holds.push(...proof.candidate.missingEvidence);
        for (const ref of proof.sources) {
          const location = proof.claimScope.passages.find((p) => p.id === ref.id);
          const capture = captures.find((c) => c.url === ref.url);
          if (!location || !capture || ref.status !== "approved") {
            if (!holds.length) holds.push("An official source or its currentness could not be confirmed.");
            continue;
          }
          const record = guideAmendmentRecords.find((r) => r.instrument === location.instrument.id);
          const lastSearch = record
            ? Math.min(...record.searches.map((s) => Date.parse(s.searchedAt)))
            : Date.parse(capture.checkedAt);
          sources.push({
            url: ref.url,
            title: ref.title,
            locator: location.recordedLocator,
            rawSha256: capture.rawChecksum,
            retrievedAt: capture.checkedAt,
            retrieval: capture.retrieval,
            validThrough: new Date(lastSearch + AMENDMENT_RECORD_DAYS * 86_400_000).toISOString(),
          });
        }
        if (proof.candidate.legalScopeStatus !== "verified" && !holds.length)
          holds.push("The legal scope has unresolved claims.");
      } catch {
        // Missing or changed passages invalidate the result. Never carry a previous success forward.
        holds.push("The current official text could not be matched to this article’s claims.");
      }
    }
    if (!sources.length && !holds.length) holds.push("No official source was verified.");
    const bodySha256 = sha256(section.body);
    const evidenceSha256 = digest({
      id,
      title: section.title,
      bodySha256,
      sources: sources.map(({ url, title, locator, rawSha256 }) => ({ url, title, locator, rawSha256 })),
      holds,
    });
    await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${id},812))`);
      await tx.insert(valoManualRegulatoryChecks).values({
        candidateId: id,
        title: section.title,
        bodySha256,
        evidenceSha256,
        sources,
        holds,
        checkedAt: started,
      });
    });
    results.push({ id, sources: sources.length, holds });
  }
  return results;
}
