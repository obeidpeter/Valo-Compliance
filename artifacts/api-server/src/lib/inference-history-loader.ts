import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { getPublicationArtifact } from "../editorial/publication-artifacts";
import type { HistoryEvidence, HistoryRow } from "./inference-history-classification";
import type { HistoricalPublicationAttempt } from "./inference-history-reconciliation";
import { requestDigest } from "./inference-budget";
const root = resolve(import.meta.dirname, "../../../..");
const sha = (s: Uint8Array) => createHash("sha256").update(s).digest("hex");
const numeric = (s: unknown) => (s === null || s === undefined ? null : Number(s));
const nullable = (s: unknown) => (typeof s === "string" ? s : null);

/** Read metadata only from application rows. Historical optional columns are
 * addressed through to_jsonb, never presumed to have existed at dispatch. */
export async function loadInferenceHistory(c: PoolClient): Promise<HistoryEvidence> {
  const e: HistoryEvidence = {
    rows: [],
    publicationAttempts: [],
    publicationArtifacts: [],
    editorialReceipts: [],
    sourceReferences: [],
    excludedNoOutboundCustomerRuns: 0,
    excludedCustomerSources: [],
  };
  const sources = new Map<string, Record<string, unknown>>();
  for (const [table, lane] of [
    ["valo_publication_ai_attempts", "publication"],
    ["valo_editorial_runs", "editorial_evaluation"],
  ] as const) {
    const rows = await c.query(`SELECT id::text,
      to_jsonb(r)->>'candidate_hash' candidate_hash,to_jsonb(r)->>'role' role,
      to_jsonb(r)->>'request_hash' request_hash,to_jsonb(r)->>'input_hash' input_hash,
      to_jsonb(r)->>'provider_response_id' response_id,to_jsonb(r)->>'model' model,
      to_jsonb(r)->>'input_tokens' input_tokens,to_jsonb(r)->>'output_tokens' output_tokens,
      to_jsonb(r)->>'status' status,to_jsonb(r)->>'failure_code' failure_code,
      to_jsonb(r)->>'pipeline_id' pipeline_id FROM ${table} r ORDER BY id`);
    for (const r of rows.rows) {
      const sourceKey = `${lane === "publication" ? "publication" : "editorial"}:${r.id}`;
      const row: HistoryRow = {
        sourceKey,
        lane,
        id: r.id,
        role: r.role,
        model: nullable(r.model),
        responseId: nullable(r.response_id),
        input: numeric(r.input_tokens),
        output: numeric(r.output_tokens),
        status: nullable(r.status),
        failureCode: nullable(r.failure_code),
        candidateHash: nullable(r.candidate_hash),
        inputHash: nullable(r.input_hash),
        pipelineId: nullable(r.pipeline_id),
      };
      e.rows.push(row);
      sources.set(sourceKey, r);
      if (lane === "publication")
        e.publicationAttempts.push({
          id: r.id,
          candidateHash: r.candidate_hash,
          role: r.role,
          requestHash: nullable(r.request_hash),
          responseId: row.responseId,
          inputTokens: row.input,
          outputTokens: row.output,
        } satisfies HistoricalPublicationAttempt);
    }
  }
  const customers = await c.query(
    "SELECT id::text,provider_runs,budget_reserved FROM valo_ai_drafts ORDER BY id",
  );
  for (const r of customers.rows) {
    const runs = r.provider_runs as Record<string, unknown>[];
    if (!runs.length && r.budget_reserved)
      e.rows.push({
        sourceKey: `customer-unresolved:${r.id}`,
        lane: "customer",
        id: r.id,
        role: "customer",
        model: null,
        responseId: null,
        input: null,
        output: null,
        status: null,
        failureCode: null,
        candidateHash: null,
        inputHash: null,
        pipelineId: null,
      });
    for (const [i, run] of runs.entries()) {
      if (run.outboundAttempted === false) {
        e.excludedNoOutboundCustomerRuns++;
        e.excludedCustomerSources!.push({
          sourceKey: `customer:${r.id}:${i}`,
          metadataHash: requestDigest({
            outboundAttempted: false,
            model: run.model ?? null,
            responseId: run.responseId ?? null,
            usage: run.usage ?? null,
          }),
        });
        continue;
      }
      const u = run.usage as { inputTokens?: number; outputTokens?: number } | null;
      e.rows.push({
        sourceKey: `customer:${r.id}:${i}`,
        lane: "customer",
        id: `${r.id}:${i}`,
        role: "customer",
        model: nullable(run.model),
        responseId: nullable(run.responseId),
        input: numeric(u?.inputTokens),
        output: numeric(u?.outputTokens),
        status: nullable(run.outcome),
        failureCode: null,
        candidateHash: null,
        inputHash: null,
        pipelineId: null,
      });
    }
  }
  for (const version of [1, 2, 3, 4, 5, 6, 8]) {
    const path = `docs/valo/evidence/operational-publication-v${version}.json`,
      bytes = await readFile(resolve(root, path));
    const report = JSON.parse(bytes.toString()),
      sourceReportSha256 = sha(bytes);
    e.sourceReferences.push({ path, sha256: sourceReportSha256 });
    for (const ref of report.attestations?.reviews ?? []) {
      const bytes = await getPublicationArtifact(ref);
      e.publicationArtifacts.push({
        ref,
        bytes,
        reportCandidateHash: report.candidateHash,
        sourceReportSha256,
      });
    }
  }
  const draft = {
    id: "bad6b715-6e07-40e0-9f2c-0dc11e1ffbe0",
    hash: "3231c20e8d24ccbe2bdc1b52c318883160f14acc6ab05242a01f5a181beb9be3",
    extension: "json" as const,
  };
  e.publicationArtifacts.push({
    ref: draft,
    bytes: await getPublicationArtifact(draft),
    reportCandidateHash: "08fef2cf6f4797bd17466b37f594e38d51f6afb79dd59abb6aea1d0c3979e997",
    sourceReportSha256: draft.hash,
  });
  for (const name of ["p0-editorial-before-citation-selection.json", "p0-editorial-provider-proof.json"]) {
    const path = `docs/valo/evidence/${name}`,
      bytes = await readFile(resolve(root, path)),
      report = JSON.parse(bytes.toString());
    const sourceReportSha256 = sha(bytes);
    e.sourceReferences.push({ path, sha256: sourceReportSha256 });
    for (const run of report.runs ?? []) {
      const sourceKey = `editorial:${run.id}`,
        row = sources.get(sourceKey);
      if (!row || report.pipelineId !== row.pipeline_id || run.status !== "succeeded")
        throw Error("HISTORY_EDITORIAL_SOURCE_ID_MISMATCH");
      e.editorialReceipts.push({
        sourceKey,
        sourceReportSha256,
        role: run.role,
        model: run.model,
        responseId: run.providerResponseId,
        input: run.inputTokens,
        output: run.outputTokens,
        inputHash: run.inputHash,
      });
    }
  }
  const path = "artifacts/api-server/src/editorial/pipeline.ts";
  e.sourceReferences.push({ path, sha256: sha(await readFile(resolve(root, path))) });
  return e;
}
