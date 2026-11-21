import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile as callbackExec } from "node:child_process";
import { promisify } from "node:util";
import { eq } from "drizzle-orm";
import { db, pool, valoAIDrafts } from "@workspace/db";
import { digest, sha256 } from "@workspace/valo-core";
import { getCustomerAIDraft, acceptCustomerAIDraft } from "../modules/ai-lanes";
import { getDocument, listRevisions, saveDocument } from "../modules/documents";
import { requestExport, getExport, downloadExport } from "../modules/exports";
import { documentInput } from "../lib/valo-validation";
import { readerContainsText } from "../lib/valo-reader-checks";
import { caseUUID } from "../modules/ai-lanes";
import { workspaceActorFromRecord } from "../platform/workspace-context";
const execFile = promisify(callbackExec);
let stage = "bound-provider-result";
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const root = resolve(import.meta.dirname, "../../../.."),
    out = resolve(root, "generated-artifacts/valo-completion/quote-followup");
  await mkdir(out, { recursive: true });
  const sourceReport = JSON.parse(
    await readFile(
      resolve(root, "generated-artifacts/valo-completion/customer-source60/results.json"),
      "utf8",
    ),
  );
  const record = sourceReport.results.find((r: { caseID: string }) => r.caseID === "CAI-CAND-QUO-01");
  assert.equal(record.status, "provider_generation_pass_with_declared_synthetic_followup");
  const [row] = await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id, record.previewId));
  assert.ok(row);
  assert.equal(row.status, "ready");
  const actor = workspaceActorFromRecord({ workspaceId: row.workspaceId, identityId: row.actorId }),
    preview = await getCustomerAIDraft(actor, row.id);
  assert.equal(preview.status, "ready");
  assert.ok((row.providerRuns as Record<string, unknown>[]).some((r) => r.outboundAttempted && r.responseId));
  assert.equal(preview.content.financialInput?.taxAmountKobo, null);
  assert.equal(preview.content.financialInput?.deliveryKobo, undefined);
  assert.equal(
    preview.content.blocks.flatMap((b) => b.rows).find((r) => r[0] === "Subtotal")?.[1],
    "₦27,000.00",
  );
  stage = "accept-preview";
  let document = await acceptCustomerAIDraft(actor, row.id, {
    title: preview.title,
    content: preview.content,
    confirmBusinessDraft: true,
  });
  const earlier = await listRevisions(actor, document.id),
    canonical = documentInput.parse({ title: document.title, content: document.content });
  if (!canonical.content.fields.notes?.includes("Synthetic quotation follow-up edit.")) {
    canonical.content.fields.notes =
      (canonical.content.fields.notes ?? "") + "\nSynthetic quotation follow-up edit.";
    stage = "save-private-edit";
    document = await saveDocument(actor, document.id, { ...canonical, expectedRevision: document.revision });
  }
  const reloaded = await getDocument(actor, document.id),
    history = await listRevisions(actor, document.id);
  stage = "reload-and-history";
  assert.ok(
    documentInput
      .parse({ title: reloaded.title, content: reloaded.content })
      .content.fields.notes.includes("Synthetic quotation follow-up edit."),
  );
  for (const prior of earlier) assert.ok(history.some((r) => JSON.stringify(r) === JSON.stringify(prior)));
  const files = [];
  for (const format of ["docx", "pdf"] as const) {
    stage = `queue-${format}`;
    const job = await requestExport(
      actor,
      document.id,
      caseUUID({ case: "CAI-CAND-QUO-01-followup", revision: document.revisionId, format }),
      { format, revisionId: document.revisionId, acknowledgeDraft: true },
    );
    let current = await getExport(actor, job.id);
    const deadline = Date.now() + 90000;
    while (["queued", "running", "retrying"].includes(current.job.status) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 400));
      current = await getExport(actor, job.id);
    }
    stage = `worker-${format}`;
    assert.equal(current.job.status, "ready");
    const downloaded = await downloadExport(actor, job.id),
      path = resolve(out, `quotation.${format}`);
    await writeFile(path, downloaded.bytes);
    stage = `reader-${format}`;
    const { stdout } =
      format === "docx"
        ? await execFile("unzip", ["-p", path, "word/document.xml"])
        : await execFile("pdftotext", ["-raw", path, "-"]);
    const text = stdout.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    for (const expected of [
      "₦27,000.00",
      preview.content.fields.issuerName,
      preview.content.fields.recipientName,
      "Synthetic quotation follow-up edit.",
    ])
      assert.ok(readerContainsText(text, expected));
    files.push({
      format,
      jobId: job.id,
      revisionId: document.revisionId,
      size: downloaded.bytes.length,
      hash: sha256(downloaded.bytes),
      authorisedDownload: true,
      actualReaderPassed: true,
    });
  }
  const report = {
    executedAt: new Date().toISOString(),
    caseID: "CAI-CAND-QUO-01",
    caseHash: record.caseHash,
    followup: record.followup,
    providerPreviewId: row.id,
    providerRuns: row.providerRuns,
    newProviderCalls: 0,
    originalUnadaptedGenerationPassed: false,
    syntheticFollowupGenerationPassed: true,
    documentId: document.id,
    revisionId: document.revisionId,
    savedRevision: document.revision,
    canonicalHash: digest({ title: reloaded.title, content: reloaded.content }),
    earlierHistoryPreserved: true,
    files,
    scope:
      "Actual existing synthetic evaluation identity, provider result, authorised persistence and private worker exports. Not a managed sign-in/browser proof, formal customer60 acceptance, publication, commercial licence acceptance or R1/R2 approval.",
  };
  await writeFile(resolve(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      savedRevision: document.revision,
      actualPrivateExports: files.length,
      newProviderCalls: 0,
      formalAcceptance: false,
    }),
  );
}
try {
  await main();
} catch (error) {
  const code =
    error instanceof Error && /^[A-Z_]{3,100}$/.test(error.message)
      ? error.message
      : error instanceof assert.AssertionError
        ? "ASSERTION_FAILED"
        : "JOURNEY_ERROR";
  const out = resolve(import.meta.dirname, "../../../../generated-artifacts/valo-completion/quote-followup");
  await mkdir(out, { recursive: true });
  await writeFile(
    resolve(out, "failure.json"),
    JSON.stringify({ stage, code, executedAt: new Date().toISOString(), completed: false }) + "\n",
  );
  console.error(JSON.stringify({ stage, code, completed: false }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
