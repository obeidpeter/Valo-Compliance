import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { db, pool, valoContentVersions } from "@workspace/db";
import {
  candidateDigest,
  digest,
  evaluatePublication,
  publicationSchema,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import {
  readTemplateIntake,
  templateCandidate,
  candidateArithmetic,
  assertPermissionRoute,
  getPublicationArtifact,
  type ArtifactRef,
  assertBlindReviewInputs,
  inspectOperationalExports,
} from "../modules/publication";
import { assertPublicAddress, assertSourceUrl, referenceFor, instrumentIdentity } from "../modules/sources";
import { renderDocument } from "../lib/valo-render";
import {
  dispatchEditorialExternalAction,
  evaluateEditorialPermissionDenials,
  dispatchEditorialLifecycle,
  reviewedBaselineEvidence,
  publicationHoldTransition,
  editorialDeniedActions,
  EditorialExternalActionDenied,
  verifyCurrentEditorialDenials,
  type EditorialDenialReceipt,
  type EditorialDenialAuditRow,
  FalseEligibilityError,
  scoreEditorialEvaluation,
  isTemplateEvaluationCase,
  templateCaseOutcome,
  templateEvaluationCases,
  editorialCaseOutcome,
  isPreparableEditorialCase,
} from "../modules/editorial";
type Case = { id: string; scenario: string; inputMutation: string; requiresProviderRun: boolean };
class Blocked extends Error {}
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const root = resolve(import.meta.dirname, "../../../.."),
    out = resolve(root, "generated-artifacts/valo-completion/editorial-source60");
  await mkdir(out, { recursive: true });
  const bytes = await readFile(resolve(root, "docs/evaluation-candidates/editorial.json"));
  const corpus = JSON.parse(bytes.toString()) as { cases: Case[] };
  assert.equal(corpus.cases.length, 60);
  const args = process.argv.slice(2);
  assert.ok(
    args.length <= 1 && (!args.length || args[0]!.startsWith("--cases=")),
    "UNSUPPORTED_EDITORIAL_ARGUMENT",
  );
  const selected = args.length ? args[0]!.slice("--cases=".length).split(",") : null;
  assert.ok(
    !selected || selected.every((id) => corpus.cases.some((c) => c.id === id)),
    "UNKNOWN_EDITORIAL_CASE",
  );
  const evaluationRunId = randomUUID();
  const [row] = await db
    .select()
    .from(valoContentVersions)
    .orderBy(desc(valoContentVersions.createdAt))
    .limit(1);
  const parsed = row ? publicationSchema.safeParse(row.bundle) : null;
  const original = parsed?.success ? parsed.data : null;
  const results: Record<string, unknown>[] = [];
  const need = () => {
    if (!original) throw new Blocked("retained_candidate_bundle_unavailable");
    return structuredClone(original);
  };
  const needReviewed = async () => {
    // These independence controls bind the retained v5 receipts, never a newer draft.
    for (const version of [5]) {
      const sourcePath = `docs/valo/evidence/operational-publication-v${version}.json`;
      const bytes = await readFile(resolve(root, sourcePath));
      const saved = JSON.parse(bytes.toString()) as { id: string; candidateHash: string };
      const [retained] = await db
        .select()
        .from(valoContentVersions)
        .where(eq(valoContentVersions.id, saved.id));
      if (!retained || retained.candidateHash !== saved.candidateHash) continue;
      const b = publicationSchema.parse(retained.bundle);
      if (
        candidateDigest(b.candidate) !== saved.candidateHash ||
        !b.candidate.reviewBy ||
        Date.parse(b.candidate.reviewBy) <= Date.now() ||
        b.reviews.length !== 2
      )
        continue;
      const a = retained.attestations as {
        reviews: ArtifactRef[];
        provenance: ArtifactRef;
        rights: ArtifactRef;
        exportReport: ArtifactRef;
      };
      if (a.reviews.length !== 2) continue;
      const ids = new Set<string>();
      let boundAll = true;
      for (const ref of a.reviews) {
        const receipt = JSON.parse((await getPublicationArtifact(ref)).toString());
        const linked = b.reviews.find((r) => r.role === receipt.role),
          e = receipt.serverEvidence;
        if (
          !linked ||
          !e ||
          !receipt.model ||
          receipt.receivedOtherVerdict ||
          receipt.providerResponseId !== linked.runId ||
          receipt.model !== linked.model ||
          receipt.candidateHash !== saved.candidateHash ||
          receipt.output?.verdict !== linked.verdict ||
          digest(receipt.output?.findings ?? null) !== digest(linked.findings) ||
          e.candidateHash !== saved.candidateHash ||
          e.sourceCheckedAt !== b.candidate.sourceCheckDate ||
          e.provenanceArtifactHash !== a.provenance.hash ||
          e.rightsArtifactHash !== a.rights.hash ||
          e.exportReportArtifactHash !== a.exportReport.hash
        ) {
          boundAll = false;
          break;
        }
        ids.add(receipt.providerResponseId);
      }
      if (!boundAll || ids.size !== 2) continue;
      return reviewedBaselineEvidence(retained, bytes, sourcePath);
    }
    throw new Blocked("exact_fresh_retained_independent_review_binding_unavailable");
  };
  const hold = (b: PublicationBundle, pattern: RegExp) => {
    const result = evaluatePublication(b);
    // An adverse change the gate still finds eligible is a critical false publication (EDP-010).
    if (result.decision !== "hold") throw new FalseEligibilityError();
    assert.ok(
      result.reasons.some((r) => pattern.test(r)),
      `Target boundary absent: ${pattern.source}`,
    );
    return {
      decision: result.decision,
      targetReasons: result.reasons.filter((r) => pattern.test(r)),
      mutatedCandidateHash: candidateDigest(b.candidate),
      bundleHash: digest(b),
      originalBaselineEligible: original ? evaluatePublication(original).decision === "eligible" : false,
    };
  };
  for (const c of corpus.cases) {
    const selectsReviewedBaseline = ["EVAL-EDP-C038", "EVAL-EDP-C039"].includes(c.id);
    const record: Record<string, unknown> = {
      caseID: c.id,
      caseHash: digest(c),
      scenario: c.scenario,
      requiresProviderRun: c.requiresProviderRun,
      status: "blocked",
      actualProviderCalls: 0,
      baselineId: selectsReviewedBaseline ? null : (row?.id ?? null),
      baselineBundleHash: selectsReviewedBaseline ? null : original ? digest(original) : null,
      expectedBaselineVersion: selectsReviewedBaseline ? 5 : null,
      originalCaseMutation: c.inputMutation,
      formalCaseAccepted: false,
    };
    results.push(record);
    if (selected && !selected.includes(c.id)) {
      record.status = "not_selected";
      record.reason = "not_executed_in_this_selection";
      continue;
    }
    // C001-C003 run as their templates' own review pairs (decision 0014); the outcome is read from
    // the template's saved versions. This suite makes no provider call for them.
    if (isTemplateEvaluationCase(c.id)) {
      const versions = await db
        .select()
        .from(valoContentVersions)
        .where(eq(valoContentVersions.templateId, templateEvaluationCases[c.id]));
      Object.assign(record, templateCaseOutcome(c.id, versions), { formalCaseAccepted: false });
      continue;
    }
    // The case-bound cases with a prepared review pair read that pair's reviews from the ledger
    // (decision 0015, point 4); this suite makes no provider call for them either.
    if (isPreparableEditorialCase(c.id)) {
      const batches = await pool.query(
        `SELECT id, manifest, results FROM valo_inference_batches
         WHERE manifest->'works'->0->'bindings'->>'caseId' = $1`,
        [c.id],
      );
      Object.assign(record, editorialCaseOutcome(c.id, batches.rows), { formalCaseAccepted: false });
      continue;
    }
    if (c.requiresProviderRun) {
      record.reason = "genuine_case_bound_provider_roles_sources_rights_and_exports_required";
      continue;
    }
    try {
      let observations: unknown;
      switch (c.id) {
        case "EVAL-EDP-C009": {
          const b = need();
          b.rights.status = "unknown";
          observations = hold(b, /rights/);
          break;
        }
        case "EVAL-EDP-C010": {
          assert.throws(
            () => assertPermissionRoute({ integration: "unrelated_account_endpoint" }, false),
            /AUTHORING_RIGHTS_ROUTE_MISMATCH/,
          );
          observations = {
            boundary: "assertPermissionRoute",
            mutation: { integration: "unrelated_account_endpoint" },
            rejected: true,
          };
          break;
        }
        case "EVAL-EDP-C012": {
          const b = need();
          b.candidate.evidenceMode = "regulatory";
          b.candidate.legalScopeStatus = "verified";
          b.sources = [];
          observations = hold(b, /source|evidence/);
          break;
        }
        case "EVAL-EDP-C014": {
          const actual = instrumentIdentity(
            "SV-010",
            "An unrelated controlled document, not CAMA.",
            "Companies and Allied Matters Act 2020",
          );
          assert.equal(actual?.status, "held_title_unconfirmed");
          observations = {
            boundary: "instrumentIdentity",
            claimed: "CAMA 2020",
            actualBodyHash: sha256("An unrelated controlled document, not CAMA."),
            actual,
          };
          break;
        }
        case "EVAL-EDP-C016": {
          const b = need();
          b.candidate.claims.push({
            text: "Controlled unresolved citation",
            kind: "source_statement",
            sourceId: "NONEXISTENT-SNAPSHOT-C016",
            quote: "No retained operative source",
            locator: "section 814",
            numbers: [],
          });
          observations = hold(b, /unsupported_claim|source/);
          break;
        }
        case "EVAL-EDP-C037": {
          let rejected = 0;
          for (const url of ["http://169.254.169.254/latest/meta-data/", "https://unapproved.invalid/"]) {
            assert.throws(() => assertSourceUrl(referenceFor("S01").url, url), /SOURCE_/);
            rejected++;
          }
          assert.throws(() => assertPublicAddress("127.0.0.1"), /SOURCE_NON_PUBLIC_ADDRESS/);
          observations = {
            boundary: "source URL and pinned-address guards before HTTP",
            rejected: rejected + 1,
            forbiddenNetworkCalls: 0,
          };
          break;
        }
        case "EVAL-EDP-C038": {
          assert.throws(
            () =>
              assertBlindReviewInputs({
                otherReview: { verdict: "pass", reason: "Leaked challenge verdict" },
              }),
            /REVIEW_INPUT_CONTAINS_OTHER_VERDICT/,
          );
          const retained = await needReviewed();
          Object.assign(record, retained.evidence);
          observations = {
            ...retained.evidence,
            ...publicationHoldTransition(
              retained.bundle,
              (b) => {
                b.reviews[0]!.receivedOtherVerdict = true;
              },
              /review_not_blind/,
            ),
          };
          break;
        }
        case "EVAL-EDP-C039": {
          const retained = await needReviewed();
          Object.assign(record, retained.evidence);
          observations = {
            ...retained.evidence,
            ...publicationHoldTransition(
              retained.bundle,
              (b) => {
                b.reviews[0]!.runId = b.draftRun.runId;
              },
              /runs_not_separate/,
            ),
          };
          break;
        }
        case "EVAL-EDP-C042": {
          const b = need();
          const check = b.mechanicalChecks.find((x) => x.name === "arithmetic");
          if (!check) throw new Blocked("actual_arithmetic_check_unavailable");
          check.result = "fail";
          observations = hold(b, /check_not_passed:arithmetic/);
          record.targetControl = observations;
          if (
            !b.reviews.some((r) => r.role === "factual") ||
            !b.reviews.some((r) => r.role === "challenge") ||
            b.reviews.some((r) => r.verdict !== "pass" || r.findings.length)
          )
            throw new Blocked("target_failure_observed_but_genuine_passing_review_prerequisite_missing");
          break;
        }
        case "EVAL-EDP-C043": {
          const pairs = [];
          for (const id of ["TPL-06", "TPL-07"]) {
            const intake = await readTemplateIntake(id),
              base = need().candidate;
            base.id = id;
            base.body = JSON.stringify(intake.document);
            base.hash = candidateDigest(base);
            const before = candidateArithmetic(base);
            assert.equal(before.pass, true);
            const text = id === "TPL-07" ? "received − issued" : "A − B − C";
            assert.ok(base.body.includes(text), "Exact target expression absent");
            base.body = base.body.replace(text, id === "TPL-07" ? "received + issued" : "A + B − C");
            base.hash = candidateDigest(base);
            const after = candidateArithmetic(base);
            assert.equal(after.pass, false);
            pairs.push({ id, sourceHash: intake.sourceHash, before, after });
          }
          observations = { boundary: "actual candidate expression parser and evaluator", pairs };
          break;
        }
        case "EVAL-EDP-C045": {
          const b = need();
          Reflect.set(b.candidate, "disclosure", "Lawyer-approved. Guaranteed compliant.");
          observations = hold(b, /schema:candidate.disclosure/);
          break;
        }
        case "EVAL-EDP-C051": {
          if (!row) throw new Blocked("retained_artifact_reference_missing");
          const a = row.attestations as { provenance?: ArtifactRef };
          if (!a.provenance) throw new Blocked("retained_artifact_reference_missing");
          let rejected = false;
          try {
            await getPublicationArtifact({ ...a.provenance, hash: "0".repeat(64) });
          } catch {
            rejected = true;
          }
          assert.equal(rejected, true);
          observations = {
            boundary: "trusted artifact retrieval hash check",
            forgedHash: "0".repeat(64),
            rejected,
            publicationInvoked: false,
          };
          break;
        }
        case "EVAL-EDP-C053":
        case "EVAL-EDP-C054": {
          const statement =
            c.id === "EVAL-EDP-C053"
              ? sql`SELECT id FROM valo_documents LIMIT 0`
              : sql`UPDATE valo_orders SET status=status WHERE FALSE`;
          let denied = false;
          try {
            await db.transaction(async (tx) => {
              await tx.execute(sql`SET LOCAL ROLE valo_content_publisher_dev`);
              await tx.execute(statement);
            });
          } catch (e) {
            let p: unknown = e;
            for (let i = 0; i < 4 && p; i++) {
              const x = p as { code?: string; cause?: unknown };
              if (x.code === "42501") denied = true;
              p = x.cause;
            }
          }
          assert.equal(denied, true, "Expected native PostgreSQL privilege denial, not an unrelated failure");
          observations = {
            boundary: "actual bounded publisher PostgreSQL role",
            permissionDeniedSQLState: "42501",
            privateRowsRead: 0,
            financialRowsChanged: 0,
            externalActions: 0,
          };
          if (c.id === "EVAL-EDP-C054") {
            if (!row) throw new Blocked("retained_candidate_needed_for_durable_action_denial");
            const before = await db.execute(sql`SELECT id FROM valo_publication_audit
              WHERE version_id=${row.id}::uuid AND action='external_action_denied'`);
            const previousIds = (before.rows as { id: string }[]).map((r) => r.id);
            const receipts: EditorialDenialReceipt[] = [];
            for (const action of editorialDeniedActions) {
              try {
                await dispatchEditorialExternalAction(row.id, action, evaluationRunId);
              } catch (error) {
                if (!(error instanceof EditorialExternalActionDenied)) throw error;
                assert.equal(error.denial.requestedAction, action);
                receipts.push(error.denial);
              }
            }
            assert.equal(receipts.length, 3, "Expected three committed current-run denial receipts");
            const logged =
              await db.execute(sql`SELECT id,version_id,action,actor,reason FROM valo_publication_audit
              WHERE id IN (${sql.join(
                receipts.map((r) => sql`${r.auditId}::uuid`),
                sql`, `,
              )})`);
            const denials = verifyCurrentEditorialDenials(
              row.id,
              evaluationRunId,
              receipts,
              logged.rows as EditorialDenialAuditRow[],
              previousIds,
            );
            observations = {
              ...(observations as object),
              evaluationRunId,
              denials,
              preexistingDenialCount: previousIds.length,
              newDenialIds: denials.map((r) => r.auditId),
              filingDispatch: "denied_and_durably_logged",
              externalCalls: 0,
            };
          }
          break;
        }
        case "EVAL-EDP-C046":
        case "EVAL-EDP-C047":
        case "EVAL-EDP-C048":
        case "EVAL-EDP-C049":
        case "EVAL-EDP-C050":
        case "EVAL-EDP-C055":
        case "EVAL-EDP-C056":
        case "EVAL-EDP-C057":
        case "EVAL-EDP-C058":
        case "EVAL-EDP-C059": {
          const lifecycle = await dispatchEditorialLifecycle(c.id, evaluationRunId);
          Object.assign(record, lifecycle);
          if (lifecycle.status === "blocked")
            throw new Blocked(lifecycle.reason ?? "GENUINE_LIFECYCLE_PREREQUISITE_MISSING");
          if (lifecycle.status !== "control_pass") throw Error("LIFECYCLE_TARGET_CONTROL_FAILED");
          observations = lifecycle.boundaryEvidence;
          break;
        }
        case "EVAL-EDP-C044": {
          const intake = await readTemplateIntake("TPL-07", 1),
            content = await templateCandidate("TPL-07", 1, new Date(), {
              original: intake.section.body,
              provenance: intake.provenance,
            });
          const candidate = need().candidate;
          candidate.id = "TPL-07";
          candidate.body = JSON.stringify(content.document);
          candidate.scope = content.scope;
          candidate.limitations = content.limitations;
          candidate.sourceCheckDate = content.reviewedAt;
          candidate.disclosure =
            "AI drafted and reviewed; not reviewed by a Nigerian legal, tax or sector specialist";
          candidate.hash = candidateDigest(candidate);
          const altered = structuredClone(content.document);
          altered.content.blocks = altered.content.blocks.filter((b) => b.id !== "release-limitations");
          assert.ok(altered.content.blocks.length < content.document.content.blocks.length);
          const files = {
            docx: await renderDocument(content.document, "docx", 1, "template_sample"),
            pdf: await renderDocument(altered, "pdf", 1, "template_sample"),
          };
          const inspection = await inspectOperationalExports(candidate, files);
          assert.equal(inspection.passed, false);
          assert.equal(inspection.formats.docx.completeContent, true);
          assert.equal(inspection.formats.pdf.limitationsIncluded, false);
          observations = {
            boundary: "actual DOCX/Chromium PDF reader comparison",
            candidateHash: candidate.hash,
            sourceHash: intake.sourceHash,
            inspection,
          };
          break;
        }
        case "EVAL-EDP-C052": {
          if (!row) throw new Blocked("retained_candidate_needed_for_durable_role_denial");
          observations = await evaluateEditorialPermissionDenials(row.id, evaluationRunId);
          break;
        }
        default:
          throw new Blocked("exact_case_boundary_not_implemented");
      }
      record.status = "control_pass";
      record.boundaryEvidence = observations;
      record.formalCaseAccepted = false;
      record.scope =
        "Executed negative engineering control, not provider review or legal-accuracy acceptance";
    } catch (e) {
      record.status = e instanceof Blocked ? "blocked" : "fail";
      if (e instanceof FalseEligibilityError) record.criticalFalsePublication = true;
      record.reason =
        e instanceof Blocked || e instanceof FalseEligibilityError
          ? e.message
          : e instanceof assert.AssertionError
            ? e.message.split("\n")[0]
            : "Control failed; no target success inferred";
    }
  }
  const report = {
    suite: "authored-editorial60",
    evaluationRunId,
    corpusHash: sha256(bytes),
    executedAt: new Date().toISOString(),
    results,
    candidateCases: 60,
    deterministicCases: results.filter((r) => !r.requiresProviderRun).length,
    providerRequiredCases: results.filter((r) => r.requiresProviderRun).length,
    controlsPassed: results.filter((r) => r.status === "control_pass").length,
    failed: results.filter((r) => r.status === "fail").length,
    selectedCases: selected ?? corpus.cases.map((c) => c.id),
    notSelected: results.filter((r) => r.status === "not_selected").length,
    blocked: results.filter((r) => r.status === "blocked").length,
    providerCalls: 0,
    publications: 0,
    // Measured against EDP-010's bar; a blocked or unrun case has not passed.
    score: scoreEditorialEvaluation(
      corpus.cases.map((x) => x.id),
      results as { caseID: string; status: string; criticalFalsePublication?: boolean }[],
    ),
    formalAcceptance: false,
    EDP010Accepted: false,
  };
  assert.equal(report.deterministicCases, 26);
  assert.equal(report.providerRequiredCases, 34);
  const reportPath = resolve(out, `results-${evaluationRunId}.json`);
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  if (!selected) await writeFile(resolve(out, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      controlsPassed: report.controlsPassed,
      failed: report.failed,
      blocked: report.blocked,
      notSelected: report.notSelected,
      reportPath,
      deterministicCases: 26,
      providerRequiredCases: 34,
      formalAcceptance: false,
    }),
  );
  if (report.failed) process.exitCode = 1;
}
try {
  await main();
} catch {
  console.error("Editorial source runner stopped; no success inferred.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
