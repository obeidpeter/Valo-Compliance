import assert from "node:assert/strict";
import { test } from "node:test";
import { canUseWebShare, exportFileName, exportMimeType, shareExportFile } from "./share-file";

test("exportFileName and exportMimeType build safe filenames and standard MIME types", () => {
  assert.equal(exportFileName("Invoice — Acme Stores #07!", "pdf"), "invoice-acme-stores-07.pdf");
  assert.equal(exportFileName("   ", "docx"), "document.docx");
  assert.equal(exportMimeType("pdf"), "application/pdf");
  assert.equal(
    exportMimeType("docx"),
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  );
});

test("canUseWebShare detects navigator.share safely", () => {
  assert.equal(canUseWebShare(null), false);
  assert.equal(canUseWebShare({}), false);
  assert.equal(canUseWebShare({ share: async () => undefined }), true);
});

test("shareExportFile attaches the fetched file when supported, falls back to URL, and handles cancel", async () => {
  let received: ShareData | null = null;
  const result = await shareExportFile(
    { title: "Synthetic Invoice", format: "pdf", downloadUrl: "https://example.test/file.pdf" },
    {
      fetchImpl: (async () =>
        new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as unknown as typeof fetch,
      nav: {
        canShare: (data) => Boolean(data?.files?.length),
        share: async (data) => {
          received = data;
        },
      },
    },
  );
  assert.equal(result, "shared");
  assert.equal((received as ShareData | null)?.files?.[0]?.name, "synthetic-invoice.pdf");

  const cancelled = await shareExportFile(
    { title: "Synthetic Invoice", format: "docx", downloadUrl: "https://example.test/file.docx" },
    {
      nav: {
        share: async () => {
          const err = new Error("cancelled");
          err.name = "AbortError";
          throw err;
        },
      },
    },
  );
  assert.equal(cancelled, "cancelled");
});
