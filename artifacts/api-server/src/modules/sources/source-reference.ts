import { sql } from "drizzle-orm";
import { allSourceLeads } from "@workspace/valo-core";
import { assertOfficialAddress, SourceFailure } from "./source-fetch";
import type { SourceReader } from "./valo-source-state";

/** An official source the daily check may read: a lead kept in the repository, or one a Content editor
 * added to the source register (docs/architecture/source-register.md, slice 2). */
export type SourceReference = {
  id: string;
  title: string;
  url: string;
  origin: "repository" | "register";
};

/**
 * Where a source id points. A lead kept in the repository is read from code, as before. Any other id is
 * the register's: its latest version, only while it is active, and only at an address on a host the
 * approved guidance policy lists, checked again on every read. Nothing a request names is ever used.
 */
export async function sourceReference(reader: SourceReader, id: string): Promise<SourceReference> {
  const lead = allSourceLeads.find((entry) => entry.id === id);
  if (lead) return { id: lead.id, title: lead.title, url: lead.url, origin: "repository" };
  const [row] = (
    await reader.execute(
      sql`select title,url,status from valo_source_register where source_id=${id} order by version desc limit 1`,
    )
  ).rows;
  if (!row) throw new SourceFailure("SOURCE_NOT_ALLOWLISTED");
  if (row.status !== "active") throw new SourceFailure("SOURCE_RETIRED");
  return {
    id,
    title: String(row.title),
    url: assertOfficialAddress(String(row.url)).href,
    origin: "register",
  };
}
