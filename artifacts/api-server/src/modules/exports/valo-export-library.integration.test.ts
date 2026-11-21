import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, pool, valoDocuments, valoFileAssets } from "@workspace/db";
import { createDocument, saveDocument } from "../documents";
import { resolveWorkspace } from "../workspaces";
import {
  requestExport,
  getExport,
  executeExport,
  downloadExport,
  listWorkspaceExports,
} from "./valo-exports";
import { financeHeldFixture } from "../commerce/valo-finance-test-fixture";
import { syntheticDocument } from "../../lib/valo-test-fixtures";

// DOC-005 accepts "successful exports appear in the business library and remain linked to the
// template version used." The template version here is a held synthetic fixture that was never
// released: this test shows the library and the link, not the release path or the purchase check.
const enabled = process.env.VALO_RUN_EXPORT_TESTS === "synthetic-development-only";
test(
  "ready exports appear in the business library with their revision and the template version their document came from",
  { skip: !enabled, timeout: 120000 },
  async () => {
    try {
      const owner = await resolveWorkspace("synthetic-library-owner-" + randomUUID());
      const outsider = await resolveWorkspace("synthetic-library-other-" + randomUUID());
      const template = await financeHeldFixture();
      assert.notEqual(template.status, "published", "the fixture template version is not released");

      const fromTemplate = structuredClone(syntheticDocument);
      fromTemplate.title = "Synthetic library draft";
      const doc = await createDocument(owner, fromTemplate);
      // As createReleasedTemplateDraft records it when a customer starts from a released template.
      await db
        .update(valoDocuments)
        .set({ templateVersionId: template.id })
        .where(and(eq(valoDocuments.id, doc.id), eq(valoDocuments.workspaceId, owner.workspaceId)));
      const blank = await createDocument(owner, {
        ...structuredClone(syntheticDocument),
        title: "Synthetic blank",
      });

      const exportRevision = async (documentId: string, revisionId: string, format: "pdf" | "docx") => {
        const requested = await requestExport(owner, documentId, randomUUID(), {
          revisionId,
          format,
          acknowledgeDraft: true,
        });
        // Nothing is in the library until the file is ready.
        assert.ok(!(await listWorkspaceExports(owner)).some((e) => e.id === requested.id));
        const { job } = await getExport(owner, requested.id);
        await executeExport(job.id, job.workspaceId, job.queueId);
        assert.equal((await getExport(owner, requested.id)).job.status, "ready");
        return requested.id;
      };
      const expected = {
        versionId: template.id,
        templateId: template.templateId,
        version: template.version,
      };

      assert.deepEqual(await listWorkspaceExports(owner), [], "an empty library before any export");
      const pdf = await exportRevision(doc.id, doc.revisionId, "pdf");
      let library = await listWorkspaceExports(owner);
      assert.equal(library.length, 1);
      assert.deepEqual(
        {
          id: library[0]!.id,
          documentId: library[0]!.documentId,
          documentTitle: library[0]!.documentTitle,
          revision: library[0]!.revision,
          format: library[0]!.format,
          downloadUrl: library[0]!.downloadUrl,
          template: library[0]!.template,
        },
        {
          id: pdf,
          documentId: doc.id,
          documentTitle: "Synthetic library draft",
          revision: 1,
          format: "pdf",
          downloadUrl: `/api/v1/exports/${pdf}/file`,
          template: expected,
        },
      );
      const file = await downloadExport(owner, pdf);
      assert.equal(file.mime, "application/pdf");
      assert.ok(file.bytes.length > 0);

      // A later revision keeps the document's link; the earlier file keeps its own revision and title.
      const changed = structuredClone(fromTemplate);
      changed.title = "Synthetic library draft, revised";
      const revised = await saveDocument(owner, doc.id, { ...changed, expectedRevision: 1 });
      assert.equal(revised.revision, 2);
      const docx = await exportRevision(doc.id, revised.revisionId, "docx");
      const plain = await exportRevision(blank.id, blank.revisionId, "pdf");
      library = await listWorkspaceExports(owner);
      const byId = new Map(library.map((e) => [e.id, e]));
      assert.deepEqual(
        library.map((e) => e.id),
        [plain, docx, pdf],
        "newest first",
      );
      assert.deepEqual(
        [byId.get(docx)!.revision, byId.get(docx)!.documentTitle, byId.get(docx)!.template],
        [2, "Synthetic library draft, revised", expected],
      );
      assert.deepEqual(
        [byId.get(pdf)!.revision, byId.get(pdf)!.documentTitle, byId.get(pdf)!.template],
        [1, "Synthetic library draft", expected],
      );
      assert.equal(byId.get(plain)!.template, null, "a document not made from a template has no link");

      // Another workspace's library shows none of these, and an expired file leaves the library.
      assert.deepEqual(await listWorkspaceExports(outsider), []);
      await db
        .update(valoFileAssets)
        .set({ retentionAt: new Date(Date.now() - 1000) })
        .where(and(eq(valoFileAssets.jobId, pdf), eq(valoFileAssets.workspaceId, owner.workspaceId)));
      assert.deepEqual(
        (await listWorkspaceExports(owner)).map((e) => e.id),
        [plain, docx],
      );
    } finally {
      await pool.end();
    }
  },
);
