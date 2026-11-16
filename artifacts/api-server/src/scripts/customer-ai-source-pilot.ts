import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile as callbackExec } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { and, asc, count, eq, gte, like } from "drizzle-orm";
import { db, pool, valoAIDrafts } from "@workspace/db";
import { createCustomerAIDraft, acceptCustomerAIDraft, customerAIUsage } from "../lib/valo-customer-ai";
import {
  customerPromptVersion,
  customerNoticeVersion,
  hashAI,
  customerProviderPayload,
} from "../lib/valo-customer-ai-domain";
import { getDocument, listRevisions, saveDocument } from "../lib/valo-store";
import { requestExport, getExport, downloadExport } from "../lib/valo-exports";
import { documentInput } from "../lib/valo-validation";
import { readerContainsText } from "../lib/valo-reader-checks";
const exec = promisify(callbackExec);
type SourceCase = {
  caseID: string;
  task: "invoice" | "quotation";
  userInput: string;
  suppliedFacts: {
    parties: { business: string; customer: string };
    reference?: string;
    issueDate?: string;
    dueDate?: string;
    currency: string;
    lines: { description: string; quantity: string; unitPrice: string }[];
    taxTreatment?: null;
    deliveryDate?: null;
  };
  expectedNumeric: { listedItemsSubtotalNGN: string };
};
function kobo(value: string) {
  assert.match(value, /^\d+(?:\.\d{1,2})?$/);
  const [whole, fraction = ""] = value.split(".");
  return (BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"))).toString();
}
function uuidFor(value: unknown) {
  const h = hashAI(value);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.equal(process.env.VALO_RUN_SOURCE_CUSTOMER_PILOT, "synthetic-development-only");
  const root = resolve(import.meta.dirname, "../../../.."),
    out = resolve(root, "generated-artifacts/valo-completion/source-customer-pilot");
  await mkdir(out, { recursive: true });
  const bytes = await readFile(resolve(root, "docs/evaluation-candidates/customer-ai.json"));
  const corpus = JSON.parse(bytes.toString()) as { cases: SourceCase[] };
  const cases = ["CAI-CAND-INV-01", "CAI-CAND-QUO-01"].map((id) => {
    const found = corpus.cases.find((c) => c.caseID === id);
    assert.ok(found);
    return found;
  });
  // Reuse an existing evaluation tenant. Never cycle accounts to evade a limit.
  const [existingActor] = await db
    .select({ workspaceId: valoAIDrafts.workspaceId, identityId: valoAIDrafts.actorId })
    .from(valoAIDrafts)
    .where(like(valoAIDrafts.actorId, "valo-ai-eval-invoice-%"))
    .orderBy(asc(valoAIDrafts.createdAt))
    .limit(1);
  assert.ok(
    existingActor,
    "Existing evaluation identity required; do not create a replacement to bypass limits",
  );
  const actor = existingActor;
  const before = await customerAIUsage(actor),
    startDay = new Date();
  startDay.setUTCHours(0, 0, 0, 0);
  const [globalBefore] = await db
    .select({ used: count() })
    .from(valoAIDrafts)
    .where(and(eq(valoAIDrafts.budgetReserved, true), gte(valoAIDrafts.createdAt, startDay)));
  const [minute] = await db
    .select({ used: count() })
    .from(valoAIDrafts)
    .where(
      and(
        eq(valoAIDrafts.workspaceId, actor.workspaceId),
        gte(valoAIDrafts.createdAt, new Date(Date.now() - 60000)),
      ),
    );
  assert.ok(minute!.used <= 3, "Do not exceed the customer's five requests per minute");
  const { stdout: sourceCommit } = await exec("git", ["rev-parse", "HEAD"], { cwd: root });
  const results: Record<string, unknown>[] = [];
  for (const fixture of cases) {
    let stage = "draft",
      newProviderAttempts: number | null = null,
      previewId: string | null = null;
    try {
      const f = fixture.suppliedFacts;
      assert.equal(f.currency, "NGN");
      const key = uuidFor({
        caseHash: hashAI(fixture),
        prompt: customerPromptVersion,
        notice: customerNoticeVersion,
      });
      const input = {
        task: fixture.task,
        tone: "neutral" as const,
        issuerName: f.parties.business,
        recipientName: f.parties.customer,
        documentNumber: f.reference ?? "",
        issueDate: f.issueDate ?? "",
        dueDate: f.dueDate ?? "",
        contextLines: [],
        draftingInstruction: fixture.userInput,
        processingConsent: true,
        idempotencyKey: key,
        financialInput: {
          kind: fixture.task,
          lines: f.lines.map((l) => ({
            description: l.description,
            quantity: l.quantity,
            unitPriceKobo: kobo(l.unitPrice),
          })),
          taxAmountKobo: null,
          taxLabel: "",
          discountKobo: null,
          amountDueKobo: null,
        },
      };
      const [old] = await db
        .select({ id: valoAIDrafts.id })
        .from(valoAIDrafts)
        .where(and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.idempotencyKey, key)));
      const preview = await createCustomerAIDraft(actor, input);
      previewId = preview.id;
      const [stored] = await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id, preview.id));
      assert.ok(stored);
      const runs = stored.providerRuns as {
        outboundAttempted: boolean;
        responseId: string | null;
        model: string | null;
        usage: unknown;
      }[];
      const actualAttempts = runs.filter((r) => r.outboundAttempted).length;
      newProviderAttempts = old ? 0 : actualAttempts;
      stage = "source-rubric";
      assert.equal(preview.content.fields.issuerName, f.parties.business);
      assert.equal(preview.content.fields.recipientName, f.parties.customer);
      assert.equal(preview.content.fields.issueDate, f.issueDate ?? "");
      assert.equal(preview.content.fields.dueDate, f.dueDate ?? "");
      assert.deepEqual(preview.content.financialInput, input.financialInput);
      assert.ok(
        !JSON.stringify(preview.content).includes(fixture.userInput),
        "Instructions leaked into customer body",
      );
      const expected =
        "₦" + fixture.expectedNumeric.listedItemsSubtotalNGN.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
      const subtotal = preview.content.blocks.flatMap((b) => b.rows).find((r) => r[0] === "Subtotal");
      assert.equal(subtotal?.[1], expected, "Independent supplied monetary oracle mismatch");
      const sent = JSON.stringify(customerProviderPayload(input));
      for (const privateField of [input.issuerName, input.recipientName, input.documentNumber].filter(
        Boolean,
      ))
        assert.ok(!sent.includes(privateField));
      if (fixture.task === "invoice") {
        assert.equal(preview.status, "ready");
        assert.ok(actualAttempts >= 1 && actualAttempts <= 2);
        assert.ok(runs.some((r) => r.outboundAttempted && r.responseId && r.model && r.usage));
      } else {
        assert.equal(preview.status, "needs_information");
        assert.equal(actualAttempts, 0);
        assert.ok(
          preview.missingFields.includes("issueDate"),
          "Unprovided issue date must remain a question",
        );
      }
      stage = "private-save-and-edit";
      let doc = await acceptCustomerAIDraft(actor, preview.id, {
        title: preview.title,
        content: preview.content,
        confirmBusinessDraft: true,
      });
      let canonical = documentInput.parse({ title: doc.title, content: doc.content });
      if (!canonical.content.fields.notes.includes("Synthetic revision check.")) {
        canonical.content.fields.notes += "\nSynthetic revision check.";
        doc = await saveDocument(actor, doc.id, { ...canonical, expectedRevision: doc.revision });
      }
      const reloaded = await getDocument(actor, doc.id),
        history = await listRevisions(actor, doc.id);
      assert.equal(reloaded.contentHash, doc.contentHash);
      assert.ok(history.length >= 2);
      assert.notEqual(history[0]!.contentHash, history[1]!.contentHash);
      canonical = documentInput.parse({ title: reloaded.title, content: reloaded.content });
      assert.deepEqual(canonical.content.financialInput, input.financialInput);
      stage = "real-private-exports";
      const files = [];
      for (const format of ["docx", "pdf"] as const) {
        const job = await requestExport(
          actor,
          doc.id,
          uuidFor({ case: fixture.caseID, revision: doc.revisionId, format }),
          { format, revisionId: doc.revisionId, acknowledgeDraft: true },
        );
        const deadline = Date.now() + 90000;
        let current = await getExport(actor, job.id);
        while (["queued", "running", "retrying"].includes(current.job.status) && Date.now() < deadline) {
          await new Promise((done) => setTimeout(done, 500));
          current = await getExport(actor, job.id);
        }
        assert.equal(current.job.status, "ready");
        const file = await downloadExport(actor, job.id),
          path = resolve(out, `${fixture.caseID}.${format}`);
        await writeFile(path, file.bytes);
        const { stdout: text } =
          format === "docx"
            ? await exec("unzip", ["-p", path, "word/document.xml"])
            : await exec("pdftotext", ["-raw", path, "-"]);
        const flat = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
        assert.ok(
          readerContainsText(flat, f.parties.business) && readerContainsText(flat, f.parties.customer),
          "Private export lost a party's non-whitespace characters",
        );
        assert.ok(readerContainsText(flat, expected), "Private export lost the actual source-case subtotal");
        files.push({
          format,
          bytes: file.bytes.length,
          checksum: createHash("sha256").update(file.bytes).digest("hex"),
          authorisedDownloadPassed: true,
          readerContentPassed: true,
          readerWhitespaceNormalised: true,
        });
      }
      results.push({
        caseID: fixture.caseID,
        caseHash: hashAI(fixture),
        status: fixture.task === "invoice" ? "pass" : "partial",
        evidenceClass: fixture.task === "invoice" ? "provider_generation" : "missing_date_safety_preflight",
        authoredGenerationPassed: fixture.task === "invoice",
        originalCompleteScopeSatisfied: fixture.task === "invoice",
        requiredFollowup:
          fixture.task === "quotation"
            ? {
                question: "What issue date should appear on the quotation?",
                nextStep:
                  "Explicitly declare a synthetic follow-up fixture and execute the real provider generation; the original 27000.00 subtotal, unspecified tax and unconfirmed delivery rubric stays unchanged.",
              }
            : null,
        previewId,
        previewStatus: preview.status,
        missingFields: preview.missingFields,
        promptVersion: stored.promptVersion,
        reusedExactPreview: !!old,
        newProviderAttempts,
        retainedProviderRuns: runs,
        documentId: doc.id,
        savedRevision: doc.revision,
        originalHistoryPreserved: true,
        files,
      });
    } catch (error) {
      results.push({
        caseID: fixture.caseID,
        status: "fail",
        failedAt: stage,
        previewId,
        newProviderAttempts,
        error:
          error instanceof assert.AssertionError
            ? error.message.split("\n")[0]
            : "Operation failed; no provider or export success inferred",
      });
    }
  }
  const report = {
    suite: "supplied-customer-AI-source-pilot",
    sourceCommit: sourceCommit.trim(),
    executedAt: new Date().toISOString(),
    sourceFile: "docs/evaluation-candidates/customer-ai.json",
    sourceSHA256: createHash("sha256").update(bytes).digest("hex"),
    executed: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    partial: results.filter((r) => r.status === "partial").length,
    failed: results.filter((r) => r.status === "fail").length,
    budgetBefore: {
      workspace: before.workspaceUsed,
      workspaceDailyLimit: before.workspaceDailyLimit,
      global: globalBefore!.used,
      globalDailyLimit: 120,
    },
    sameExistingEvaluationTenant: !!existingActor,
    actualBilling: null,
    identityAndHTTPMiddlewareTested: false,
    AI008Accepted: false,
    full60CaseSuiteExecuted: false,
    R1Accepted: false,
    R2Accepted: false,
    limits:
      "One authored invoice generation and a separate partial quotation missing-date safety preflight. QUO-01 complete_scope generation is NOT satisfied until an explicit synthetic follow-up receives actual provider output and the unchanged source rubric is evaluated. Saving/exporting the partial quotation does not complete that generation case. Not sixty-case acceptance, publication or legal accuracy.",
    results,
  };
  await writeFile(
    resolve(root, "docs/valo/evidence/customer-ai-source-pilot.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      executed: report.executed,
      passed: report.passed,
      failed: report.failed,
      newProviderAttempts: results.map((r) => r.newProviderAttempts),
      full60CaseSuiteExecuted: false,
    }),
  );
  if (report.failed) process.exitCode = 1;
}
main()
  .catch(() => {
    console.error("Source pilot stopped safely; do not infer provider, identity or export success");
    process.exitCode = 1;
  })
  .finally(() => pool.end());
