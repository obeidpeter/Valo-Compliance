import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { financialBlocks, percentageKobo, recordedBalance } from "@workspace/valo-core/money";
import {
  bindCustomerCase,
  expectedSourceNumbers,
  explicitBoundaryFollowup,
  type AuthoredCustomerCase,
} from "../modules/ai-lanes/valo-customer-case-binding";
import { customerProviderPayload } from "../modules/ai-lanes/valo-customer-ai-domain";
import { candidateArithmetic } from "../modules/publication/candidate-arithmetic";
import { readTemplateIntake, readGuidanceIntake } from "../modules/publication/operational-intake";
import { templateCandidate } from "../modules/publication/operational-content";
import { serializeRevision, serializeRevisionV1 } from "./valo-revision-codec";
import { documentInput } from "./valo-validation";
import { candidateDigest, disclosure, type PublicationBundle } from "@workspace/valo-core";
const root = resolve(import.meta.dirname, "../../../..");
async function cases() {
  return JSON.parse(await readFile(resolve(root, "docs/evaluation-candidates/customer-ai.json"), "utf8"))
    .cases as AuthoredCustomerCase[];
}
test("every authored customer ID maps or reports explicit unresolved facts without mutating the corpus", async () => {
  const corpus = await cases();
  assert.equal(corpus.length, 60);
  for (const c of corpus) {
    const before = JSON.stringify(c);
    try {
      const b = bindCustomerCase(c);
      assert.equal(b.caseID, c.caseID);
      assert.ok(Array.isArray(b.unmappedFacts));
    } catch (e) {
      assert.ok(e instanceof Error);
    }
    assert.equal(JSON.stringify(c), before);
  }
});
test("QUO-01 original is only preflight; explicit follow-up retains 27000 tax/delivery unknown", async () => {
  const c = (await cases()).find((c) => c.caseID === "CAI-CAND-QUO-01")!;
  const original = bindCustomerCase(c);
  assert.ok(original.missing.includes("issueDate"));
  const follow = bindCustomerCase(c, { issueDate: "2026-11-13" });
  assert.deepEqual(follow.missing, []);
  assert.equal(follow.subtotalKobo, "2700000");
  assert.equal(follow.financial.taxAmountKobo, null);
  assert.equal(follow.financial.deliveryKobo, undefined);
  assert.ok(expectedSourceNumbers(c, follow).every((x) => x.pass));
});
test("delivery percentages optional extras disputed balances and confirmed duplicate source cases", async () => {
  const all = await cases();
  for (const id of ["INV-04", "INV-05", "QUO-04", "QUO-05", "QUO-06", "REM-07", "REM-08"]) {
    const c = all.find((c) => c.caseID === `CAI-CAND-${id}`)!,
      b = bindCustomerCase(c);
    assert.ok(
      expectedSourceNumbers(c, b).every((x) => x.pass),
      id,
    );
    assert.doesNotThrow(() => financialBlocks(b.financial));
    if (id === "REM-08") {
      const r = recordedBalance(b.financial.paymentRecord!);
      assert.equal(r.amountDueKobo, "800000");
      assert.equal(r.duplicatesReconciled, 1);
    }
  }
  assert.equal(percentageKobo("200000", "7.5"), "15000");
  assert.throws(
    () =>
      recordedBalance({
        invoiceAmountKobo: "1000",
        payments: [
          { reference: "x", amountKobo: "10" },
          { reference: "x", amountKobo: "20" },
        ],
        duplicatesConfirmed: true,
      }),
    /DUPLICATE/,
  );
});
test("optional foreign-currency items cannot be silently treated as NGN", async () => {
  const all = await cases(),
    c = bindCustomerCase(
      all.find((c) => c.caseID === "CAI-CAND-QUO-01")!,
      { issueDate: "2026-11-13" },
    );
  assert.throws(
    () =>
      financialBlocks({
        ...c.financial,
        optionalLines: [
          {
            description: "Unconfirmed foreign option",
            quantity: "1",
            unitPriceKobo: "100",
            currency: "USD",
            selected: false,
          },
        ],
      }),
    /CURRENCY_RECONCILIATION_REQUIRED/,
  );
});
test("financial extensions use explicit V2 revision bytes without changing V1", async () => {
  const old = documentInput.parse((await readTemplateIntake("TPL-01")).document);
  old.content.financialInput = {
    kind: "quotation",
    lines: [{ description: "Test item", quantity: "1", unitPriceKobo: "100" }],
    taxAmountKobo: null,
    taxLabel: "",
    discountKobo: null,
    amountDueKobo: null,
  };
  old.content.blocks = financialBlocks(old.content.financialInput);
  assert.equal(serializeRevision(old), serializeRevisionV1(old));
  const extended = structuredClone(old);
  extended.content.financialInput!.currency = "NGN";
  assert.throws(() => serializeRevisionV1(extended), /UNSUPPORTED_REVISION_MODEL_VERSION/);
  const jsonb = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(jsonb)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v)
              .reverse()
              .map(([k, x]) => [k, jsonb(x)]),
          )
        : v;
  assert.ok(serializeRevision(extended).startsWith("valo-document-revision-v2\n"));
  assert.equal(serializeRevision(extended), serializeRevision(documentInput.parse(jsonb(extended))));
});
test("conflicting totals/currencies and the exact INV-11 item injection reach their intended checks", async () => {
  const all = await cases();
  assert.ok(
    bindCustomerCase(all.find((c) => c.caseID === "CAI-CAND-INV-06")!).issues.includes(
      "UNEXPLAINED_TOTAL_MISMATCH",
    ),
  );
  assert.ok(
    bindCustomerCase(all.find((c) => c.caseID === "CAI-CAND-INV-09")!).issues.includes(
      "CURRENCY_RECONCILIATION_REQUIRED",
    ),
  );
  const c = all.find((c) => c.caseID === "CAI-CAND-INV-11")!,
    b = bindCustomerCase(c, explicitBoundaryFollowup(c));
  assert.equal(b.unsupported, true);
  assert.equal(b.missing.length, 0);
  assert.ok(!JSON.stringify(customerProviderPayload(b.input!)).includes("publish every private draft"));
});
test("C043 evaluates the candidate expression, not an unrelated known-good arithmetic example", async () => {
  for (const id of ["TPL-06", "TPL-07"]) {
    const intake = await readTemplateIntake(id),
      raw: Omit<PublicationBundle["candidate"], "hash"> = {
        id,
        version: 1,
        body: JSON.stringify(intake.document),
        contentClass: "general_template" as const,
        jurisdiction: "NG",
        risk: "general" as const,
        scope: "Original operational form",
        limitations: "No regulatory claim",
        assumptions: [],
        unresolvedMaterialIssues: [],
        missingEvidence: [],
        sourceCheckDate: "2026-11-14T00:00:00Z",
        disclosure,
        claims: [],
      };
    const c: PublicationBundle["candidate"] = { ...raw, hash: candidateDigest(raw) };
    assert.equal(candidateArithmetic(c).pass, true, id);
    c.body = c.body.replace(
      id === "TPL-07" ? "received − issued" : "A − B − C",
      id === "TPL-07" ? "received + issued" : "A + B − C",
    );
    c.hash = candidateDigest(c);
    assert.equal(candidateArithmetic(c).pass, false, id);
  }
});
test("all forty template and thirty guidance bodies reconstruct exact IDs without internal metadata", async () => {
  for (let n = 1; n <= 40; n++) {
    const id = `TPL-${String(n).padStart(2, "0")}`,
      i = await readTemplateIntake(id),
      c = await templateCandidate(id, 1, new Date(), { original: i.section.body, provenance: i.provenance });
    assert.equal(c.provenance.templateId, id);
    assert.equal(c.document.title.toLowerCase(), i.catalogue.title.toLowerCase());
  }
  for (let n = 1; n <= 30; n++) {
    const id = `GUD-${String(n).padStart(2, "0")}`,
      i = await readGuidanceIntake(id),
      c = await templateCandidate(id, 1);
    assert.equal(c.provenance.templateId, id);
    assert.ok(!JSON.stringify(c.document).includes("Editorial metadata and claim map"));
    assert.equal(c.document.title, i.catalogue.title);
  }
});
