import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { candidateDigest, publicationSchema } from "@workspace/valo-core";
import { requestDigest, assertFiniteWorkShape } from "../ai";
import type { FiniteWork } from "../ai";
const root = resolve(import.meta.dirname, "../../../../..");
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** Bindings are read from the approved durable allowlist, not from request
 * headers. Held source candidates may be challenged in isolation: this is NOT
 * a released-content manifest or customer-rule eligibility check. */
export async function assertFiniteWorkBindings(work: FiniteWork) {
  assertFiniteWorkShape(work);
  const b = work.bindings;
  if (!b) throw Error("FINITE_WORK_BINDINGS_MISSING");
  const actualSources: string[] = [];
  for (const f of b.sourceFiles) {
    if (!/^docs\/[a-zA-Z0-9_./ -]+$/.test(f.path) || f.path.split("/").some((p) => p === ".." || p === "."))
      throw Error("SOURCE_BINDING_PATH_REJECTED");
    const actual = hash(await readFile(resolve(root, f.path)));
    if (actual !== f.sha256) throw Error("SOURCE_BINDING_CHANGED");
    actualSources.push(actual);
  }
  if (b.corpus) {
    if (!["editorial", "checker", "customer-ai"].includes(b.corpus) || !b.caseId)
      throw Error("CASE_BINDING_REQUIRED");
    const corpus = JSON.parse(
      await readFile(resolve(root, `docs/evaluation-candidates/${b.corpus}.json`), "utf8"),
    ) as { cases: Record<string, unknown>[] };
    const row = corpus.cases.find((c) => [c.id, c.caseID, c.scenarioId, c.scenarioID].includes(b.caseId));
    if (!row || requestDigest(row) !== work.caseHash) throw Error("CASE_BINDING_CHANGED");
    if (work.lane === "customer" && work.candidateHash !== work.caseHash)
      throw Error("CUSTOMER_CASE_BINDING_CHANGED");
    if (work.lane === "customer") {
      const { prepareCustomerFiniteManifest } = await import("./inference-customer-manifest");
      const expected = await prepareCustomerFiniteManifest(b.caseId);
      if (requestDigest(work.request) !== requestDigest(expected.manifest.works[0]!.request))
        throw Error("CUSTOMER_CASE_REQUEST_CHANGED");
    }
  } else if (work.lane !== "publication") throw Error("EVALUATION_CASE_REQUIRED");
  // Customer works prepared from a saved evaluation plan also carry that plan; validate
  // it and its actor. Case-selection works are bound by the recomputed case request above.
  if (work.lane === "customer" && b.customerPlan) {
    const [
      { getPublicationArtifact },
      { validateCustomerEvaluationWork },
      { assertCustomerEvaluationActor },
    ] = await Promise.all([
      import("../publication"),
      import("./inference-customer-evaluation"),
      import("./inference-customer-runtime"),
    ]);
    const { plan, entry } = await validateCustomerEvaluationWork(work, getPublicationArtifact);
    await assertCustomerEvaluationActor(plan, entry);
  }
  if (work.lane === "publication") {
    // A publication review reads the prepared candidate, saved as a version only once its reviews
    // pass (decision 0014).
    if (!b.candidateVersionId || !b.candidateArtifact) throw Error("CANDIDATE_VERSION_REQUIRED");
    if (!b.operationalPlan || !b.historicalCutoff || !Number.isFinite(Date.parse(b.historicalCutoff)))
      throw Error("OPERATIONAL_PLAN_BINDING_REQUIRED");
    const [
      { db },
      { getPublicationArtifact },
      { readOperationalInferenceReadiness },
      { operationalReviewRequests },
    ] = await Promise.all([
      import("@workspace/db"),
      import("../publication"),
      import("./inference-operational-ready"),
      import("../editorial"),
    ]);
    const current = await readOperationalInferenceReadiness({
      candidateVersionId: b.candidateVersionId,
      candidateArtifact: b.candidateArtifact,
    });
    if (
      current.row.candidateHash !== work.candidateHash ||
      candidateDigest(current.bundle.candidate) !== work.candidateHash
    )
      throw Error("CANDIDATE_BINDING_CHANGED");
    actualSources.push(...current.bundle.sources.map((s) => s.hash));
    if (requestDigest(current.bundle) !== work.caseHash) throw Error("PUBLICATION_BUNDLE_CHANGED");
    const retained = JSON.parse((await getPublicationArtifact(b.operationalPlan)).toString());
    if (
      retained.manifest?.candidateHash !== work.candidateHash ||
      requestDigest(retained.manifest?.serverEvidence) !== requestDigest(current.serverEvidence) ||
      !Number.isFinite(Date.parse(retained.manifest?.expiresAt)) ||
      Date.parse(retained.manifest.expiresAt) <= Date.now()
    )
      throw Error("OPERATIONAL_PLAN_BINDING_CHANGED");
    const expected = operationalReviewRequests(
      current.candidate,
      current.rightsInput,
      current.provenanceInput,
      current.exportReport,
      current.serverEvidence,
      retained.manifest.preparedAt,
      current.bundle.sources,
    );
    if (
      requestDigest(expected) !== requestDigest(retained.entries) ||
      requestDigest(expected.find((e) => e.role === work.role)?.request) !== requestDigest(work.request)
    )
      throw Error("OPERATIONAL_PLAN_REQUEST_CHANGED");
    // Legacy exact-request attempts without a known completion cannot be
    // redispatched by inventing a new batch id. This historical read does
    // not charge unrelated prior account usage to the new allocation.
    const unknown = await db.execute(sql`select id from valo_publication_ai_attempts
      where candidate_hash=${work.candidateHash} and role=${work.role}
      and request_hash=${requestDigest(work.request)} and created_at < ${new Date(b.historicalCutoff)}
      and provider_response_id is null and outcome in ('reserved','failed') limit 1`);
    if (unknown.rows.length) throw Error("HISTORICAL_EXACT_REQUEST_COMPLETION_UNKNOWN");
  } else if (b.candidateVersionId) {
    // Held source candidates may be challenged in isolation; they are saved versions.
    const { db, valoContentVersions } = await import("@workspace/db");
    const [row] = await db
      .select()
      .from(valoContentVersions)
      .where(eq(valoContentVersions.id, b.candidateVersionId));
    if (!row || ["withdrawn", "superseded"].includes(row.status) || row.reviewBy.getTime() <= Date.now())
      throw Error("CANDIDATE_UNAVAILABLE_OR_STALE");
    const bundle = publicationSchema.parse(row.bundle);
    if (row.candidateHash !== work.candidateHash || candidateDigest(bundle.candidate) !== work.candidateHash)
      throw Error("CANDIDATE_BINDING_CHANGED");
    actualSources.push(...bundle.sources.map((s) => s.hash));
  } else if (work.lane !== "customer") throw Error("CANDIDATE_VERSION_REQUIRED");
  if (work.lane === "checker_challenge" && !actualSources.length)
    throw Error("CHECKER_SOURCE_BINDING_REQUIRED");
  if (requestDigest([...actualSources].sort()) !== requestDigest([...work.sourceHashes].sort()))
    throw Error("SOURCE_SET_CHANGED");
}
