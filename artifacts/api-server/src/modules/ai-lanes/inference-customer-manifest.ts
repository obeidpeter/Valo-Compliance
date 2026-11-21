import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  bindCustomerCase,
  caseUUID,
  expectedSourceNumbers,
  type AuthoredCustomerCase,
} from "./valo-customer-case-binding";
import { customerProviderPayload } from "./valo-customer-ai-domain";
import { customerCompletionRequest } from "./valo-customer-ai-model";
import {
  withApprovedInferenceWork,
  requestDigest,
  inferenceProposal,
  additionalInferenceAllocation,
} from "../ai";
import type { FiniteManifest, FiniteWork } from "../ai";

const root = resolve(import.meta.dirname, "../../../../..");
const path = "docs/evaluation-candidates/customer-ai.json";
/** Read original facts only. Missing facts and unresolved oracle/mapping issues
 * hold this preparer; it cannot manufacture a follow-up or author new content. */
export async function prepareCustomerFiniteManifest(
  caseId: string,
  options: { retry?: boolean | undefined; now?: Date | undefined; packageId?: string | undefined } = {},
) {
  const bytes = await readFile(resolve(root, path));
  const row = (JSON.parse(bytes.toString()) as { cases: AuthoredCustomerCase[] }).cases.find(
    (c) => c.caseID === caseId,
  );
  if (!row) throw Error("CUSTOMER_CASE_NOT_FOUND");
  const bound = bindCustomerCase(row);
  if (
    !bound.input ||
    bound.issues.length ||
    bound.unmappedFacts.length ||
    bound.missing.length ||
    bound.unsupported
  )
    throw Error("CUSTOMER_CASE_REQUIRES_EXPLICIT_FOLLOWUP_OR_MAPPING");
  if (expectedSourceNumbers(row, bound).some((n) => !n.pass))
    throw Error("CUSTOMER_CASE_ORACLE_DISAGREEMENT");
  if (/timeout|outage|rate_limit|schema|markup|kill_switch|quota/.test(row.category))
    throw Error("CUSTOMER_CONTROL_CASE_REQUIRES_BOUNDARY_RUNNER");
  const sourceHash = createHash("sha256").update(bytes).digest("hex"),
    caseHash = requestDigest(row);
  const key = `customer:${caseId}:1`;
  const work: FiniteWork = {
    key,
    lane: "customer",
    role: "customer",
    pair: null,
    candidateHash: caseHash,
    caseHash,
    sourceHashes: [sourceHash],
    request: customerCompletionRequest(customerProviderPayload(bound.input)),
    bindings: {
      candidateVersionId: null,
      corpus: "customer-ai",
      caseId,
      sourceFiles: [{ path, sha256: sourceHash }],
    },
  };
  const manifest: FiniteManifest = {
    version: 2,
    policyVersion: inferenceProposal.priceVersion,
    preparedAt: (options.now ?? new Date()).toISOString(),
    allocation: { ...additionalInferenceAllocation },
    ...(options.packageId ? { packageId: options.packageId } : {}),
    works: [
      work,
      ...(options.retry ? [{ ...structuredClone(work), key: `customer:${caseId}:2`, retryOf: key }] : []),
    ],
  };
  return { manifest, input: bound.input, caseId, caseHash, originalInputHash: bound.inputHash };
}

/** The real organizer selects attempt two separately. This runner cannot send
 * arbitrary input or reuse attempt one's invalid response as a schema retry. */
export async function executeApprovedCustomerManifest(batchId: string, manifest: FiniteManifest) {
  const primary = manifest.works.find((w) => !w.retryOf);
  if (
    !primary ||
    manifest.works.length > 2 ||
    manifest.works.some((w) => w.lane !== "customer") ||
    manifest.works.filter((w) => !w.retryOf).length !== 1 ||
    !primary.bindings.caseId
  )
    throw Error("CUSTOMER_RUNNER_SCOPE_INVALID");
  const prepared = await prepareCustomerFiniteManifest(primary.bindings.caseId, {
    retry: manifest.works.length === 2,
    now: new Date(manifest.preparedAt),
    packageId: manifest.packageId,
  });
  if (requestDigest(prepared.manifest) !== requestDigest(manifest))
    throw Error("CUSTOMER_RUNNER_MANIFEST_CHANGED");
  // The operator cannot mint an identity or silently bypass ordinary persisted
  // customer limits. Default execution uses the already retained evaluation
  // workspace. A caller cannot supply a replacement workspace or mint identity.
  const { pool } = await import("@workspace/db");
  const actor = (
    await pool.query(`SELECT workspace_id AS "workspaceId",actor_id AS "identityId"
    FROM valo_ai_drafts WHERE actor_id LIKE 'valo-ai-eval-invoice-%' ORDER BY created_at,id LIMIT 1`)
  ).rows[0];
  if (!actor) throw Error("EXISTING_AUTHORIZED_CUSTOMER_EVALUATION_WORKSPACE_REQUIRED");
  const { createCustomerAIDraft } = await import("./valo-customer-ai");
  const result = await withApprovedInferenceWork(batchId, primary.key, () =>
    createCustomerAIDraft(actor!, {
      ...prepared.input,
      idempotencyKey: caseUUID(`${batchId}:${primary.key}`),
    }),
  );
  return {
    caseId: prepared.caseId,
    caseHash: prepared.caseHash,
    originalInputHash: prepared.originalInputHash,
    result,
    providerQualityAccepted: false,
    originalOracleChanged: false,
    authoringFunded: false,
  };
}
