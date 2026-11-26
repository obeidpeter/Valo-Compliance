import { sql } from "drizzle-orm";
import { allSourceLeads, publicationSchema, releaseEvidence } from "@workspace/valo-core";
import { logger } from "../../platform/logger";
import { readSourceText } from "./source-storage";
import {
  type SourceReader,
  type SourceTx,
  type SourceTarget,
  sourceTargetAllowed,
  sourceTime,
} from "./valo-source-state";

/** A bundle source's retained capture, checked against its stored text. */
export type VerifiedSourceCapture = {
  bundleSourceId: string;
  sourceId: string;
  snapshotId: string;
  rawChecksum: string;
  textChecksum: string;
};

const captureFor = async (reader: SourceReader, url: string, snapshotId: string) =>
  (
    await reader.execute(sql`select s.*,w.last_raw_hash,w.checked_at,w.failure_code,w.stopped_at from valo_source_snapshots s
   join valo_source_watches w on w.source_id=s.source_id where s.id=${snapshotId}::uuid and s.url=${url} and w.url=${url}`)
  ).rows[0];

/** Whether a capture is the source watch's current, successful one, checked within a day. */
export function currentCapture(snapshot: Record<string, unknown> | undefined, url: string, now: Date) {
  return (
    !!snapshot &&
    allSourceLeads.some((s) => s.id === snapshot.source_id && s.url === url) &&
    snapshot.status === "retrieved_unreviewed" &&
    !snapshot.failure_code &&
    !!snapshot.raw_object_key &&
    !!snapshot.text_object_key &&
    snapshot.raw_checksum === snapshot.last_raw_hash &&
    // A source the register retired is no longer watched (source-register.md, slice 2).
    !snapshot.stopped_at &&
    !!snapshot.checked_at &&
    sourceTime(snapshot.checked_at) + 86400000 > +now
  );
}

/**
 * The first half of binding: every bundle source names a current retained capture of a known
 * official source, and the capture's stored text holds the source's text and every claim's quote.
 * It reads private storage, so a caller that can should run it before opening its transaction.
 */
export async function verifyReleasedSources(
  reader: SourceReader,
  raw: unknown,
  snapshotIds: Record<string, string> = {},
  now = new Date(),
  readText: (snapshotId: string, checksum: string) => Promise<string> = readSourceText,
): Promise<VerifiedSourceCapture[]> {
  // A reviewed bundle or an owner-signed rule's (decision 0020); anything else is refused as before.
  const bundle = releaseEvidence(raw) ?? publicationSchema.parse(raw);
  const captures: VerifiedSourceCapture[] = [];
  for (const source of bundle.sources) {
    if (!allSourceLeads.some((s) => s.url === source.url) || !snapshotIds[source.id])
      throw Error("SOURCE_SNAPSHOT_BINDING_REQUIRED");
    const snapshot = await captureFor(reader, source.url, snapshotIds[source.id]!);
    if (!currentCapture(snapshot, source.url, now)) throw Error("SOURCE_CURRENT_CAPTURE_REQUIRED");
    const text = await readText(String(snapshot!.id), String(snapshot!.text_checksum));
    if (
      !text.includes(source.text) ||
      bundle.candidate.claims.filter((c) => c.sourceId === source.id).some((c) => !text.includes(c.quote))
    )
      throw Error("SOURCE_PASSAGE_SNAPSHOT_MISMATCH");
    captures.push({
      bundleSourceId: source.id,
      sourceId: String(snapshot!.source_id),
      snapshotId: String(snapshot!.id),
      rawChecksum: String(snapshot!.raw_checksum),
      textChecksum: String(snapshot!.text_checksum),
    });
  }
  return captures;
}

/** Where one bundle source stands against the capture its release names (inspectReleasedSources). */
export type InspectedSourceState =
  "holds" | "no_copy" | "changed" | "not_current" | "unreadable" | "passage_missing" | "quote_missing";
export type InspectedSourceCapture = {
  bundleSourceId: string;
  snapshotId: string | null;
  /** When the source's watch last checked its address, if it has. */
  checkedAt: string | null;
  state: InspectedSourceState;
  /** The positions, in the candidate's claims, of the claims on this source whose quotations the copy lacks. */
  missingQuotes: number[];
};

/**
 * The read-only form of verifyReleasedSources, for a person to read before they check a guide: where
 * each bundle source stands against the capture named for it, with every claim whose quotation the
 * copy lacks rather than only the first problem. It reads private storage, so a caller runs it outside
 * any transaction. It records nothing.
 */
export async function inspectReleasedSources(
  reader: SourceReader,
  raw: unknown,
  snapshotIds: Record<string, string> = {},
  now = new Date(),
  readText: (snapshotId: string, checksum: string) => Promise<string> = readSourceText,
): Promise<InspectedSourceCapture[]> {
  const bundle = publicationSchema.parse(raw);
  const inspected: InspectedSourceCapture[] = [];
  for (const source of bundle.sources) {
    const snapshotId = snapshotIds[source.id] ?? null;
    const entry = { bundleSourceId: source.id, snapshotId, checkedAt: null, missingQuotes: [] };
    if (!snapshotId || !allSourceLeads.some((s) => s.url === source.url)) {
      inspected.push({ ...entry, state: "no_copy" });
      continue;
    }
    const snapshot = await captureFor(reader, source.url, snapshotId);
    if (!snapshot) {
      inspected.push({ ...entry, state: "no_copy" });
      continue;
    }
    const checkedAt = snapshot.checked_at ? new Date(sourceTime(snapshot.checked_at)).toISOString() : null;
    // The address now serves another file than the one this copy holds.
    if (snapshot.raw_checksum !== snapshot.last_raw_hash) {
      inspected.push({ ...entry, checkedAt, state: "changed" });
      continue;
    }
    if (!currentCapture(snapshot, source.url, now)) {
      inspected.push({ ...entry, checkedAt, state: "not_current" });
      continue;
    }
    let text: string;
    try {
      text = await readText(String(snapshot.id), String(snapshot.text_checksum));
    } catch (error) {
      // A copy whose stored text is missing or no longer matches its checksum cannot be read. That is
      // this source's state, and the release check refuses the copy the same way.
      logger.warn({ event: "source_inspection.capture_unreadable", err: error });
      inspected.push({ ...entry, checkedAt, state: "unreadable" });
      continue;
    }
    const missingQuotes = bundle.candidate.claims.flatMap((claim, index) =>
      claim.sourceId === source.id && !text.includes(claim.quote) ? [index] : [],
    );
    inspected.push({
      ...entry,
      checkedAt,
      missingQuotes,
      state: !text.includes(source.text)
        ? "passage_missing"
        : missingQuotes.length
          ? "quote_missing"
          : "holds",
    });
  }
  return inspected;
}

/**
 * The second half: inside the release's transaction, each verified capture must still be its
 * watch's current one, unchanged; then it is bound and the target's sources must be current. No
 * storage is read here.
 */
export async function bindVerifiedSources(
  tx: SourceTx,
  kind: SourceTarget,
  id: string,
  raw: unknown,
  captures: VerifiedSourceCapture[],
  now = new Date(),
) {
  const bundle = releaseEvidence(raw) ?? publicationSchema.parse(raw);
  for (const source of bundle.sources) {
    const capture = captures.find((c) => c.bundleSourceId === source.id);
    const snapshot = capture && (await captureFor(tx, source.url, capture.snapshotId));
    if (
      !capture ||
      !currentCapture(snapshot, source.url, now) ||
      snapshot!.raw_checksum !== capture.rawChecksum ||
      snapshot!.text_checksum !== capture.textChecksum
    )
      throw Error("SOURCE_CURRENT_CAPTURE_REQUIRED");
    await tx.execute(sql`insert into valo_source_release_bindings(target_kind,target_id,source_id,bundle_source_id,source_hash,snapshot_id,raw_hash,created_at)
   values(${kind},${id}::uuid,${capture.sourceId},${source.id},${source.hash},${capture.snapshotId}::uuid,${capture.rawChecksum},clock_timestamp()) on conflict do nothing`);
  }
  if (!(await sourceTargetAllowed(tx, kind, id, raw, now))) throw Error("SOURCE_RELEASE_CURRENTNESS_HELD");
}

/** Server-only evidence binding. A client/staff action cannot bless a snapshot.
 * The ordinary publisher must still pass every existing review/rights/render
 * gate. Exact passages are checked against retained full extracted bytes. Both halves run on the
 * caller's transaction. */
export async function bindReleasedSources(
  tx: SourceTx,
  kind: SourceTarget,
  id: string,
  raw: unknown,
  snapshotIds: Record<string, string> = {},
  now = new Date(),
) {
  await bindVerifiedSources(tx, kind, id, raw, await verifyReleasedSources(tx, raw, snapshotIds, now), now);
}
