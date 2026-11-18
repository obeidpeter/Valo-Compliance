import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  valoExportJobs,
  valoExportRequests,
  valoFileAssets,
  valoDocumentRevisions,
  valoDocuments,
  valoEvents,
  valoMemberships,
  valoProfileVersions,
  valoWorkspaces,
  valoExportObjects,
} from "@workspace/db";
import { resolveWorkspace, createDocument, saveDocument, getDocument } from "../../lib/valo-store";
import {
  requestExport,
  getExport,
  listExports,
  executeExport,
  downloadExport,
  retryExport,
} from "./valo-exports";
import {
  deletePrivateFile,
  anonymousPrivateFileStatus,
  fileChecksum,
  writePrivateFile,
} from "../../platform/valo-private-storage";
import { syntheticDocument } from "../../lib/valo-test-fixtures";

const enabled = process.env.VALO_RUN_EXPORT_TESTS === "synthetic-development-only";
test(
  "real development PostgreSQL, private App Storage and renderer integration",
  { skip: !enabled, timeout: 180000 },
  async (t) => {
    const a = await resolveWorkspace("synthetic-export-a-" + randomUUID());
    const b = await resolveWorkspace("synthetic-export-b-" + randomUUID());
    const workspaces = [a.workspaceId, b.workspaceId];
    const temp = await mkdtemp(join(tmpdir(), "valo-export-test-"));
    let worker: ReturnType<typeof spawn> | undefined;
    async function stopWorker() {
      if (!worker || worker.exitCode !== null || worker.signalCode) return;
      const exited = new Promise<void>((resolve) => worker!.once("exit", () => resolve()));
      worker.kill("SIGKILL");
      await exited;
    }
    async function render(jobId: string) {
      const { job } = await getExport(a, jobId);
      await executeExport(job.id, job.workspaceId, job.queueId);
    }
    try {
      const input = structuredClone(syntheticDocument);
      input.title = "Synthetic long-name export — " + "Nigeria business ".repeat(5);
      input.content.fields.issuerName = "Synthetic development organisation ".repeat(4);
      input.content.fields.recipientName = "Synthetic customer";
      input.content.blocks[0]!.text =
        'ORIGINAL REVISION · ₦12,345.67 · <script>fetch("http://169.254.169.254")</script>';
      input.content.blocks.push({
        id: "long-table",
        type: "table",
        text: "",
        rows: Array.from({ length: 65 }, (_, i) => [
          `Synthetic row ${i + 1}`,
          "₦12,345.67",
          "A long descriptive note to exercise multi-page table rendering.",
        ]),
      });
      const doc = await createDocument(a, input);
      const request = { revisionId: doc.revisionId, format: "docx", acknowledgeDraft: true };
      let docxId = "";
      let pdfId = "";
      await t.test(
        "parallel natural duplicates and all request-key aliases resolve to one durable job",
        async () => {
          const keys = Array.from({ length: 6 }, () => randomUUID());
          const jobs = await Promise.all(keys.map((key) => requestExport(a, doc.id, key, request)));
          docxId = jobs[0]!.id;
          assert.equal(new Set(jobs.map((j) => j.id)).size, 1);
          const aliases = await db
            .select()
            .from(valoExportRequests)
            .where(eq(valoExportRequests.workspaceId, a.workspaceId));
          assert.equal(aliases.length, 6);
          await assert.rejects(() => requestExport(a, doc.id, keys[2]!, { ...request, format: "pdf" }), {
            status: 409,
          });
          const rows = await db
            .select()
            .from(valoExportJobs)
            .where(eq(valoExportJobs.workspaceId, a.workspaceId));
          assert.equal(rows.length, 1, "conflicting alias transaction rolled back its new job");
        },
      );
      await t.test(
        "omissions require explicit watermarked-draft acknowledgement; foreign revisions are concealed",
        async () => {
          await assert.rejects(
            () => requestExport(a, doc.id, randomUUID(), { ...request, acknowledgeDraft: false }),
            { status: 422 },
          );
          await assert.rejects(() => requestExport(b, doc.id, randomUUID(), request), { status: 404 });
          await assert.rejects(() => listExports(b, doc.id), { status: 404 });
          await assert.rejects(() => getExport(b, docxId), { status: 404 });
          await assert.rejects(() => downloadExport(b, docxId), { status: 404 });
        },
      );
      await t.test(
        "database composite constraints reject forged cross-workspace revisions and files",
        async () => {
          await assert.rejects(() =>
            db.insert(valoDocumentRevisions).values({
              id: randomUUID(),
              workspaceId: b.workspaceId,
              documentId: doc.id,
              revision: 9,
              title: "Synthetic forbidden",
              content: input.content,
              contentHash: doc.contentHash,
              actorId: b.identityId,
            }),
          );
          await assert.rejects(() =>
            db.insert(valoFileAssets).values({
              id: randomUUID(),
              workspaceId: b.workspaceId,
              jobId: docxId,
              objectKey: "forbidden",
              checksum: "0",
              size: 1,
              mime: "text/plain",
            }),
          );
        },
      );
      await t.test("old immutable revision is used after the current draft changes", async () => {
        const changed = structuredClone(input);
        changed.content.blocks[0]!.text = "CURRENT REVISION SHOULD NOT BE EXPORTED";
        const latest = await saveDocument(a, doc.id, { ...changed, expectedRevision: 1 });
        assert.equal(latest.revision, 2);
        await render(docxId);
        const file = await downloadExport(a, docxId);
        const xml = strFromU8(unzipSync(file.bytes)["word/document.xml"]!);
        assert.ok(xml.includes("ORIGINAL REVISION"));
        assert.ok(!xml.includes("CURRENT REVISION SHOULD NOT BE EXPORTED"));
        assert.ok(xml.includes("₦12,345.67"));
        assert.equal((await getExport(a, docxId)).job.sourceHash, doc.contentHash);
        assert.equal((await getDocument(a, doc.id)).revision, 2);
      });
      await t.test(
        "private object denies anonymous access, has a verified checksum and is never returned as a raw key",
        async () => {
          const row = await getExport(a, docxId);
          assert.ok(row.asset);
          assert.ok([401, 403, 404].includes(await anonymousPrivateFileStatus(row.asset!.objectKey)));
          const file = await downloadExport(a, docxId);
          assert.equal(fileChecksum(file.bytes), row.asset!.checksum);
          assert.equal(file.bytes.length, row.asset!.size);
          const visible = JSON.stringify(await listExports(a, doc.id));
          assert.ok(!visible.includes(row.asset!.objectKey));
          assert.ok(!visible.includes("requestedBy"));
          await assert.rejects(
            () => writePrivateFile(row.asset!.objectKey, Buffer.from("different retry bytes")),
            /PRIVATE_FILE_KEY_ALREADY_WRITTEN/,
          );
          assert.equal(
            fileChecksum((await downloadExport(a, docxId)).bytes),
            row.asset!.checksum,
            "original bytes were not overwritten",
          );
        },
      );
      await t.test(
        "real Chromium PDF is A4, multipage and text-readable with the same revision and naira glyph",
        async () => {
          const job = await requestExport(a, doc.id, randomUUID(), { ...request, format: "pdf" });
          pdfId = job.id;
          await render(pdfId);
          const file = await downloadExport(a, pdfId);
          assert.equal(file.bytes.subarray(0, 5).toString(), "%PDF-");
          const pdfPath = join(temp, "synthetic.pdf");
          await writeFile(pdfPath, file.bytes);
          const { stdout: info } = await promisify(execFile)("pdfinfo", [pdfPath]);
          assert.match(info, /Page size:\s+[\d.]+\s+x\s+[\d.]+\s+pts \(A4\)/i);
          const dimensions = info.match(/Page size:\s+([\d.]+)\s+x\s+([\d.]+)/)!;
          // Chromium's CSS-to-PDF point rounding is below 1.5pt; do not mistake it for a different paper size.
          assert.ok(
            Math.abs(Number(dimensions[1]) - 595.28) < 1.5 && Math.abs(Number(dimensions[2]) - 841.89) < 1.5,
          );
          assert.ok(Number(info.match(/Pages:\s+(\d+)/)?.[1]) >= 2);
          await promisify(execFile)("pdftotext", [pdfPath, join(temp, "text.txt")]);
          const text = await readFile(join(temp, "text.txt"), "utf8");
          assert.ok(text.includes("₦12,345.67"));
          assert.ok(text.includes("ORIGINAL REVISION"));
          assert.ok(text.includes("Saved revision 1"));
          assert.ok(text.includes("INCOMPLETE BUSINESS DRAFT"));
        },
      );
      await t.test("ready delivery is idempotent and suspended memberships cannot read files", async () => {
        await render(docxId);
        const events = await db
          .select()
          .from(valoEvents)
          .where(and(eq(valoEvents.entityId, docxId), eq(valoEvents.action, "export.ready")));
        assert.equal(events.length, 1);
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.workspaceId, a.workspaceId));
        await assert.rejects(() => downloadExport(a, docxId), { status: 404 });
        await assert.rejects(() => requestExport(a, doc.id, randomUUID(), request), { status: 404 });
        await db
          .update(valoMemberships)
          .set({ active: "yes" })
          .where(eq(valoMemberships.workspaceId, a.workspaceId));
      });
      await t.test(
        "failed integrity checks exhaust bounded attempts, never create ready files, and support explicit retry",
        async () => {
          const bad = await createDocument(a, syntheticDocument);
          const job = await requestExport(a, bad.id, randomUUID(), {
            ...request,
            revisionId: bad.revisionId,
          });
          await db
            .update(valoDocumentRevisions)
            .set({ contentHash: "corrupt-test-hash" })
            .where(eq(valoDocumentRevisions.id, bad.revisionId));
          for (let i = 0; i < 3; i++) await assert.rejects(() => render(job.id), /REVISION_INTEGRITY_FAILED/);
          assert.equal((await getExport(a, job.id)).job.status, "failed");
          await assert.rejects(() => downloadExport(a, job.id), { status: 404 });
          await db
            .update(valoDocumentRevisions)
            .set({ contentHash: bad.contentHash })
            .where(eq(valoDocumentRevisions.id, bad.revisionId));
          const oldQueueId = (await getExport(a, job.id)).job.queueId;
          assert.equal((await retryExport(a, job.id)).status, "queued");
          await executeExport(job.id, a.workspaceId, oldQueueId);
          assert.equal((await getExport(a, job.id)).job.attempts, 0, "obsolete retry generation did not run");
          await render(job.id);
          assert.equal((await getExport(a, job.id)).job.status, "ready");
        },
      );
      await t.test(
        "actual worker process can stop abruptly; jobs committed while it is absent survive restart",
        async () => {
          worker = spawn(process.execPath, ["--import", "tsx", "src/workers/export-worker.ts"], {
            cwd: process.cwd(),
            env: { ...process.env, NODE_ENV: "development" },
            stdio: "ignore",
          });
          await new Promise((resolve) => setTimeout(resolve, 1800));
          assert.equal(worker.exitCode, null);
          await stopWorker();
          const pending = await createDocument(a, {
            ...syntheticDocument,
            title: "Synthetic worker restart proof",
          });
          const job = await requestExport(a, pending.id, randomUUID(), {
            revisionId: pending.revisionId,
            format: "docx",
            acknowledgeDraft: true,
          });
          assert.equal((await getExport(a, job.id)).job.status, "queued");
          worker = spawn(process.execPath, ["--import", "tsx", "src/workers/export-worker.ts"], {
            cwd: process.cwd(),
            env: { ...process.env, NODE_ENV: "development" },
            stdio: "ignore",
          });
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline && (await getExport(a, job.id)).job.status !== "ready")
            await new Promise((resolve) => setTimeout(resolve, 250));
          assert.equal((await getExport(a, job.id)).job.status, "ready");
          const queueRow = await db.execute(
            sql`select count(*)::int as n from valo_jobs.job where id = ${(await getExport(a, job.id)).job.queueId}::uuid`,
          );
          assert.equal(queueRow.rows[0]!.n, 1);
        },
      );
    } finally {
      await stopWorker();
      const files = await db
        .select()
        .from(valoFileAssets)
        .where(inArray(valoFileAssets.workspaceId, workspaces));
      for (const file of files) await deletePrivateFile(file.objectKey);
      const objects = await db
        .select()
        .from(valoExportObjects)
        .where(inArray(valoExportObjects.workspaceId, workspaces));
      for (const object of objects) await deletePrivateFile(object.objectKey);
      await db.delete(valoExportObjects).where(inArray(valoExportObjects.workspaceId, workspaces));
      await db.delete(valoFileAssets).where(inArray(valoFileAssets.workspaceId, workspaces));
      await db.delete(valoExportRequests).where(inArray(valoExportRequests.workspaceId, workspaces));
      await db.delete(valoExportJobs).where(inArray(valoExportJobs.workspaceId, workspaces));
      await db.delete(valoEvents).where(inArray(valoEvents.workspaceId, workspaces));
      await db.delete(valoDocumentRevisions).where(inArray(valoDocumentRevisions.workspaceId, workspaces));
      await db.delete(valoDocuments).where(inArray(valoDocuments.workspaceId, workspaces));
      await db.delete(valoProfileVersions).where(inArray(valoProfileVersions.workspaceId, workspaces));
      await db.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, workspaces));
      await db.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, workspaces));
      await rm(temp, { recursive: true, force: true });
      await pool.end();
    }
  },
);
