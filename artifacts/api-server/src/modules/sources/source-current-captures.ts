import { sql } from "drizzle-orm";
import { currentCapture } from "./source-release-bindings";
import { readSourceText } from "./source-storage";
import { type SourceReader, sourceTime } from "./valo-source-state";

/** An official address's current capture: the file its watch last confirmed, and the text read from it. */
export type CurrentSourceCapture = {
  leadId: string;
  url: string;
  snapshotId: string;
  checkedAt: string;
  rawChecksum: string;
  textChecksum: string;
  text: string;
};

/**
 * The current capture of each lead given: the snapshot its watch last confirmed, with its extracted
 * text read from private storage. "Current" is the release's own test (`currentCapture`): a known
 * official address, a successful capture, the file the watch last saw, checked within the last day.
 * A lead with no watch, a failed or stale check, or a check dated in the future is left out: the
 * caller sees what is missing by what is not returned.
 *
 * It reads storage, so it runs outside any transaction. It fetches nothing from the network: the
 * daily source check does that. `reader` and `readText` are for tests.
 */
export async function currentSourceCaptures(
  leadIds: readonly string[],
  now = new Date(),
  options: {
    reader?: SourceReader;
    readText?: (snapshotId: string, checksum: string) => Promise<string>;
  } = {},
): Promise<CurrentSourceCapture[]> {
  if (!leadIds.length) return [];
  const reader = options.reader ?? (await import("@workspace/db")).db;
  const readText = options.readText ?? readSourceText;
  const rows = (
    await reader.execute(sql`select s.*, w.last_raw_hash, w.checked_at, w.failure_code
      from valo_source_watches w
      join valo_source_snapshots s on s.id = w.last_snapshot_id and s.source_id = w.source_id and s.url = w.url
      where w.stopped_at is null and w.source_id in (${sql.join(
        leadIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by w.source_id`)
  ).rows;
  const captures: CurrentSourceCapture[] = [];
  for (const row of rows) {
    const url = String(row.url);
    if (!currentCapture(row, url, now) || sourceTime(row.checked_at) > +now) continue;
    captures.push({
      leadId: String(row.source_id),
      url,
      snapshotId: String(row.id),
      checkedAt: new Date(sourceTime(row.checked_at)).toISOString(),
      rawChecksum: String(row.raw_checksum),
      textChecksum: String(row.text_checksum),
      text: await readText(String(row.id), String(row.text_checksum)),
    });
  }
  return captures;
}

/** A lead's watch as the daily source check left it: when it was last checked, and why that check
 * failed, if it did. */
export type SourceWatchState = { leadId: string; checkedAt: string | null; failureCode: string | null };

/**
 * The watch of each lead given, for a screen that says where each source stands: not watched (left
 * out), watched and waiting for its first check, checked, or failed. It reads only the watches, so it
 * runs anywhere a pooled read may; `reader` is for tests.
 */
export async function sourceWatchStates(
  leadIds: readonly string[],
  reader?: SourceReader,
): Promise<SourceWatchState[]> {
  if (!leadIds.length) return [];
  const source = reader ?? (await import("@workspace/db")).db;
  const rows = (
    await source.execute(sql`select source_id, checked_at, failure_code from valo_source_watches
      where source_id in (${sql.join(
        leadIds.map((id) => sql`${id}`),
        sql`, `,
      )})
      order by source_id`)
  ).rows;
  return rows.map((row) => ({
    leadId: String(row.source_id),
    checkedAt: row.checked_at ? new Date(sourceTime(row.checked_at)).toISOString() : null,
    failureCode: row.failure_code ? String(row.failure_code) : null,
  }));
}
