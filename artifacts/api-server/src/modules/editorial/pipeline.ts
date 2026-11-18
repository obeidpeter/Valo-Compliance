import { randomUUID } from "node:crypto";
import type { ValoEditorialRun } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";
import { batchProcess } from "@workspace/integrations-openai-ai-server/batch";
import { readSourceText } from "../sources";
import { hashEditorial, storeEditorialRun } from "./run-storage";
import { callEditorialModel } from "./model-adapter";
import {
  candidateSchema,
  reviewSchema,
  reviewInput,
  mechanicalCandidate,
  mandatoryDevelopmentHolds,
  editorialModel,
  editorialPromptVersion,
  systemPrompt,
  type EditorialRole,
  type EvidenceBundle,
} from "./pipeline-contract";
import { logger } from "../../platform/logger";
import { editorialDraftInput } from "./citation-selection";
import { setting } from "../../platform/settings";

async function sourceBundle(): Promise<EvidenceBundle> {
  const { db, valoSourceSnapshots } = await import("@workspace/db");
  const [source] = await db
    .select()
    .from(valoSourceSnapshots)
    .where(eq(valoSourceSnapshots.sourceId, "SV-010"))
    .orderBy(desc(valoSourceSnapshots.attemptedAt))
    .limit(1);
  if (
    !source ||
    source.status !== "retrieved_unreviewed" ||
    !source.rawChecksum ||
    !source.textChecksum ||
    !source.fetchedAt ||
    !source.textObjectKey
  )
    throw Error("EDITORIAL_SOURCE_NOT_READY");
  const text = await readSourceText(source.id, source.textChecksum);
  // Printed marginal headings interrupt prose in layout extraction. Locate the
  // actual numbered operative provision, not a reconstructed sentence or index.
  const pages = text.split("\f"),
    page = pages.findIndex((p) => /18[.—–\s-]+\(1\)/u.test(p) && /commencement of this Act/.test(p));
  if (page < 0) throw Error("EDITORIAL_OPERATIVE_PASSAGE_NOT_FOUND");
  const passages = pages
    .slice(page, page + 2)
    .map((text, i) => ({ id: `${source.id}:page:${page + i + 1}`, page: page + i + 1, text }));
  if (passages.reduce((n, p) => n + p.text.length, 0) > 12000) throw Error("EDITORIAL_PASSAGE_TOO_LARGE");
  return {
    snapshotId: source.id,
    sourceId: source.sourceId,
    title: "Companies and Allied Matters Act 2020 (current amendments unverified)",
    url: source.url,
    fetchedAt: source.fetchedAt.toISOString(),
    rawHash: source.rawChecksum,
    textHash: source.textChecksum,
    publication: "held",
    effectivePeriod: "unverified",
    passages,
  };
}
async function reserveRuns(bundle: EvidenceBundle) {
  const { db, valoEditorialRuns } = await import("@workspace/db");
  const pipelineId = randomUUID(),
    now = new Date();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('valo-editorial-development-quota'))`);
    const [count] = await tx
      .select({ total: sql<number>`count(*)::integer` })
      .from(valoEditorialRuns)
      .where(
        and(
          sql`${valoEditorialRuns.createdAt} > now() - interval '24 hours'`,
          sql`${valoEditorialRuns.status} in ('reserved','running','succeeded','failed')`,
        ),
      );
    if ((count?.total ?? 0) + 3 > 9) throw Error("EDITORIAL_DEVELOPMENT_QUOTA");
    return tx
      .insert(valoEditorialRuns)
      .values(
        (["draft", "factual", "challenge"] as const).map((role) => ({
          id: randomUUID(),
          pipelineId,
          sourceSnapshotId: bundle.snapshotId,
          sourceHash: bundle.textHash,
          role,
          status: "reserved",
          model: editorialModel,
          promptVersion: editorialPromptVersion,
          createdAt: now,
          metadata: {
            publication: "held",
            receivedOtherVerdict: false,
            requestedModel: editorialModel,
            configHash: hashEditorial(
              JSON.stringify({
                model: editorialModel,
                role,
                promptVersion: editorialPromptVersion,
                system: systemPrompt(role),
                tools: [],
                timeoutMs: 45000,
                maxRetries: 0,
              }),
            ),
            costReturned: false,
          },
        })),
      )
      .returning();
  });
}
function safeFailure(error: unknown) {
  if (error instanceof Error && /^AI_OUTPUT_(INCOMPLETE|SCHEMA_INVALID)$/.test(error.message))
    return error.message;
  if (error instanceof Error && error.name === "APIConnectionTimeoutError") return "AI_TIMEOUT";
  return "EDITORIAL_RUN_FAILED";
}
async function executeRun(row: ValoEditorialRun, input: unknown, candidateHash: string | null) {
  const { db, valoEditorialRuns } = await import("@workspace/db");
  const role = row.role as EditorialRole,
    inputHash = hashEditorial(JSON.stringify(input));
  await db
    .update(valoEditorialRuns)
    .set({ status: "running", inputHash, candidateHash })
    .where(and(eq(valoEditorialRuns.id, row.id), eq(valoEditorialRuns.status, "reserved")));
  let phase = "provider";
  try {
    const result = await callEditorialModel(role, input);
    phase = "private_artifact";
    await db
      .update(valoEditorialRuns)
      .set({
        model: result.actualModel,
        providerResponseId: result.providerResponseId,
        providerRequestId: result.providerRequestId,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      })
      .where(and(eq(valoEditorialRuns.id, row.id), eq(valoEditorialRuns.status, "running")));
    const artifact = {
      runId: row.id,
      pipelineId: row.pipelineId,
      role,
      promptVersion: editorialPromptVersion,
      model: result.actualModel,
      input,
      systemPrompt: systemPrompt(role),
      inputHash,
      candidateHash: role === "draft" ? hashEditorial(JSON.stringify(result.output)) : candidateHash,
      sourceHash: row.sourceHash,
      output: result.output,
      providerResponseId: result.providerResponseId,
    };
    Object.assign(artifact, {
      providerOutput: result.providerOutput,
      providerOutputHash: hashEditorial(JSON.stringify(result.providerOutput)),
      citationResolutionVersion: role === "draft" ? "source-excerpts-v1" : null,
    });
    const saved = await storeEditorialRun(row.id, artifact);
    const parsedReview = role === "draft" ? null : reviewSchema.parse(result.output);
    await db
      .update(valoEditorialRuns)
      .set({
        status: "succeeded",
        objectKey: saved.key,
        outputHash: saved.hash,
        model: result.actualModel,
        providerResponseId: result.providerResponseId,
        providerRequestId: result.providerRequestId,
        latencyMs: result.latencyMs,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        completedAt: new Date(),
        candidateHash: role === "draft" ? hashEditorial(JSON.stringify(result.output)) : candidateHash,
        metadata: {
          ...row.metadata,
          providerOutputHash: hashEditorial(JSON.stringify(result.providerOutput)),
          citationResolutionVersion: role === "draft" ? "source-excerpts-v1" : null,
          modelVerdict: parsedReview?.verdict ?? null,
          findingsCount: parsedReview?.findings.length ?? null,
        },
      })
      .where(and(eq(valoEditorialRuns.id, row.id), eq(valoEditorialRuns.status, "running")));
    logger.info({ event: "editorial.run_completed", runId: row.id, role, latencyMs: result.latencyMs });
    return result.output;
  } catch (error) {
    const failureCode = safeFailure(error);
    const provider = error as {
      name?: unknown;
      stack?: unknown;
      status?: unknown;
      code?: unknown;
      param?: unknown;
      message?: unknown;
      cause?: { code?: unknown; name?: unknown };
    };
    const errorName =
      typeof provider.name === "string" && /^[A-Za-z]{1,60}$/.test(provider.name) ? provider.name : null;
    const causeCode =
      typeof provider.cause?.code === "string" && /^[A-Za-z0-9_]{1,80}$/.test(provider.cause.code)
        ? provider.cause.code
        : null;
    const frame =
      typeof provider.stack === "string"
        ? (provider.stack
            .split("\n")
            .slice(1)
            .find((l) => /\/(src|node_modules)\/.*:\d+:\d+\)?$/.test(l))
            ?.trim()
            .slice(0, 220) ?? null)
        : null;
    const providerStatus = typeof provider.status === "number" ? provider.status : null;
    const providerCode =
      typeof provider.code === "string" && /^[a-zA-Z0-9_.-]{1,80}$/.test(provider.code)
        ? provider.code
        : null;
    // Only schema-validation diagnostics contain our own fixed schema, not
    // prompts, credentials, response headers or arbitrary provider error bodies.
    const schemaDiagnostic =
      typeof provider.message === "string" && provider.message.includes("Invalid schema for response_format")
        ? provider.message
            .slice(provider.message.indexOf("Invalid schema for response_format"), 700)
            .replace(/[A-Za-z0-9_-]{32,}/g, "[redacted]")
        : null;
    await db
      .update(valoEditorialRuns)
      .set({
        status: "failed",
        failureCode,
        completedAt: new Date(),
        metadata: {
          ...row.metadata,
          providerStatus,
          providerCode,
          schemaDiagnostic,
          phase,
          errorName,
          causeCode,
        },
      })
      .where(and(eq(valoEditorialRuns.id, row.id), eq(valoEditorialRuns.status, "running")));
    logger.warn({
      event: "editorial.run_failed",
      runId: row.id,
      role,
      code: failureCode,
      providerStatus,
      providerCode,
      schemaDiagnostic,
      phase,
      errorName,
      causeCode,
      frame,
    });
    return null;
  }
}
export async function runDevelopmentEditorialProof() {
  const { db, valoEditorialRuns } = await import("@workspace/db");
  if (
    setting("NODE_ENV") !== "development" ||
    setting("REPLIT_DEPLOYMENT") ||
    setting("VALO_RUN_EDITORIAL_PROOF") !== "official-development-only"
  )
    throw Error("EDITORIAL_DEVELOPMENT_ACK_REQUIRED");
  const bundle = await sourceBundle(),
    rows = await reserveRuns(bundle);
  const draft = rows.find((r) => r.role === "draft")!;
  const candidate = await executeRun(draft, editorialDraftInput(bundle), null);
  const candidateHash = candidate ? hashEditorial(JSON.stringify(candidate)) : null;
  const mechanicalErrors = candidate ? mechanicalCandidate(candidate, bundle) : ["draft_unavailable"];
  if (!candidate) {
    await db
      .update(valoEditorialRuns)
      .set({ status: "dependency_held", failureCode: "DRAFT_NOT_READY", completedAt: new Date() })
      .where(
        and(eq(valoEditorialRuns.pipelineId, draft.pipelineId), eq(valoEditorialRuns.status, "reserved")),
      );
  } else {
    candidateSchema.parse(candidate);
    // Each receives only the source bundle and exact candidate, never the other's findings.
    await batchProcess(
      rows.filter((r) => r.role !== "draft"),
      (row) =>
        executeRun(row, reviewInput(row.role as "factual" | "challenge", bundle, candidate), candidateHash),
      { concurrency: 2, retries: 0 },
    );
  }
  const complete = await db
    .select()
    .from(valoEditorialRuns)
    .where(eq(valoEditorialRuns.pipelineId, draft.pipelineId));
  const holdReasons = [...mandatoryDevelopmentHolds, ...mechanicalErrors];
  for (const r of complete)
    if (r.status !== "succeeded" || r.metadata.modelVerdict === "hold")
      holdReasons.push(`${r.role}:${r.status === "succeeded" ? "review_hold" : r.status}`);
  return {
    pipelineId: draft.pipelineId,
    sourceSnapshotId: bundle.snapshotId,
    sourceTextHash: bundle.textHash,
    pages: bundle.passages.map((p) => p.page),
    candidateHash,
    mechanicalErrors,
    runs: complete.map((r) => ({
      id: r.id,
      role: r.role,
      status: r.status,
      model: r.model,
      promptVersion: r.promptVersion,
      inputHash: r.inputHash,
      candidateHash: r.candidateHash,
      outputHash: r.outputHash,
      providerResponseId: r.providerResponseId,
      providerRequestId: r.providerRequestId,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      modelVerdict: typeof r.metadata.modelVerdict === "string" ? r.metadata.modelVerdict : null,
      failureCode: r.failureCode,
    })),
    publication: "held" as const,
    holdReasons,
    professionallyReviewed: false,
    note: "Actual provider calls and private artifacts. Not publication, legal accuracy certification or acceptance of EDP gates.",
  };
}
