import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { asc, and, eq, like } from "drizzle-orm";
import { db, pool, valoAIDrafts } from "@workspace/db";
import {
  bindCustomerCase,
  caseUUID,
  expectedSourceNumbers,
  explicitBoundaryFollowup,
  type AuthoredCustomerCase,
} from "../lib/valo-customer-case-binding";
import {
  hashAI,
  customerPromptVersion,
  customerNoticeVersion,
  customerProviderPayload,
} from "../lib/valo-customer-ai-domain";
import { organizeCustomerDraft, type CustomerTransport } from "../lib/valo-customer-ai-model";
import { createCustomerAIDraft, customerAIUsage, getCustomerAIDraft } from "../lib/valo-customer-ai";
import { sha256 } from "@workspace/valo-core";
import { workspaceActorFromRecord } from "../platform/workspace-context";
type NativeRecord = {
  caseID: string;
  caseHash: string;
  mappedInputHash: string;
  followup: { values: Record<string, string> };
  status: string;
  targetBoundaryReached: boolean;
  actualOutboundCalls: number;
};
type NativeReceipt = {
  executedAt: string;
  records: NativeRecord[];
  codeHashes: Record<string, string>;
  actualOutboundCalls: number;
  cleanupSucceeded: boolean;
  realProviderHistoryPreserved: boolean;
  identitiesCreated: number;
  quotaLimitsChanged: boolean;
};
const faultKinds: Record<string, string> = {
  invalid_schema_twice: "invalid_twice",
  provider_timeout: "timeout",
  unsafe_provider_markup: "markup",
  provider_rate_limit: "rate_limit",
  invalid_schema_then_recovery: "retry_success",
  provider_outage_preserves_work: "unavailable",
};
async function main() {
  assert.equal(process.env.NODE_ENV, "development");
  assert.ok(!process.env.REPLIT_DEPLOYMENT);
  const root = resolve(import.meta.dirname, "../../../.."),
    dir = resolve(root, "generated-artifacts/valo-completion/customer-source60");
  await mkdir(dir, { recursive: true });
  const bytes = await readFile(resolve(root, "docs/evaluation-candidates/customer-ai.json")),
    corpus = JSON.parse(bytes.toString()) as { cases: AuthoredCustomerCase[] };
  assert.equal(corpus.cases.length, 60);
  assert.equal(new Set(corpus.cases.map((c) => c.caseID)).size, 60);
  const selected = (process.env.VALO_SOURCE_AI_CASES ?? "").split(",").filter(Boolean);
  assert.ok(
    selected.every((id) => corpus.cases.some((c) => c.caseID === id)),
    "Unknown source case ID",
  );
  const live = process.env.VALO_SOURCE_AI_PROVIDER === "existing-authorized-evaluation-only";
  const [actor] = live
    ? await db
        .select({ workspaceId: valoAIDrafts.workspaceId, identityId: valoAIDrafts.actorId })
        .from(valoAIDrafts)
        .where(like(valoAIDrafts.actorId, "valo-ai-eval-invoice-%"))
        .orderBy(asc(valoAIDrafts.createdAt))
        .limit(1)
    : [];
  const usage = actor ? await customerAIUsage(workspaceActorFromRecord(actor)) : null;
  let native: NativeReceipt | null = null,
    nativeReceiptHash: string | null = null;
  if (process.env.VALO_SOURCE_AI_NATIVE_RESULTS) {
    const path = resolve(root, process.env.VALO_SOURCE_AI_NATIVE_RESULTS);
    assert.ok(
      path.startsWith(root + "/docs/valo/evidence/") ||
        path.startsWith(root + "/generated-artifacts/valo-completion/"),
    );
    const retained = await readFile(path);
    native = JSON.parse(retained.toString()) as NativeReceipt;
    const age = Date.now() - Date.parse(native.executedAt);
    assert.ok(
      age >= 0 &&
        age <= 24 * 60 * 60 * 1000 &&
        native.cleanupSucceeded &&
        native.realProviderHistoryPreserved,
    );
    assert.equal(native.actualOutboundCalls, 0);
    assert.equal(native.identitiesCreated, 0);
    assert.equal(native.quotaLimitsChanged, false);
    const expected = [
      "artifacts/api-server/src/lib/valo-customer-ai.ts",
      "artifacts/api-server/src/lib/valo-customer-ai-domain.ts",
      "artifacts/api-server/src/lib/valo-customer-case-binding.ts",
      "artifacts/api-server/src/scripts/customer-native-boundaries.ts",
    ];
    assert.deepEqual(Object.keys(native.codeHashes).sort(), expected.sort());
    for (const path of expected)
      assert.equal(
        sha256(await readFile(resolve(root, path))),
        native.codeHashes[path],
        "Native receipt code binding changed",
      );
    nativeReceiptHash = sha256(retained);
  }
  const results: Record<string, unknown>[] = [];
  for (const c of corpus.cases) {
    try {
      const original = bindCustomerCase(c),
        fault = faultKinds[c.category];
      const observed = native?.records.find((r) => r.caseID === c.caseID);
      const followup: Record<string, string> = observed
        ? { ...observed.followup.values }
        : fault || selected.includes(c.caseID)
          ? explicitBoundaryFollowup(c)
          : {};
      // Keep supplied references/dates; follow-ups fill missing values only.
      for (const k of Object.keys(followup))
        if (original.input?.[k as "issueDate" | "dueDate" | "documentNumber"])
          delete (followup as Record<string, string>)[k];
      const adapted = bindCustomerCase(c, followup),
        numbers = expectedSourceNumbers(c, adapted);
      const record: Record<string, unknown> = {
        caseID: c.caseID,
        category: c.category,
        caseHash: hashAI(c),
        originalInputHash: original.inputHash,
        originalPreflight: {
          issues: original.issues,
          missing: original.missing,
          unsupported: original.unsupported,
        },
        followup: adapted.followup,
        mappedInputHash: adapted.inputHash,
        unmappedFacts: adapted.unmappedFacts,
        excludedFacts: adapted.excludedFacts,
        numericChecks: numbers,
        status: "blocked",
        reason: "real_provider_case_not_selected",
        providerQualityPassed: false,
        routineLogPrivacyInspected: false,
        actualProviderAttempts: 0,
      };
      results.push(record);
      if (adapted.issues.length || adapted.unmappedFacts.length) {
        record.reason = "mapping_or_semantic_boundary_unresolved";
        record.issues = adapted.issues;
        continue;
      }
      if (numbers.some((n) => !n.pass)) {
        record.status = "fail";
        record.reason = "original_numeric_oracle_mismatch";
        continue;
      }
      const input = adapted.input;
      if (!input || adapted.missing.length) {
        record.reason = "missing_information";
        continue;
      }
      if (adapted.unsupported) {
        record.reason = "unsupported_input_preflight";
        record.safetyBoundaryReached = true;
        continue;
      }
      if (observed) {
        assert.ok(["CAI-CAND-QUO-14", "CAI-CAND-REM-15"].includes(c.caseID));
        assert.equal(observed.caseHash, hashAI(c));
        assert.equal(observed.mappedInputHash, adapted.inputHash);
        assert.equal(observed.status, "control_pass");
        assert.equal(observed.targetBoundaryReached, true);
        assert.equal(observed.actualOutboundCalls, 0);
        record.status = "control_pass";
        record.reason = "retained_actual_database_boundary_not_provider_quality";
        record.nativeReceiptHash = nativeReceiptHash;
        record.nativeExecutedAt = native!.executedAt;
        record.targetBoundaryReached = true;
        continue;
      }
      if (fault) {
        let calls = 0;
        const payloads: unknown[] = [];
        const transport: CustomerTransport = async (payload, onOutbound) => {
          payloads.push(payload);
          calls++;
          onOutbound();
          if (fault === "timeout") {
            const e = new Error("Controlled timeout");
            e.name = "TimeoutError";
            throw e;
          }
          if (fault === "unavailable") throw Error("Controlled provider unavailable");
          if (fault === "rate_limit")
            throw Object.assign(Error("Controlled provider rate limit"), { status: 429 });
          const indexes = input.contextLines.map((_, i) => i),
            sections = [];
          for (let i = 0; i < indexes.length; i += 6)
            sections.push({ heading: "notes", lineIndexes: indexes.slice(i, i + 6) });
          return {
            id: `controlled-${c.caseID}-${calls}`,
            model: "controlled-not-a-real-provider",
            choices: [
              {
                message: {
                  content:
                    fault === "retry_success" && calls === 2
                      ? JSON.stringify({ opening: "none", sections })
                      : fault === "markup"
                        ? "<script>unsafe()</script>"
                        : "{}",
                },
              },
            ],
          };
        };
        const result = await organizeCustomerDraft(input, transport);
        const expectedCalls = ["invalid_twice", "markup", "retry_success"].includes(fault) ? 2 : 1;
        assert.equal(calls, expectedCalls);
        assert.equal(result.runs.length, expectedCalls);
        assert.equal(Boolean(result.plan), fault === "retry_success");
        assert.ok(result.runs.every((r) => r.outboundAttempted));
        assert.deepEqual(
          payloads,
          payloads.map(() => customerProviderPayload(input)),
        );
        const sent = JSON.stringify(payloads);
        for (const identifier of [input.issuerName, input.recipientName, input.documentNumber].filter(
          Boolean,
        ))
          assert.ok(!sent.includes(identifier));
        record.status = "control_pass";
        record.reason = "intended_adapter_boundary_reached_after_declared_followup";
        record.control = {
          injected: true,
          realProvider: false,
          boundary: "organizeCustomerDraft transport and schema/retry handler",
          calls,
          failureCode: result.failureCode,
          providerInputHash: result.providerInputHash,
          outboundPayloadInspected: true,
        };
        continue;
      }
      if (!live || !selected.includes(c.caseID)) continue;
      if (!actor) {
        record.reason = "existing_evaluation_identity_unavailable";
        continue;
      }
      input.idempotencyKey = caseUUID({
        case: hashAI(c),
        followup: adapted.followup.hash,
        prompt: customerPromptVersion,
        notice: customerNoticeVersion,
      });
      const { idempotencyKey: _key, ...facts } = input,
        ih = hashAI(facts);
      const [old] = await db
        .select()
        .from(valoAIDrafts)
        .where(
          and(
            eq(valoAIDrafts.workspaceId, actor.workspaceId),
            eq(valoAIDrafts.inputHash, ih),
            eq(valoAIDrafts.promptVersion, `${customerPromptVersion}/${customerNoticeVersion}`),
          ),
        )
        .orderBy(asc(valoAIDrafts.createdAt))
        .limit(1);
      const reusable =
        old &&
        old.status === "ready" &&
        Date.now() - old.createdAt.getTime() < 86400000 &&
        old.providerInputHash === hashAI(customerProviderPayload(input));
      if (!reusable && process.env.VALO_SOURCE_AI_REUSE_ONLY === "true") {
        record.reason = "exact_fresh_reuse_unavailable_no_provider_call_allowed";
        continue;
      }
      const preview = reusable
        ? await getCustomerAIDraft(workspaceActorFromRecord(actor), old.id)
        : await createCustomerAIDraft(workspaceActorFromRecord(actor), input);
      const [row] = await db
        .select()
        .from(valoAIDrafts)
        .where(and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.id, preview.id)));
      assert.ok(row);
      const runs = row.providerRuns as {
        outboundAttempted: boolean;
        responseId: string | null;
        usage: unknown;
        model: string | null;
      }[];
      record.previewId = preview.id;
      record.previewStatus = preview.status;
      record.providerRuns = runs;
      record.reusedExactFreshResult = Boolean(reusable);
      record.actualProviderAttempts = reusable ? 0 : runs.filter((r) => r.outboundAttempted).length;
      if (preview.status !== "ready") {
        record.reason = "application_preflight_quota_or_provider_hold";
        continue;
      }
      assert.deepEqual(preview.content.financialInput, input.financialInput);
      assert.equal(preview.content.fields.issuerName, input.issuerName);
      assert.equal(preview.content.fields.recipientName, input.recipientName);
      assert.ok(runs.some((r) => r.outboundAttempted && r.responseId && r.model && r.usage));
      if (c.caseID === "CAI-CAND-QUO-01") {
        assert.equal(preview.content.fields.issueDate, followup.issueDate);
        assert.equal(input.financialInput.taxAmountKobo, null);
        assert.equal(input.financialInput.deliveryKobo, undefined);
        assert.ok(input.contextLines.includes("Delivery date unconfirmed."));
        const rows = preview.content.blocks.flatMap((b) => b.rows);
        assert.ok(rows.some((r) => r[0] === "Subtotal" && r[1] === "₦27,000.00"));
        record.status = "provider_generation_pass_with_declared_synthetic_followup";
        record.providerQualityPassed = true;
        record.reason = "unchanged_complete_scope_rubric_checked_after_explicit_followup";
        record.routineLogPrivacyInspected = false;
        continue;
      }
      // A real completion is retained, but omitted rubric/log checks cannot become a full acceptance pass.
      record.status = "partial_provider_evidence";
      record.reason = "provider_generation_and_numbers_observed_full_rubric_and_log_review_pending";
    } catch (e) {
      results.push({
        caseID: c.caseID,
        status: "runner_failure",
        reason:
          e instanceof assert.AssertionError
            ? e.message.split("\n")[0]
            : "Binding or operation failed; no boundary/provider success inferred",
        providerQualityPassed: false,
      });
    }
  }
  // A case with an error replaces, rather than inflates, its original record.
  const unique = [...new Map(results.map((r) => [r.caseID, r])).values()];
  assert.equal(unique.length, 60);
  const report = {
    suite: "actual-authored-customer60",
    version: "source-runner-v2",
    executedAt: new Date().toISOString(),
    corpusHash: hashAI(JSON.parse(bytes.toString())),
    cases: 60,
    results: unique,
    usageBefore: usage,
    identitiesCreated: 0,
    quotasChanged: false,
    providerMode: live,
    actualBilling: null,
    authoredAsWrittenGenerationPasses: unique.filter((r) => r.providerQualityPassed === true && !r.followup)
      .length,
    providerGenerationWithDeclaredFollowupPasses: unique.filter(
      (r) => r.providerQualityPassed === true && r.followup,
    ).length,
    partialProviderEvidence: unique.filter((r) => r.status === "partial_provider_evidence").length,
    controlledBoundaryPasses: unique.filter((r) => r.status === "control_pass").length,
    blocked: unique.filter((r) => r.status === "blocked").length,
    failed: unique.filter((r) => r.status === "fail").length,
    formalAcceptance: false,
    AI008Accepted: false,
  };
  await writeFile(resolve(dir, "results.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(
    JSON.stringify({
      cases: 60,
      controls: report.controlledBoundaryPasses,
      blocked: report.blocked,
      failed: report.failed,
      authoredAsWrittenGenerationPasses: report.authoredAsWrittenGenerationPasses,
      providerGenerationWithDeclaredFollowupPasses: report.providerGenerationWithDeclaredFollowupPasses,
      partialProviderEvidence: report.partialProviderEvidence,
      formalAcceptance: false,
    }),
  );
  if (report.failed) process.exitCode = 1;
}
try {
  await main();
} catch {
  console.error("Customer source suite stopped; no success inferred.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
