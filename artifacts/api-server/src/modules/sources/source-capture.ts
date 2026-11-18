import { randomUUID, createHash } from "node:crypto";
import { fetchOfficialSource, referenceFor, sourceBodyLimit, SourceFailure } from "./source-fetch";
import { extractSource, EXTRACTION_VERSION } from "./source-extract";
import { storeSourceSnapshot } from "./source-storage";
import { instrumentIdentity } from "./source-identity";
import { assertDevelopmentRuntime } from "../../lib/valo-development-runtime";
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
