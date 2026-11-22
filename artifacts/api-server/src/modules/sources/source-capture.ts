import { randomUUID, createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { setting } from "../../platform/settings";
import { fetchOfficialSource, referenceFor, sourceBodyLimit, SourceFailure } from "./source-fetch";
import { extractSource, EXTRACTION_VERSION } from "./source-extract";
import { storeSourceSnapshot } from "./source-storage";
import { instrumentIdentity } from "./source-identity";
import { assertDevelopmentRuntime } from "../../platform/valo-development-runtime";

/** A trusted operator may retain the two NDPC instruments from their official addresses.
 * The receipt records the original retrieval date. The amendment record supplies the independent,
 * pinned digest. Changed bytes, stale observations and a new edition cannot use the retained file.
 */
export async function readRetainedOfficialPdf(leadId: string, dir: string, pinnedSha256: string, now: Date) {
  assertDevelopmentRuntime();
  if (!["S04", "S05"].includes(leadId) || !isAbsolute(dir) || !/^[a-f0-9]{64}$/.test(pinnedSha256))
    throw new SourceFailure("SOURCE_RETAINED_UNSUPPORTED");
  const file = join(dir, leadId + ".pdf"),
    note = join(dir, leadId + ".json");
  const [pdf, receipt] = await Promise.all([lstat(file), lstat(note)]);
  if (!pdf.isFile() || pdf.size > sourceBodyLimit(leadId) || !receipt.isFile() || receipt.size > 4096)
    throw new SourceFailure("SOURCE_RETAINED_LIMIT");
  const [bytes, raw] = await Promise.all([readFile(file), readFile(note, "utf8")]);
  const doc = JSON.parse(raw),
    url = referenceFor(leadId).url,
    checked = Date.parse(doc.retrievedAt);
  const rawChecksum = createHash("sha256").update(bytes).digest("hex");
  if (
    doc.leadId !== leadId ||
    doc.url !== url ||
    doc.httpStatus !== 200 ||
    doc.rawSha256 !== rawChecksum ||
    rawChecksum !== pinnedSha256 ||
    bytes.subarray(0, 5).toString() !== "%PDF-" ||
    !Number.isFinite(checked) ||
    checked > +now ||
    +now - checked >= 86_400_000
  )
    throw new SourceFailure("SOURCE_RETAINED_BINDING_INVALID");
  const { text } = await extractSource(bytes, "application/pdf", sourceBodyLimit(leadId));
  return {
    leadId,
    url,
    checkedAt: new Date(checked).toISOString(),
    rawChecksum,
    text,
    retrieval: "retained_official_pdf" as const,
  };
}

/** A one-off read for a manual source check. It neither registers a watch nor starts a worker. */
export async function readManualOfficialSource(leadId: string, pinnedSha256?: string) {
  assertDevelopmentRuntime();
  const response = await fetchOfficialSource(leadId);
  const dir = setting("VALO_MANUAL_OFFICIAL_CAPTURE_DIR");
  if (response.status === 403 && pinnedSha256 && dir && ["S04", "S05"].includes(leadId))
    return readRetainedOfficialPdf(leadId, dir, pinnedSha256, new Date());
  if (response.status !== 200) throw new SourceFailure(`SOURCE_HTTP_${response.status}`);
  const { text } = await extractSource(response.bytes, response.mime, sourceBodyLimit(leadId));
  return {
    leadId,
    url: referenceFor(leadId).url,
    checkedAt: response.fetchedAt.toISOString(),
    retrieval: "official_url" as const,
    rawChecksum: createHash("sha256").update(response.bytes).digest("hex"),
    text,
  };
}
export async function captureReference(id: string) {
  const { db, valoSourceSnapshots } = await import("@workspace/db");
  assertDevelopmentRuntime();
  const lead = referenceFor(id);
  let identity: ReturnType<typeof instrumentIdentity> = null;
  const row: typeof valoSourceSnapshots.$inferInsert = {
    id: randomUUID(),
    sourceId: lead.id,
    url: lead.url,
    attemptedAt: new Date(),
    status: "held_transport",
    extractionVersion: EXTRACTION_VERSION,
    metadata: {
      declaredTitle: lead.title,
      rights: "unassessed",
      issuingBody: null,
      jurisdiction: null,
      effectiveFrom: null,
      effectiveTo: null,
      sourceCheckedAt: null,
      aiReviewedAt: null,
      publishedAt: null,
      publication: "held",
      untrustedInput: true,
    },
  };
  try {
    const response = await fetchOfficialSource(id);
    Object.assign(row, {
      finalUrl: response.finalUrl,
      fetchedAt: response.fetchedAt,
      httpStatus: response.status,
      mime: response.mime,
      bytes: response.bytes.length,
      rawChecksum: createHash("sha256").update(response.bytes).digest("hex"),
    });
    row.status = "held_storage";
    const raw = await storeSourceSnapshot(row.id, "raw", response.bytes, sourceBodyLimit(id));
    row.rawObjectKey = raw.key;
    if (response.status < 200 || response.status >= 300) {
      row.status = "held_http";
      row.failureCode = `SOURCE_HTTP_${response.status}`;
    } else {
      row.status = "held_extraction";
      const extracted = await extractSource(response.bytes, response.mime, sourceBodyLimit(id));
      identity = instrumentIdentity(id, extracted.text, extracted.title);
      row.status = "held_storage";
      const text = await storeSourceSnapshot(row.id, "text", Buffer.from(extracted.text));
      row.textChecksum = text.checksum;
      row.textObjectKey = text.key;
      row.status = identity?.status === "held_title_unconfirmed" ? "held_identity" : "retrieved_unreviewed";
      if (row.status === "held_identity") row.failureCode = "SOURCE_CONTENT_TITLE_NOT_CONFIRMED";
      row.metadata = {
        ...row.metadata,
        retrievedTitle: extracted.title,
        locators: extracted.locators,
        textCharacters: extracted.text.length,
        identity,
      };
    }
  } catch (error) {
    const networkCode =
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof error.code === "string" &&
      /^[A-Z_0-9]{1,50}$/.test(error.code)
        ? error.code
        : "FAILED";
    row.failureCode =
      error instanceof SourceFailure
        ? error.code
        : row.status === "held_storage"
          ? "SOURCE_STORAGE_FAILED"
          : row.status === "held_extraction"
            ? "SOURCE_EXTRACTION_FAILED"
            : `SOURCE_TRANSPORT_${networkCode}`;
  }
  await db.insert(valoSourceSnapshots).values(row);
  return {
    id: row.id,
    sourceId: row.sourceId,
    status: row.status,
    failureCode: row.failureCode ?? null,
    httpStatus: row.httpStatus ?? null,
    fetchedAt: row.fetchedAt?.toISOString() ?? null,
    rawChecksum: row.rawChecksum ?? null,
    textChecksum: row.textChecksum ?? null,
    rawStored: Boolean(row.rawObjectKey),
    textStored: Boolean(row.textObjectKey),
    bytes: row.bytes ?? null,
    identity,
    publication: "held" as const,
  };
}
