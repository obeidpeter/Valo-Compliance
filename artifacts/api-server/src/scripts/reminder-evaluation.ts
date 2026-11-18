import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, pool, valoAIDrafts, valoDocumentRevisions } from "@workspace/db";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { createCustomerAIDraft, acceptCustomerAIDraft, getCustomerAIDraft } from "../lib/valo-customer-ai";
import { resolveWorkspace, saveDocument, getDocument } from "../lib/valo-store";
import { requestExport, getExport, downloadExport } from "../modules/exports";
import { recordedBalance, formatKobo } from "@workspace/valo-core/money";
import { candidateReminder, reminderCandidates, exactKobo } from "./reminder-candidate-inputs";
import { logger } from "../platform/logger";
import {
  customerPromptVersion,
  customerNoticeVersion,
  customerProviderPayload,
  hashAI,
} from "../lib/valo-customer-ai-domain";
const exec = promisify(execFile),
  root = fileURLToPath(new URL("../../../../", import.meta.url));
const hash = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  assert.equal(process.env.VALO_RUN_REMINDER_EVAL, "synthetic-development-only");
  const corpusHash = hash(await readFile(`${root}docs/evaluation-candidates/customer-ai.json`));
  const resumed =
    process.env.VALO_REMINDER_RESUME === "1"
      ? (JSON.parse(
          await readFile(
            `${root}docs/valo/evidence/reminder-candidate-evaluation-initial-failure.json`,
            "utf8",
          ),
        ) as { sourceCorpusHash: string; results: { caseID: string; previewId: string }[] })
      : null;
  if (resumed)
    assert.equal(
      resumed.sourceCorpusHash,
      corpusHash,
      "Do not reuse provider evidence after fixture changes",
    );
  const [seed] = resumed
    ? await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id, resumed.results[0]!.previewId))
    : [];
  if (resumed)
    assert.ok(
      seed?.actorId.startsWith("valo-reminder-eval-"),
      "Only this synthetic evaluation may be resumed",
    );
  const actor = await resolveWorkspace(seed?.actorId ?? `valo-reminder-eval-${randomUUID()}`);
  const foreign = await resolveWorkspace(`valo-reminder-eval-foreign-${randomUUID()}`);
  const dir = `${root}generated-artifacts/valo-reminder-evaluation`;
  await mkdir(dir, { recursive: true });
  const startedAt = new Date().toISOString();
  const results = await batchProcess(
    reminderCandidates,
    async (candidate) => {
      const input = candidateReminder(candidate),
        expectsProvider = ["CAI-CAND-REM-01", "CAI-CAND-REM-03"].includes(candidate.caseID);
      let previewId: string | null = null,
        stage = "prepare";
      const exports: {
        id: string;
        format: string;
        status: string;
        checksum: string;
        bytes: number;
        standardReaderParsed: boolean;
      }[] = [];
      try {
        const previous = resumed?.results.find((r) => r.caseID === candidate.caseID);
        if (previous) {
          const [row] = await db
            .select()
            .from(valoAIDrafts)
            .where(
              and(eq(valoAIDrafts.id, previous.previewId), eq(valoAIDrafts.workspaceId, actor.workspaceId)),
            );
          assert.ok(row);
          assert.equal(row.promptVersion, `${customerPromptVersion}/${customerNoticeVersion}`);
          if (row.providerInputHash)
            assert.equal(row.providerInputHash, hashAI(customerProviderPayload(input)));
          input.idempotencyKey = row.idempotencyKey;
        }
        stage = "create_or_resume_preview";
        const preview = await createCustomerAIDraft(actor, input);
        previewId = preview.id;
        const balance = recordedBalance(input.financialInput.paymentRecord!);
        assert.equal(
          balance.amountDueKobo,
          exactKobo(
            candidate.expectedNumeric.outstandingNGN ??
              candidate.expectedNumeric.amountDueOnSuppliedFactsNGN!,
          ),
        );
        assert.deepEqual(preview.content.financialInput, input.financialInput);
        stage = "private_preview_and_isolation";
        assert.equal((await getCustomerAIDraft(actor, preview.id)).previewHash, preview.previewHash);
        await assert.rejects(getCustomerAIDraft(foreign, preview.id), { status: 404 });
        if (!expectsProvider) {
          assert.equal(preview.status, "needs_information");
          assert.equal(preview.providerCalls, 0);
        }
        stage = "accept_private_document";
        let document = await acceptCustomerAIDraft(actor, preview.id, {
          title: preview.title,
          content: preview.content,
          confirmBusinessDraft: true,
        });
        const original = await getDocument(actor, document.id);
        stage = "save_immutable_revision";
        if (!resumed || document.revision === 1) {
          document = await saveDocument(actor, document.id, {
            title: document.title + " — edited",
            content: document.content,
            expectedRevision: document.revision,
          });
          assert.equal(document.revision, original.revision + 1);
        }
        const [first] = await db
          .select()
          .from(valoDocumentRevisions)
          .where(
            and(eq(valoDocumentRevisions.documentId, document.id), eq(valoDocumentRevisions.revision, 1)),
          );
        assert.ok(first);
        assert.ok(document.revision > 1);
        assert.deepEqual(first.content.financialInput, document.content.financialInput);
        assert.deepEqual(document.content.financialInput, original.content.financialInput);
        const [revision] = await db
          .select()
          .from(valoDocumentRevisions)
          .where(
            and(
              eq(valoDocumentRevisions.documentId, document.id),
              eq(valoDocumentRevisions.revision, document.revision),
            ),
          );
        assert.ok(revision);
        const revisionId = revision.id;
        for (const format of ["docx", "pdf"] as const) {
          stage = `${format}_request`;
          const key = randomUUID(),
            body = { format, revisionId, acknowledgeDraft: true };
          const queued = await requestExport(actor, document.id, key, body);
          assert.equal((await requestExport(actor, document.id, key, body)).id, queued.id);
          let row = await getExport(actor, queued.id);
          stage = `${format}_worker`;
          const deadline = Date.now() + 60000;
          while (["queued", "running", "retrying"].includes(row.job.status) && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            row = await getExport(actor, queued.id);
          }
          assert.equal(row.job.status, "ready");
          assert.ok(row.asset);
          stage = `${format}_private_download`;
          await assert.rejects(getExport(foreign, queued.id), { status: 404 });
          const file = await downloadExport(actor, queued.id);
          const bytes = file.bytes;
          assert.equal(hash(bytes), row.asset.checksum);
          const path = `${dir}/${candidate.caseID}.${format}`;
          await writeFile(path, bytes);
          stage = `${format}_standard_reader`;
          let parsed: string;
          if (format === "docx") {
            const python =
              "import sys,zipfile,xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); r=E.fromstring(z.read('word/document.xml')); print(' '.join(r.itertext()))";
            parsed = (await exec("python", ["-c", python, path], { maxBuffer: 1024 * 1024 })).stdout;
          } else {
            const info = (await exec("pdfinfo", [path])).stdout;
            const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
            assert.ok(pages > 0 && pages < 1000);
            for (let page = 1; page <= pages; page++) {
              const details = (await exec("pdfinfo", ["-f", String(page), "-l", String(page), path])).stdout;
              const size = details.match(/Page\s+(?:\d+\s+)?size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/);
              assert.ok(size);
              assert.ok(Math.abs(Number(size[1]) - 595.276) < 2 && Math.abs(Number(size[2]) - 841.89) < 2);
            }
            parsed = (await exec("pdftotext", [path, "-"], { maxBuffer: 1024 * 1024 })).stdout;
          }
          assert.ok(parsed.replace(/\s/g, "").includes(formatKobo(balance.amountDueKobo).replace(/\s/g, "")));
          for (const payment of input.financialInput.paymentRecord!.payments)
            assert.ok(parsed.includes(payment.reference));
          exports.push({
            id: queued.id,
            format,
            status: row.job.status,
            checksum: hash(bytes),
            bytes: bytes.length,
            standardReaderParsed: true,
          });
        }
        const [record] = await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id, preview.id));
        assert.ok(record);
        const actualProviderAttempts = record.providerRuns.filter((run) => run.outboundAttempted).length;
        const status = expectsProvider && preview.status !== "ready" ? "blocked" : "pass";
        if (expectsProvider && status === "pass")
          assert.ok(
            actualProviderAttempts > 0 && record.providerRuns.some((run) => run.responseId && run.usage),
          );
        return {
          caseID: candidate.caseID,
          status,
          expectsProvider,
          previewId,
          previewStatus: preview.status,
          actualProviderAttempts,
          providerRuns: record.providerRuns,
          promptVersion: record.promptVersion,
          failureCode: record.failureCode,
          documentId: document.id,
          revision: document.revision,
          balance,
          exports,
          tenantIsolationPassed: true,
        };
      } catch (error) {
        const [record] = previewId
          ? await db.select().from(valoAIDrafts).where(eq(valoAIDrafts.id, previewId))
          : [];
        return {
          caseID: candidate.caseID,
          status: "fail",
          expectsProvider,
          previewId,
          actualProviderAttempts: record?.providerRuns.filter((run) => run.outboundAttempted).length ?? 0,
          providerRuns: record?.providerRuns ?? [],
          failureCode: record?.failureCode ?? "RETAINED_SCENARIO_OR_EXPORT_ASSERTION_FAILED",
          exports,
          stage,
          errorName: error instanceof Error ? error.name : "Unknown",
          location:
            error instanceof Error
              ? error.stack
                  ?.split("\n")
                  .find((l) => l.trim().startsWith("at ") && l.includes("reminder-evaluation.ts:"))
              : null,
        };
      }
    },
    { concurrency: 1, retries: 0 },
  );
  const report = {
    suite: "supplied-reminder-candidate-vertical-slice",
    startedAt,
    finishedAt: new Date().toISOString(),
    sourceCorpusHash: corpusHash,
    resumedExactPriorProviderInputs: !!resumed,
    suppliedCasesExecuted: results.length,
    passed: results.filter((r) => r.status === "pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    actualProviderAttempts: results.reduce((sum, r) => sum + r.actualProviderAttempts, 0),
    newProviderAttemptsThisExecution: resumed
      ? 0
      : results.reduce((sum, r) => sum + r.actualProviderAttempts, 0),
    faultInjectionCases: 0,
    managedIdentityEvaluated: false,
    serviceLayerOnly: true,
    scope:
      "Four original reminder cases; two request the real configured provider and two intentionally stop at missing-information/zero-balance preflight. Real saved revisions, queue worker, private DOCX/PDF and foreign-tenant rejection. Not the full 60-case evaluation.",
    syntheticRecordsAndProviderQuotaRetained: true,
    AI008Accepted: false,
    R1Accepted: false,
    R2Accepted: false,
    results,
  };
  await writeFile(
    `${root}docs/valo/evidence/reminder-candidate-evaluation.json`,
    JSON.stringify(report, null, 2) + "\n",
  );
  logger.info({
    event: "reminder.evaluation_finished",
    cases: report.suppliedCasesExecuted,
    passed: report.passed,
    failed: report.failed,
    blocked: report.blocked,
    providerAttempts: report.actualProviderAttempts,
  });
  if (report.failed || report.blocked) process.exitCode = 1;
}
try {
  await main();
} catch {
  logger.error({ event: "reminder.evaluation_failed_before_report" });
  process.exitCode = 1;
} finally {
  await pool.end();
}
