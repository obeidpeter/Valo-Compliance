import { desc, eq, inArray, max } from "drizzle-orm";
import { publicationSchema } from "@workspace/valo-core";
import {
  displayLocator,
  mappedGuideIds,
  readPreparedCandidate,
  reviewedGuideChecked,
  type ReleaseAttestations,
} from "../publication";
import { inspectReleasedSources, verifyReleasedSources, type InspectedSourceCapture } from "../sources";
import { asDevelopmentOwner, preparedCandidateState, type StaffActor } from "../staff";
import { ValoProblem } from "../../platform/valo-problem";

const NOT_OWNER = "Only the designated development owner can check a guide's sources for its release.";
const NOT_AWAITING = "This guide is not awaiting its reviews. Nothing was recorded.";
const CHANGED =
  "This guide changed since you opened it. Open it again before you confirm its sources. Nothing was recorded.";
const UNMIGRATED = () =>
  new ValoProblem(503, "Apply the reviewed guide checks migrations before checking a guide's sources.");
const DAY = 86_400_000;

/** A PostgreSQL error's code, through the driver's wrapper. */
function pgCode(error: unknown) {
  const e = error as { cause?: { code?: string }; code?: string };
  return (e.cause ?? e).code;
}

/** Why a guide's sources do not hold, in the owner's words, by the code the source check gives. */
function sourceHold(error: unknown) {
  const code = error instanceof Error ? error.message : "";
  if (code === "SOURCE_CURRENT_CAPTURE_REQUIRED")
    return new ValoProblem(
      409,
      "A copy of one of this guide's official sources is no longer the current one, or was not checked within the last day. Wait for the daily source check, then check again. Nothing was recorded.",
    );
  if (code === "SOURCE_PASSAGE_SNAPSHOT_MISMATCH")
    return new ValoProblem(
      409,
      "One of this guide's official sources no longer holds the words the guide quotes. The guide must be prepared again. Nothing was recorded.",
    );
  if (code === "SOURCE_SNAPSHOT_BINDING_REQUIRED")
    return new ValoProblem(
      409,
      "One of this guide's sources has no copy recorded. The guide must be prepared again. Nothing was recorded.",
    );
  return error;
}

/**
 * The development owner's check of a prepared guide's official sources on the reviewed route
 * (docs/architecture/reviewed-route.md, part 2; decision 0018). The owner confirms the exact candidate they
 * read, by its checksum. Each of its sources' copies must still be its watch's current one, checked within
 * the last day, and hold the guide's passages and every quote. Only then is the check recorded; the
 * database records its time and refuses it from anyone but the development owner.
 *
 * The files are read outside any transaction. Nothing here calls a model, admits a review or publishes.
 */
export async function checkReviewedGuideSources(
  actor: StaffActor,
  versionId: string,
  confirm: string,
  now = new Date(),
) {
  // Refused before any file is read.
  await asDevelopmentOwner(actor, async () => undefined, NOT_OWNER);
  const { db, valoContentVersions, valoPreparedCandidates, valoReviewedGuideChecks } =
    await import("@workspace/db");
  const [prepared] = await db
    .select()
    .from(valoPreparedCandidates)
    .where(eq(valoPreparedCandidates.versionId, versionId));
  if (!prepared || !mappedGuideIds.includes(prepared.templateId)) throw new ValoProblem(404, NOT_AWAITING);
  const candidate = await readPreparedCandidate({
    id: prepared.artifactId,
    hash: prepared.artifactHash,
    extension: "json",
  });
  if (
    candidate.versionId !== versionId ||
    candidate.templateId !== prepared.templateId ||
    candidate.candidateHash !== prepared.candidateHash ||
    confirm !== candidate.candidateHash
  )
    throw new ValoProblem(409, CHANGED);
  if (Date.parse(candidate.reviewBy) <= +now)
    throw new ValoProblem(
      409,
      "This guide's review date has passed. It must be prepared again. Nothing was recorded.",
    );
  const captures = (candidate.attestations as ReleaseAttestations).sourceSnapshots ?? {};
  try {
    await verifyReleasedSources(db, candidate.bundle, captures, now);
  } catch (error) {
    throw sourceHold(error);
  }
  return asDevelopmentOwner(
    actor,
    async (tx) => {
      // A version already released or held needs no check of its sources.
      const [saved] = await tx
        .select({ status: valoContentVersions.status })
        .from(valoContentVersions)
        .where(eq(valoContentVersions.id, versionId));
      if (saved && saved.status !== "candidate") throw new ValoProblem(409, NOT_AWAITING);
      const [recorded] = await tx
        .insert(valoReviewedGuideChecks)
        .values({
          artifactId: prepared.artifactId,
          artifactHash: prepared.artifactHash,
          versionId,
          guideId: prepared.templateId,
          version: prepared.version,
          candidateHash: candidate.candidateHash,
          captures,
          checkedBy: actor.identityId,
        })
        .returning({ checkedAt: valoReviewedGuideChecks.checkedAt });
      return {
        versionId,
        guide: prepared.templateId,
        version: prepared.version,
        candidateHash: candidate.candidateHash,
        checkedAt: recorded!.checkedAt.toISOString(),
        sources: Object.keys(captures).length,
      };
    },
    NOT_OWNER,
  ).catch((error: unknown) => {
    if (pgCode(error) === "42P01") throw UNMIGRATED();
    throw error;
  });
}

type Source = ReturnType<typeof publicationSchema.parse>["sources"][number];
/** What one source's state means for the owner, or nothing when the copy holds the guide's words. */
function sourceHoldWords(source: Source, state: InspectedSourceCapture["state"]) {
  const title = source.title;
  switch (state) {
    case "holds":
    case "quote_missing":
      return null;
    case "no_copy":
      return `No copy of ${title} is recorded for this guide. It must be prepared again.`;
    case "changed":
      return `The official file of ${title} has changed since this guide was prepared. It must be prepared again from the new copy.`;
    case "not_current":
      return `The copy of ${title} was not checked within the last day, or its last check failed. Wait for the daily source check, then check again.`;
    case "unreadable":
      return `The stored copy of ${title} could not be read. Check again later. If it still cannot be read, the guide must be prepared again.`;
    case "passage_missing":
      return `The copy of ${title} no longer holds the passage this guide rests on. It must be prepared again.`;
  }
}

/** The guide's whole text, part by part, as its page and files print it. */
function guideText(body: string) {
  const document = JSON.parse(body) as {
    title: string;
    content: { blocks: { text: string; rows?: string[][] }[] };
  };
  const parts = document.content.blocks.map((block) =>
    [block.text, ...(block.rows ?? []).map((row) => row.join(" | "))].filter(Boolean).join("\n"),
  );
  return { title: document.title, text: parts.filter(Boolean) };
}

/**
 * The prepared guides awaiting their reviews on the reviewed route, for the development owner to read
 * before checking their sources (docs/architecture/reviewed-route.md, part 2). Each is shown as it would
 * be checked now: its whole text, each claim with the passage it rests on, where each source's copy
 * stands, what holds it, and the owner's latest check of it. A guide saved by the publish command and
 * waiting for a current check is listed too.
 *
 * Files and copies are read outside any transaction. Nothing is recorded, reviewed or released.
 */
export async function listReviewedGuides(actor: StaffActor, now = new Date()) {
  // Refused before any file is read.
  await asDevelopmentOwner(actor, async () => undefined, NOT_OWNER);
  const { db, valoContentVersions, valoPreparedCandidates, valoReviewedGuideChecks } =
    await import("@workspace/db");
  const guides = [...mappedGuideIds];
  const prepared = await db
    .select()
    .from(valoPreparedCandidates)
    .where(inArray(valoPreparedCandidates.templateId, guides))
    .orderBy(desc(valoPreparedCandidates.preparedAt));
  if (!prepared.length) return { items: [] };
  const versions = await db
    .select({
      id: valoContentVersions.id,
      templateId: valoContentVersions.templateId,
      version: valoContentVersions.version,
      status: valoContentVersions.status,
    })
    .from(valoContentVersions)
    .where(inArray(valoContentVersions.templateId, guides));
  let checks: { versionId: string; candidateHash: string; checkedAt: Date | null }[];
  try {
    checks = await db
      .select({
        versionId: valoReviewedGuideChecks.versionId,
        candidateHash: valoReviewedGuideChecks.candidateHash,
        checkedAt: max(valoReviewedGuideChecks.checkedAt),
      })
      .from(valoReviewedGuideChecks)
      .where(
        inArray(
          valoReviewedGuideChecks.versionId,
          prepared.map((p) => p.versionId),
        ),
      )
      .groupBy(valoReviewedGuideChecks.versionId, valoReviewedGuideChecks.candidateHash);
  } catch (error) {
    if (pgCode(error) === "42P01") throw UNMIGRATED();
    throw error;
  }
  const items = [];
  for (const row of prepared) {
    const saved = versions.find((v) => v.id === row.versionId);
    const state = preparedCandidateState(
      {
        reviewBy: row.reviewBy,
        savedStatus: saved?.status ?? null,
        versionTaken: versions.some(
          (v) => v.templateId === row.templateId && v.version === row.version && v.id !== row.versionId,
        ),
      },
      now,
    );
    // A guide released, held or withdrawn, past its review date, or overtaken needs no check.
    if (state !== "awaiting_reviews" && !(state === "saved" && saved?.status === "candidate")) continue;
    const candidate = await readPreparedCandidate({
      id: row.artifactId,
      hash: row.artifactHash,
      extension: "json",
    });
    const bundle = publicationSchema.parse(candidate.bundle);
    const captures = (candidate.attestations as ReleaseAttestations).sourceSnapshots ?? {};
    const holds: string[] = [];
    if (
      candidate.versionId !== row.versionId ||
      candidate.templateId !== row.templateId ||
      candidate.candidateHash !== row.candidateHash
    )
      holds.push("This guide's record no longer matches its prepared file. It must be prepared again.");
    if (Date.parse(candidate.reviewBy) <= +now)
      holds.push("This guide's review date has passed. It must be prepared again.");
    const inspected = await inspectReleasedSources(db, bundle, captures, now);
    const missing = new Set(inspected.flatMap((s) => s.missingQuotes));
    const sources = bundle.sources.map((source) => {
      const found = inspected.find((s) => s.bundleSourceId === source.id)!;
      const words = sourceHoldWords(source, found.state);
      if (words) holds.push(words);
      return {
        id: source.id,
        title: source.title,
        url: source.url,
        passage: source.text,
        checkedAt: found.checkedAt,
        state: found.state,
      };
    });
    const claims = bundle.candidate.claims.map((claim, index) => {
      const held = missing.has(index);
      if (held) {
        const title = bundle.sources.find((s) => s.id === claim.sourceId)?.title ?? claim.sourceId;
        holds.push(`The copy of ${title} does not hold the words this sentence quotes: “${claim.text}”`);
      }
      return {
        text: claim.text,
        kind: claim.kind,
        sourceId: claim.sourceId,
        locator: displayLocator(claim.locator),
        quote: claim.quote,
        held,
      };
    });
    const last = checks.find((c) => c.versionId === row.versionId && c.candidateHash === row.candidateHash);
    const checkedAt = last?.checkedAt ?? null;
    const { title, text } = guideText(bundle.candidate.body);
    items.push({
      versionId: row.versionId,
      guideId: row.templateId,
      title,
      version: row.version,
      candidateHash: row.candidateHash,
      preparedAt: row.preparedAt.toISOString(),
      reviewBy: row.reviewBy.toISOString(),
      saved: saved?.status === "candidate",
      text,
      claims,
      sources,
      holds,
      lastCheck: checkedAt
        ? {
            checkedAt: checkedAt.toISOString(),
            countsUntil: new Date(+checkedAt + DAY).toISOString(),
            counts: await reviewedGuideChecked(db, row.versionId, row.candidateHash, captures),
          }
        : null,
    });
  }
  return { items };
}
