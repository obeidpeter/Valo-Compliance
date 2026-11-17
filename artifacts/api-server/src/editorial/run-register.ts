import { db, valoEditorialRuns } from "@workspace/db";
import { desc } from "drizzle-orm";
export async function editorialRunRegister() {
  const rows = await db.select().from(valoEditorialRuns).orderBy(desc(valoEditorialRuns.createdAt)).limit(18);
  return rows.map((r) => ({
    id: r.id,
    pipelineId: r.pipelineId,
    role: r.role,
    status: r.status,
    model: r.model,
    promptVersion: r.promptVersion,
    sourceHash: r.sourceHash,
    candidateHash: r.candidateHash,
    providerResponseId: r.providerResponseId,
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    createdAt: r.createdAt.toISOString(),
    publication: "held" as const,
    failureCode: r.failureCode,
    modelVerdict: typeof r.metadata.modelVerdict === "string" ? r.metadata.modelVerdict : null,
  }));
}
