import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  contractOperations,
  pathParameters,
  type ContractOperation,
} from "../test-support/contract-operations";
import { requestIdentifiers } from "../test-support/request-identifiers";
import { saysUnexpectedFailure } from "../platform/http-errors";
import { templateDetailColumns } from "../test-support/template-details";

/**
 * SEC-001 and IAM-003: changing a workspace, draft, order or file identifier must not
 * reveal or change another business's data.
 *
 * Every private customer operation in the API contract that takes an identifier is
 * tried by a different workspace with the owner's real identifier. The reply must be
 * byte-for-byte the reply for an identifier that does not exist (so it reveals neither
 * data nor existence), it must be a refusal, and none of the owner's rows may change.
 * Owner requests then show that the same identifiers and bodies are valid.
 *
 * The same holds for identifiers in request bodies, query strings and headers, read from the
 * schemas the API validates requests with. Every private listing must show another workspace
 * none of the owner's records, and every table holding workspace rows must be mapped to the
 * cases that try its identifiers or to a recorded reason. Each list is checked against the
 * contract or the database, so something new fails until it is covered.
 *
 * The real app runs: every middleware, router, error handler and PostgreSQL query.
 * Only the identity provider is controlled in this process. Synthetic records only.
 */

/** Operations whose identifier is not owned by a workspace, with the reason. */
const NOT_WORKSPACE_OWNED: Record<string, string> = {
  "POST /workspace/templates/{id}/draft":
    "Public catalogue template identifier; the draft is created in the caller's own workspace.",
  "GET /workspace/templates/{id}/files/{format}":
    "Public catalogue template identifier. The purchase check it relies on is proven in valo-template-entitlement.integration.test.ts.",
  "GET /workspace/manual-premium-templates/{id}/download":
    "Public edition identifier shared by all workspaces. The manual library integration test downloads as the verified purchaser and checks another workspace, replacement and reversal.",
  "PUT /workspace/saved-templates/{id}":
    "Public catalogue template identifier; saved-template ownership is proven in valo-saved-templates.integration.test.ts.",
  "DELETE /workspace/saved-templates/by-template/{templateId}":
    "Public catalogue template identifier; saved-template ownership is proven in valo-saved-templates.integration.test.ts.",
};

type Case = {
  params: Record<string, string>;
  body?: unknown;
  headers?: () => Record<string, string>;
  /** Status the owner gets for the same request, proving the identifiers and body are valid. */
  ownerStatus?: number;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CASE_KEYS = [
  "GET /v1/documents/{id}/exports",
  "POST /v1/documents/{id}/exports",
  "GET /v1/exports/{id}/file",
  "POST /v1/exports/{id}/retry",
  "GET /workspace/ai-drafts/{id}",
  "POST /workspace/ai-drafts/{id}/accept",
  "GET /workspace/assessments/{id}",
  "GET /workspace/assessments/{id}/compare/{previousId}",
  "POST /workspace/concerns/{id}/respond",
  "GET /workspace/data-exports/{id}",
  "POST /workspace/data-exports/{id}/cancel",
  "GET /workspace/data-exports/{id}/download",
  "POST /workspace/data-exports/{id}/retry",
  "GET /workspace/documents/{id}",
  "PATCH /workspace/documents/{id}",
  "GET /workspace/documents/{id}/revisions",
  "GET /workspace/documents/{id}/form",
  "POST /workspace/edition-notices/{id}/read",
  "POST /workspace/orders/{id}/checkout",
  "GET /workspace/orders/{id}/dispute-information",
  "POST /workspace/orders/{id}/dispute-information",
  "GET /workspace/orders/{id}/receipt",
  "POST /workspace/orders/{id}/refresh",
  "POST /workspace/orders/{id}/refund",
  "POST /workspace/orders/{orderId}/concerns",
  "GET /workspace/privacy-cases/{id}",
  "POST /workspace/privacy-cases/{id}/cancel",
  "POST /workspace/privacy-cases/{id}/respond",
  "GET /workspace/privacy-cases/{id}/result",
  "POST /workspace/privacy-cases/{id}/verify",
  "POST /workspace/rule-notices/{id}/read",
  "GET /workspace/support-cases/{id}",
  "POST /workspace/support-cases/{id}/reply",
  "PATCH /workspace/tasks/{id}",
  "DELETE /workspace/tasks/{id}",
] as const;

/**
 * Identifiers a private operation takes outside its path, in its body, query string or headers
 * (request-identifiers.ts reads them from the schemas the API validates requests with). The
 * database test below tries another workspace's value in each of these fields.
 */
const REQUEST_FIELD_CASES = [
  "POST /v1/documents/{id}/exports body.revisionId",
  "POST /workspace/tasks body.assessmentId",
  "GET /workspace/data-exports query.cursor",
] as const;

/** Identifier fields that name nothing belonging to a workspace, with the reason. */
const REQUEST_FIELDS_NOT_WORKSPACE_OWNED: Record<string, string> = {
  "POST /workspace/orders body.priceId": "Public price identifier, the same for every workspace.",
  "POST /workspace/orders body.bundleId": "Public bundle version identifier, the same for every workspace.",
  "POST /workspace/tasks body.ruleId":
    "Rule identifier from the shared released rule registry; a source-linked task also needs the assessment, which has its own case, to contain that rule.",
  "POST /workspace/orders/{id}/dispute-information body.disputeId":
    "Names a dispute on the order in the path: the service reads that order in the caller's workspace, then the dispute only on that order (saveDisputeInformation), and the order identifier has its own case.",
  "POST /workspace/documents body.content.blocks[].id":
    "Block identifiers inside the document's own content, chosen by the client.",
  "PATCH /workspace/documents/{id} body.content.blocks[].id":
    "Block identifiers inside the document's own content, chosen by the client.",
  "POST /workspace/ai-drafts/{id}/accept body.content.blocks[].id":
    "Block identifiers inside the draft's own content, chosen by the client.",
  "POST /workspace/form-documents body.templateId":
    "Public catalogue template identifier; the document is started in the caller's own workspace.",
  "POST /workspace/form-documents body.formAnswers.templateId":
    "The public catalogue template the starting answers belong to; answers of any template but the one the document starts from are refused.",
  "POST /workspace/documents body.content.formAnswers.templateId":
    "The public catalogue template a document's own answers belong to; a form document starts only from its form, which records its edition.",
  "PATCH /workspace/documents/{id} body.content.formAnswers.templateId":
    "The public catalogue template a document's own answers belong to; the save is checked against the edition the document records.",
  "POST /workspace/ai-drafts/{id}/accept body.content.formAnswers.templateId":
    "The public catalogue template a draft's own answers belong to; a form document starts only from its form, which records its edition.",
};

/**
 * Keys a client chooses so that a retried request is not done twice. Each is unique only within
 * the listed columns of its unique index, so another workspace's key names nothing here; the
 * database test checks each index.
 */
const CLIENT_KEYS: Record<string, { index: string; within: string[] }> = {
  "POST /workspace/ai-drafts body.idempotencyKey": {
    index: "valo_ai_idempotency_unique",
    within: ["workspace_id"],
  },
  "POST /workspace/orders body.requestKey": {
    index: "valo_order_workspace_key_unique",
    within: ["workspace_id"],
  },
  "POST /workspace/orders/{id}/refund body.requestKey": {
    index: "valo_refund_request_key_unique",
    within: ["workspace_id"],
  },
  "POST /workspace/orders/{id}/dispute-information body.requestKey": {
    index: "valo_dispute_information_request",
    within: ["workspace_id"],
  },
  "POST /workspace/orders/{orderId}/concerns body.requestKey": {
    index: "valo_concern_request_once",
    within: ["workspace_id"],
  },
  "POST /workspace/privacy-requests body.idempotencyKey": {
    index: "valo_privacy_case_idempotency",
    within: ["workspace_id"],
  },
  "POST /workspace/data-exports body.requestKey": {
    index: "valo_workspace_export_request",
    within: ["workspace_id", "requester_id"],
  },
  "POST /v1/documents/{id}/exports header.Idempotency-Key": {
    index: "valo_export_request_key_unique",
    within: ["workspace_id"],
  },
  // The case identifier in the path has its own case.
  "POST /workspace/support-cases/{id}/reply body.idempotencyKey": {
    index: "valo_support_action_request",
    within: ["case_id", "actor_id"],
  },
};

/** Query strings the listing operations need; the rest take none. */
const LIST_QUERIES: Record<string, string> = {
  "GET /workspace/correction-notices": "?page=1",
  "GET /workspace/support-cases": "?page=1",
  "GET /workspace/tasks/page": "?page=1&filter=all",
};

/**
 * Every table holding a workspace's rows (those row-level security limits to one workspace,
 * decision 0008): the cases that try another workspace's identifier for its rows, directly or
 * through the parent row they are reached by, or why no customer request names one of its rows.
 * The database test reads the tables from the database, so a new one fails until it is listed.
 */
const PRIVATE_TABLES: Record<string, { cases: readonly string[] } | { reason: string }> = {
  valo_ai_drafts: { cases: ["GET /workspace/ai-drafts/{id}", "POST /workspace/ai-drafts/{id}/accept"] },
  valo_assessments: {
    cases: [
      "GET /workspace/assessments/{id}",
      "GET /workspace/assessments/{id}/compare/{previousId}",
      "POST /workspace/tasks body.assessmentId",
    ],
  },
  valo_concern_messages: { cases: ["POST /workspace/concerns/{id}/respond"] },
  valo_correction_notices: {
    reason: "Notices to the workspace; customers list only their own (GET /workspace/correction-notices).",
  },
  valo_dispute_actions: {
    reason: "Provider actions the dispute workflow records; no customer request names one.",
  },
  valo_dispute_information: {
    cases: [
      "GET /workspace/orders/{id}/dispute-information",
      "POST /workspace/orders/{id}/dispute-information",
    ],
  },
  valo_dispute_transitions: {
    reason: "History the dispute workflow records; no customer request names one.",
  },
  valo_document_revisions: {
    cases: ["GET /workspace/documents/{id}/revisions", "POST /v1/documents/{id}/exports body.revisionId"],
  },
  valo_documents: {
    cases: [
      "GET /workspace/documents/{id}",
      "PATCH /workspace/documents/{id}",
      "GET /v1/documents/{id}/exports",
      "POST /v1/documents/{id}/exports",
    ],
  },
  valo_edition_notices: { cases: ["POST /workspace/edition-notices/{id}/read"] },
  valo_entitlements: {
    reason:
      "Looked up by public template identifier within the caller's workspace; valo-template-entitlement.integration.test.ts proves another workspace's purchase grants nothing.",
  },
  valo_events: {
    reason: "The workspace's audit trail, written by the server; no customer request names one.",
  },
  valo_export_jobs: { cases: ["GET /v1/exports/{id}/file", "POST /v1/exports/{id}/retry"] },
  valo_export_objects: { cases: ["GET /v1/exports/{id}/file"] },
  valo_export_requests: {
    reason: "Each export request's client-chosen key (see CLIENT_KEYS); no customer request names one.",
  },
  valo_file_assets: { cases: ["GET /v1/exports/{id}/file", "GET /workspace/data-exports/{id}/download"] },
  valo_memberships: {
    reason: "Resolved by the server from the signed-in identity; no customer request names a membership.",
  },
  valo_orders: {
    cases: [
      "POST /workspace/orders/{id}/checkout",
      "GET /workspace/orders/{id}/receipt",
      "POST /workspace/orders/{id}/refresh",
      "POST /workspace/orders/{id}/refund",
      "POST /workspace/orders/{orderId}/concerns",
      "GET /workspace/orders/{id}/dispute-information",
    ],
  },
  valo_payment_concern_events: { cases: ["POST /workspace/concerns/{id}/respond"] },
  valo_payment_concerns: {
    cases: ["POST /workspace/concerns/{id}/respond", "POST /workspace/orders/{orderId}/concerns"],
  },
  valo_payment_disputes: {
    cases: [
      "GET /workspace/orders/{id}/dispute-information",
      "POST /workspace/orders/{id}/dispute-information",
    ],
  },
  valo_payment_reconciliations: {
    reason: "Payment checks the server runs with the provider; no customer request names one.",
  },
  valo_privacy_cases: {
    cases: [
      "GET /workspace/privacy-cases/{id}",
      "POST /workspace/privacy-cases/{id}/cancel",
      "POST /workspace/privacy-cases/{id}/respond",
      "GET /workspace/privacy-cases/{id}/result",
      "POST /workspace/privacy-cases/{id}/verify",
    ],
  },
  valo_privacy_erasure_objects: {
    reason: "Erasure bookkeeping the server keeps; no customer request names one.",
  },
  valo_privacy_events: { cases: ["GET /workspace/privacy-cases/{id}"] },
  valo_privacy_messages: {
    cases: ["GET /workspace/privacy-cases/{id}", "POST /workspace/privacy-cases/{id}/respond"],
  },
  valo_privacy_redactions: {
    reason:
      "Authenticated redaction records for the workspace's privacy events and refund history, read with those rows; no customer request names one.",
  },
  valo_privacy_tombstones: { reason: "Erasure records the server keeps; no customer request names one." },
  valo_profile_versions: {
    reason: "History of the workspace's own profile (PUT /workspace/profile); never named by identifier.",
  },
  valo_purchase_outbox: { reason: "Purchase work the server queues; no customer request names one." },
  valo_refund_requests: { cases: ["POST /workspace/orders/{id}/refund"] },
  valo_refund_transitions: { reason: "Refund history the server records; no customer request names one." },
  valo_reminder_outbox: { reason: "Reminder deliveries the server queues; no customer request names one." },
  valo_reminder_preferences: {
    reason:
      "The workspace's own preferences (GET and PUT /workspace/reminder-preferences); never named by identifier.",
  },
  valo_rule_notices: { cases: ["POST /workspace/rule-notices/{id}/read"] },
  valo_saved_templates: {
    reason:
      "Named by public template identifier within the caller's workspace; valo-saved-templates.integration.test.ts proves workspaces cannot see or change each other's.",
  },
  valo_support_actions: { cases: ["POST /workspace/support-cases/{id}/reply"] },
  valo_support_cases: {
    cases: ["GET /workspace/support-cases/{id}", "POST /workspace/support-cases/{id}/reply"],
  },
  valo_support_escalations: { reason: "Staff escalations of a support case; no customer request names one." },
  valo_support_events: { cases: ["GET /workspace/support-cases/{id}"] },
  valo_support_messages: {
    cases: ["GET /workspace/support-cases/{id}", "POST /workspace/support-cases/{id}/reply"],
  },
  valo_support_tickets: {
    reason:
      "Support requests a customer submits (POST /workspace/support); the case each opens has its own cases.",
  },
  valo_tasks: { cases: ["PATCH /workspace/tasks/{id}", "DELETE /workspace/tasks/{id}"] },
  valo_payment_events: {
    reason: "Provider payment events the webhook records; no customer request names one.",
  },
  valo_workspace_export_attempts: { cases: ["GET /workspace/data-exports/{id}"] },
  valo_workspace_exports: {
    cases: [
      "GET /workspace/data-exports/{id}",
      "POST /workspace/data-exports/{id}/cancel",
      "GET /workspace/data-exports/{id}/download",
      "POST /workspace/data-exports/{id}/retry",
      "GET /workspace/data-exports query.cursor",
    ],
  },
  valo_workspaces: {
    reason:
      "The workspace itself, resolved by the server from the signed-in identity's membership; no customer request names one.",
  },
};

/** Every private customer operation: the workspace's own routes and the document API. */
function privateOperations(): ContractOperation[] {
  return contractOperations().filter(
    (o) => o.path === "/workspace" || o.path.startsWith("/workspace/") || o.path.startsWith("/v1/"),
  );
}

function customerOperations(): ContractOperation[] {
  return contractOperations().filter(
    (o) => (o.path.startsWith("/workspace/") || o.path.startsWith("/v1/")) && o.path.includes("{"),
  );
}

/** Private reads that take no identifier: lists, searches and the workspace's own records. */
function listingOperations(): ContractOperation[] {
  return privateOperations().filter((o) => o.method === "GET" && !o.path.includes("{"));
}

test("every private operation with an identifier has a substitution case or a recorded reason", () => {
  // Kept in step with the cases below; a new contract operation fails here first.
  const covered = new Set([...Object.keys(NOT_WORKSPACE_OWNED), ...CASE_KEYS]);
  const missing = customerOperations()
    .map((o) => o.key)
    .filter((key) => !covered.has(key));
  assert.deepEqual(missing, [], "add a substitution case for each new operation");
  const stale = [...covered].filter((key) => !customerOperations().some((o) => o.key === key));
  assert.deepEqual(stale, [], "remove cases for operations no longer in the contract");
});

test("every identifier a private operation takes outside its path has a substitution case or a recorded reason", () => {
  const found = requestIdentifiers(privateOperations()).map((field) => field.key);
  assert.ok(found.length >= 10, "request fields were read from the generated schemas");
  const classified = [
    ...REQUEST_FIELD_CASES,
    ...Object.keys(REQUEST_FIELDS_NOT_WORKSPACE_OWNED),
    ...Object.keys(CLIENT_KEYS),
  ];
  assert.equal(new Set(classified).size, classified.length, "each field is classified once");
  assert.deepEqual(
    found.filter((key) => !classified.includes(key)),
    [],
    "add a substitution case, a client key or a reason for each new identifier field",
  );
  assert.deepEqual(
    classified.filter((key) => !found.includes(key)),
    [],
    "remove entries for fields no longer in the contract",
  );
});

test(
  "another workspace's identifiers are refused exactly like unknown ones and change nothing",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 180_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const tag = randomUUID();
    const identityHeader = "x-synthetic-identity";
    t.mock.module("@clerk/express", {
      namedExports: {
        clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
        getAuth: (req: Request) => {
          const id = req.header(identityHeader);
          const synthetic = id?.startsWith(`synthetic-tenant-${tag}-`) ? id : null;
          return {
            userId: synthetic,
            sessionId: synthetic ? `sess_${synthetic}` : null,
            sessionClaims: null,
            has: () => false,
          };
        },
        clerkClient: {
          sessions: {
            getSession: async (id: string) => ({ status: "active", userId: id.slice("sess_".length) }),
          },
          users: {
            getUser: async (id: string) => ({
              id,
              banned: false,
              locked: false,
              twoFactorEnabled: false,
              primaryEmailAddressId: "primary",
              emailAddresses: [
                {
                  id: "primary",
                  emailAddress: "synthetic@example.invalid",
                  verification: { status: "verified" },
                },
              ],
            }),
          },
        },
      },
    });
    const { default: app } = await import("../app");
    const {
      db,
      pool,
      valoAIDrafts,
      valoEditionNotices,
      valoManualLibrary,
      valoRuleNotices,
      valoOrders,
      valoPrices,
      valoStaffAssignments,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { resolveWorkspace, saveProfile } = await import("../modules/workspaces");
    const { syntheticDocument, syntheticProfile } = await import("../lib/valo-test-fixtures");
    const { financeHeldFixture } = await import("../modules/commerce/valo-finance-test-fixture");
    const { createPrivacyCase } = await import("../modules/privacy/valo-privacy");

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`,
      previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;

    type Reply = { status: number; text: string };
    async function call(
      identity: string,
      method: string,
      path: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ): Promise<Reply> {
      const response = await fetch(`${base}/api${path}`, {
        method,
        headers: {
          Origin: base,
          [identityHeader]: identity,
          ...(method === "GET" ? {} : { "Content-Type": "application/json" }),
          ...headers,
        },
        ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
      });
      return { status: response.status, text: await response.text() };
    }
    const json = (reply: Reply) => JSON.parse(reply.text) as Record<string, unknown>;
    const identity = (role: string) => `synthetic-tenant-${tag}-${role}`;

    let formEdition: { id: string; editor: string } | undefined;
    try {
      // The owner's resources, created through the same API wherever the test
      // environment allows it.
      const owner = identity("owner");
      const ownerActor = await resolveWorkspace(owner);
      await saveProfile(ownerActor, { expectedRevision: 0, profile: syntheticProfile });
      const createdDocument = await call(owner, "POST", "/workspace/documents", syntheticDocument);
      assert.equal(createdDocument.status, 201, createdDocument.text);
      const document = json(createdDocument) as { id: string; revisionId: string; revision: number };
      const createdExport = await call(
        owner,
        "POST",
        `/v1/documents/${document.id}/exports`,
        { revisionId: document.revisionId, format: "pdf", acknowledgeDraft: true },
        { "Idempotency-Key": randomUUID() },
      );
      assert.equal(createdExport.status, 202, createdExport.text);
      const exportJob = json(createdExport) as { id: string };
      const createdTask = await call(owner, "POST", "/workspace/tasks", {
        title: "Synthetic owner task",
        notes: "",
        dueDate: null,
        dateConfirmed: false,
        assessmentId: null,
        ruleId: null,
      });
      assert.equal(createdTask.status, 201, createdTask.text);
      const task = json(createdTask) as { id: string; revision: number };
      const assessmentInput = {
        asOfDate: new Date().toISOString().slice(0, 10),
        saveConsent: true,
        expectedProfileRevision: 1,
      };
      const assessments: string[] = [];
      for (let i = 0; i < 2; i++) {
        const created = await call(owner, "POST", "/workspace/assessments", assessmentInput);
        assert.equal(created.status, 201, created.text);
        assessments.push(String(json(created).id));
      }
      const createdDataExport = await call(owner, "POST", "/workspace/data-exports", {
        requestKey: randomUUID(),
      });
      assert.ok([201, 202].includes(createdDataExport.status), createdDataExport.text);
      const dataExport = json(createdDataExport) as { id: string; version: number };
      const privacy = await createPrivacyCase(ownerActor, "synthetic@example.invalid", {
        kind: "correction",
        idempotencyKey: randomUUID(),
        message: "Synthetic correction request for the substitution proof.",
        acknowledgement: true,
      });
      const privacyCaseId = privacy.reference.slice(5);
      const ownerCase = await call(owner, "GET", `/workspace/privacy-cases/${privacyCaseId}`);
      assert.equal(ownerCase.status, 200, ownerCase.text);
      const privacyVersion = Number((json(ownerCase).request as { version: number }).version);
      // Orders cannot be created through the API without live checkout, so the order is a
      // synthetic row bound to a held, never-published content version.
      const held = await financeHeldFixture(),
        priceId = randomUUID(),
        orderId = randomUUID();
      await db.insert(valoPrices).values({
        id: priceId,
        contentVersionId: held.id,
        title: "CONTROLLED SUBSTITUTION FIXTURE — NOT RELEASED",
        amountKobo: 10000,
        licenceVersion: "test-only",
        licenceText: "No live commercial approval.",
        taxTreatment: "No tax claim.",
        approvalReference: "CONTROLLED_FIXTURE_NOT_APPROVAL",
        effectiveFrom: new Date(),
      });
      await db.insert(valoOrders).values({
        id: orderId,
        workspaceId: ownerActor.workspaceId,
        requestedBy: owner,
        requestKey: randomUUID(),
        priceId,
        reference: "valo-test-" + orderId,
        amountKobo: 10000,
        status: "verified_success",
        providerTransactionId: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
        line: {
          title: "Controlled purchase",
          contentVersionId: held.id,
          licenceVersion: "test-only",
          licenceText: "No live commercial approval.",
          taxTreatment: "No tax claim.",
        },
      });
      const createdConcern = await call(owner, "POST", `/workspace/orders/${orderId}/concerns`, {
        requestKey: randomUUID(),
        message: "Synthetic owner concern about a controlled purchase.",
        acknowledgement: true,
      });
      assert.equal(createdConcern.status, 200, createdConcern.text);
      const concern = json(createdConcern) as { id: string; version: number };
      // AI drafts need an owner-approved inference budget, so the draft is a synthetic row.
      const aiDraftId = randomUUID();
      await db.insert(valoAIDrafts).values({
        id: aiDraftId,
        workspaceId: ownerActor.workspaceId,
        actorId: owner,
        idempotencyKey: randomUUID(),
        inputHash: "0".repeat(64),
        task: "invoice",
        status: "manual_fallback",
        promptVersion: "synthetic-substitution",
        preview: {},
      });
      // Saving a support request opens its case in the same transaction.
      const createdTicket = await call(owner, "POST", "/workspace/support", {
        category: "support",
        scope: "Synthetic owner support request for the substitution proof.",
        contactEmail: "synthetic@example.invalid",
        sharingConsent: false,
      });
      assert.equal(createdTicket.status, 201, createdTicket.text);
      const supportCases = await call(owner, "GET", "/workspace/support-cases");
      assert.equal(supportCases.status, 200, supportCases.text);
      const supportCase = (json(supportCases).cases as { id: string; version: number }[])[0]!;
      assert.ok(supportCase);

      // A form document starts only from a released edition of its template's wording: a
      // synthetic library row that a synthetic Content editor releases here, withdrawn at the end.
      const { proposedFormText } = await import("../modules/manual-library/form-text-maps");
      formEdition = { id: randomUUID(), editor: identity("form-editor") };
      await db.insert(valoStaffAssignments).values({
        id: randomUUID(),
        identityId: formEdition.editor,
        role: "content",
        grantedBy: "synthetic test",
        reason: "Synthetic form edition for the substitution proof",
      });
      await db.insert(valoManualLibrary).values({
        id: formEdition.id,
        itemId: formEdition.id,
        version: 1,
        slug: "manual-" + formEdition.id,
        kind: "template",
        title: "Invoice",
        body: "Synthetic invoice description",
        digest: "a".repeat(64),
        fileFormat: "docx",
        fileBytes: Buffer.from("synthetic"),
        formText: await proposedFormText("TPL-01"),
        ...templateDetailColumns,
        createdBy: formEdition.editor,
      });
      await db
        .update(valoManualLibrary)
        .set({ state: "published", publishedBy: formEdition.editor, publishedAt: new Date() })
        .where(eq(valoManualLibrary.id, formEdition.id));
      const createdFormDocument = await call(owner, "POST", "/workspace/form-documents", {
        templateId: "TPL-01",
      });
      assert.equal(createdFormDocument.status, 201, createdFormDocument.text);
      const formDocument = json(createdFormDocument) as { id: string };
      // The database writes a notice when an edition the workspace used is replaced or withdrawn
      // (docs/architecture/editions.md, slice 3; the library's database test releases and withdraws
      // editions for it). Here a synthetic notice of the form edition stands in for one.
      const editionNoticeId = randomUUID();
      await db.insert(valoEditionNotices).values({
        id: editionNoticeId,
        workspaceId: ownerActor.workspaceId,
        route: "library",
        edition: formEdition.id,
        kind: "replaced",
        title: "Invoice",
        version: 1,
        replacementVersion: 2,
        held: false,
        documents: 1,
      });
      // The database writes a rule notice when a rule version the workspace used is replaced or withdrawn
      // (docs/architecture/rule-changes.md, slice 2; the owner's sign-off test makes one). Here a synthetic
      // notice stands in for one.
      const ruleNoticeId = randomUUID();
      await db.insert(valoRuleNotices).values({
        id: ruleNoticeId,
        workspaceId: ownerActor.workspaceId,
        ruleId: "synthetic-rule",
        version: 1,
        kind: "withdrawn",
        title: "Synthetic rule",
        reason: "A synthetic reason the owner wrote for this withdrawal.",
        results: 1,
        tasks: 0,
      });

      const content = syntheticDocument.content;
      const cases: Record<(typeof CASE_KEYS)[number], Case> = {
        "GET /v1/documents/{id}/exports": { params: { id: document.id }, ownerStatus: 200 },
        "POST /v1/documents/{id}/exports": {
          params: { id: document.id },
          body: { revisionId: document.revisionId, format: "docx", acknowledgeDraft: true },
          headers: () => ({ "Idempotency-Key": randomUUID() }),
          ownerStatus: 202,
        },
        "GET /v1/exports/{id}/file": { params: { id: exportJob.id } },
        "POST /v1/exports/{id}/retry": { params: { id: exportJob.id }, body: {} },
        "GET /workspace/ai-drafts/{id}": { params: { id: aiDraftId } },
        "POST /workspace/ai-drafts/{id}/accept": {
          params: { id: aiDraftId },
          body: { title: "Synthetic accept attempt", content, confirmBusinessDraft: true },
        },
        "GET /workspace/assessments/{id}": { params: { id: assessments[1]! }, ownerStatus: 200 },
        "GET /workspace/assessments/{id}/compare/{previousId}": {
          params: { id: assessments[1]!, previousId: assessments[0]! },
          ownerStatus: 200,
        },
        "POST /workspace/concerns/{id}/respond": {
          params: { id: concern.id },
          body: { expectedVersion: concern.version, message: "Synthetic reply from another business." },
        },
        "GET /workspace/data-exports/{id}": { params: { id: dataExport.id }, ownerStatus: 200 },
        "POST /workspace/data-exports/{id}/cancel": {
          params: { id: dataExport.id },
          body: { expectedVersion: dataExport.version },
        },
        "GET /workspace/data-exports/{id}/download": { params: { id: dataExport.id } },
        "POST /workspace/data-exports/{id}/retry": {
          params: { id: dataExport.id },
          body: { expectedVersion: dataExport.version },
        },
        "GET /workspace/documents/{id}": { params: { id: document.id }, ownerStatus: 200 },
        "PATCH /workspace/documents/{id}": {
          params: { id: document.id },
          body: { expectedRevision: document.revision, title: "Synthetic overwrite attempt", content },
          ownerStatus: 200,
        },
        "GET /workspace/documents/{id}/revisions": { params: { id: document.id }, ownerStatus: 200 },
        "GET /workspace/documents/{id}/form": { params: { id: formDocument.id }, ownerStatus: 200 },
        "POST /workspace/edition-notices/{id}/read": {
          params: { id: editionNoticeId },
          body: {},
          ownerStatus: 200,
        },
        "POST /workspace/rule-notices/{id}/read": {
          params: { id: ruleNoticeId },
          body: {},
          ownerStatus: 200,
        },
        "POST /workspace/orders/{id}/checkout": { params: { id: orderId }, body: {} },
        "GET /workspace/orders/{id}/dispute-information": { params: { id: orderId } },
        "POST /workspace/orders/{id}/dispute-information": {
          params: { id: orderId },
          body: {
            disputeId: randomUUID(),
            requestKey: randomUUID(),
            customerName: "Synthetic Customer",
            customerPhone: "+2340000000000",
            serviceDetails: "Synthetic service details for a refused request.",
            consentVersion: "test-dispute-information-v1",
          },
        },
        "GET /workspace/orders/{id}/receipt": { params: { id: orderId } },
        "POST /workspace/orders/{id}/refresh": { params: { id: orderId }, body: {} },
        "POST /workspace/orders/{id}/refund": {
          params: { id: orderId },
          body: {
            reason: "Synthetic refund attempt on another business's order.",
            amountKobo: 10000,
            requestKey: randomUUID(),
            acceptedPolicyVersion: "test-refund-v1",
          },
        },
        "POST /workspace/orders/{orderId}/concerns": {
          params: { orderId },
          body: {
            requestKey: randomUUID(),
            message: "Synthetic concern attempt on another business's order.",
            acknowledgement: true,
          },
        },
        "GET /workspace/privacy-cases/{id}": { params: { id: privacyCaseId }, ownerStatus: 200 },
        "POST /workspace/privacy-cases/{id}/cancel": {
          params: { id: privacyCaseId },
          body: { expectedVersion: privacyVersion, acknowledgement: true },
        },
        "POST /workspace/privacy-cases/{id}/respond": {
          params: { id: privacyCaseId },
          body: { expectedVersion: privacyVersion, message: "Synthetic information from another business." },
        },
        "GET /workspace/privacy-cases/{id}/result": { params: { id: privacyCaseId } },
        "POST /workspace/privacy-cases/{id}/verify": {
          params: { id: privacyCaseId },
          body: { expectedVersion: privacyVersion, acknowledgement: true },
        },
        "GET /workspace/support-cases/{id}": { params: { id: supportCase.id }, ownerStatus: 200 },
        "POST /workspace/support-cases/{id}/reply": {
          params: { id: supportCase.id },
          body: {
            idempotencyKey: randomUUID(),
            expectedVersion: supportCase.version,
            body: "Synthetic reply from another business.",
          },
        },
        "PATCH /workspace/tasks/{id}": {
          params: { id: task.id },
          body: {
            title: "Synthetic overwrite attempt",
            notes: "",
            dueDate: null,
            dateConfirmed: false,
            state: "in_progress",
            expectedRevision: task.revision,
          },
          ownerStatus: 200,
        },
        "DELETE /workspace/tasks/{id}": {
          params: { id: task.id },
          body: { expectedRevision: task.revision },
        },
      };

      // Every row the owner's workspace holds, in every workspace-scoped table.
      const tables = (
        await pool.query<{ table_name: string }>(
          `SELECT DISTINCT table_name FROM information_schema.columns
            WHERE table_schema = 'public' AND column_name = 'workspace_id' ORDER BY table_name`,
        )
      ).rows.map((row) => row.table_name);
      assert.ok(tables.length > 20, "workspace-scoped tables were found");
      async function ownerState() {
        const parts: unknown[] = [];
        for (const table of tables) {
          const { rows } = await pool.query(`SELECT * FROM "${table}" WHERE workspace_id = $1`, [
            ownerActor.workspaceId,
          ]);
          parts.push([table, rows.map((row) => JSON.stringify(row)).sort()]);
        }
        const { rows } = await pool.query("SELECT * FROM valo_workspaces WHERE id = $1", [
          ownerActor.workspaceId,
        ]);
        parts.push(["valo_workspaces", rows.map((row) => JSON.stringify(row))]);
        return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
      }

      const operations = new Map(customerOperations().map((o) => [o.key, o]));
      const pathFor = (operation: ContractOperation, params: Record<string, string>) =>
        operation.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
          assert.ok(params[name], `${operation.key}: missing parameter ${name}`);
          return encodeURIComponent(params[name]!);
        });
      const normalised = (reply: Reply, identifiers: string[]) => {
        let text = reply.text;
        for (const id of identifiers) text = text.replaceAll(id, "<identifier>");
        try {
          const body = JSON.parse(text) as Record<string, unknown>;
          delete body.requestId;
          return JSON.stringify(body);
        } catch {
          return text;
        }
      };

      const ownerBefore = await ownerState();
      let attackers = 0;
      for (const key of CASE_KEYS) {
        const operation = operations.get(key);
        assert.ok(operation, `${key} is in the contract`);
        assert.deepEqual(Object.keys(cases[key].params).sort(), pathParameters(operation.path).sort(), key);
        await t.test(key, async () => {
          const c = cases[key];
          const attacker = identity(`attacker-${++attackers}`);
          const before = await ownerState();
          const foreign = await call(
            attacker,
            operation.method,
            pathFor(operation, c.params),
            c.body,
            c.headers?.(),
          );
          const unknownParams = Object.fromEntries(
            Object.entries(c.params).map(([name, value]) => [
              name,
              uuidPattern.test(value) ? randomUUID() : value,
            ]),
          );
          const unknown = await call(
            attacker,
            operation.method,
            pathFor(operation, unknownParams),
            c.body,
            c.headers?.(),
          );
          assert.ok(
            foreign.status >= 400 && foreign.status < 500,
            `${key} answered ${foreign.status}: ${foreign.text}`,
          );
          assert.equal(foreign.status, unknown.status, `${key}: existence is visible through the status`);
          assert.equal(
            normalised(foreign, Object.values(c.params)),
            normalised(unknown, Object.values(unknownParams)),
            `${key}: existence is visible through the reply`,
          );
          assert.equal(await ownerState(), before, `${key} changed the owner's data`);
        });
      }
      assert.equal(await ownerState(), ownerBefore);

      await t.test("comparing one's own assessment with another workspace's is refused", async () => {
        const attacker = identity("comparer");
        const attackerActor = await resolveWorkspace(attacker);
        await saveProfile(attackerActor, { expectedRevision: 0, profile: syntheticProfile });
        const own = await call(attacker, "POST", "/workspace/assessments", assessmentInput);
        assert.equal(own.status, 201, own.text);
        const ownId = String(json(own).id);
        for (const [id, previousId] of [
          [ownId, assessments[0]!],
          [assessments[1]!, ownId],
        ]) {
          const foreign = await call(attacker, "GET", `/workspace/assessments/${id}/compare/${previousId}`);
          const unknownPath =
            id === ownId
              ? `/workspace/assessments/${ownId}/compare/${randomUUID()}`
              : `/workspace/assessments/${randomUUID()}/compare/${ownId}`;
          const unknown = await call(attacker, "GET", unknownPath);
          assert.ok(foreign.status >= 400 && foreign.status < 500, foreign.text);
          assert.equal(foreign.status, unknown.status);
        }
      });

      await t.test(
        "another workspace's identifiers in request bodies and query strings are refused",
        async () => {
          const attacker = identity("request-fields");
          // A complete workspace of its own, so the identifier is the only difference.
          await saveProfile(await resolveWorkspace(attacker), {
            expectedRevision: 0,
            profile: syntheticProfile,
          });
          const ownDocument = json(
            await call(attacker, "POST", "/workspace/documents", syntheticDocument),
          ) as { id: string };
          const taskBody = (assessmentId: string) => ({
            title: "Synthetic task linked to an assessment",
            notes: "",
            dueDate: null,
            dateConfirmed: false,
            assessmentId,
            ruleId: null,
          });
          // Each request names the caller's own records in its path and `value` in the field.
          type FieldRequest = {
            method: string;
            path: string;
            body?: unknown;
            headers?: Record<string, string>;
          };
          const fields: Record<
            (typeof REQUEST_FIELD_CASES)[number],
            {
              reference: string;
              ownerStatus: number;
              request: (caller: string, value: string) => FieldRequest;
            }
          > = {
            "POST /v1/documents/{id}/exports body.revisionId": {
              reference: document.revisionId,
              ownerStatus: 202,
              request: (caller, revisionId) => ({
                method: "POST",
                path: `/v1/documents/${caller === owner ? document.id : ownDocument.id}/exports`,
                body: { revisionId, format: "pdf", acknowledgeDraft: true },
                headers: { "Idempotency-Key": randomUUID() },
              }),
            },
            "POST /workspace/tasks body.assessmentId": {
              reference: assessments[0]!,
              ownerStatus: 201,
              request: (_caller, assessmentId) => ({
                method: "POST",
                path: "/workspace/tasks",
                body: taskBody(assessmentId),
              }),
            },
            "GET /workspace/data-exports query.cursor": {
              reference: dataExport.id,
              ownerStatus: 200,
              request: (_caller, cursor) => ({
                method: "GET",
                path: `/workspace/data-exports?cursor=${cursor}`,
              }),
            },
          };
          for (const key of REQUEST_FIELD_CASES) {
            const field = fields[key];
            const before = await ownerState();
            const send = async (caller: string, value: string) => {
              const r = field.request(caller, value);
              return call(caller, r.method, r.path, r.body, r.headers);
            };
            const unknownValue = randomUUID();
            const foreign = await send(attacker, field.reference);
            const unknown = await send(attacker, unknownValue);
            assert.ok(foreign.status >= 400 && foreign.status < 500, `${key} answered ${foreign.status}`);
            assert.equal(foreign.status, unknown.status, `${key}: existence is visible through the status`);
            assert.equal(
              normalised(foreign, [field.reference]),
              normalised(unknown, [unknownValue]),
              `${key}: existence is visible through the reply`,
            );
            assert.equal(await ownerState(), before, `${key} changed the owner's data`);
            // The owner's own request with the same value succeeds, so the refusal is the
            // ownership check and not a malformed request.
            const own = await send(owner, field.reference);
            assert.equal(own.status, field.ownerStatus, `${key} as the owner: ${own.text.slice(0, 300)}`);
          }
        },
      );

      await t.test("each client-chosen request key is unique only within its own scope", async () => {
        for (const [key, { index, within }] of Object.entries(CLIENT_KEYS)) {
          const { rows } = await pool.query<{ indexdef: string }>(
            "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1",
            [index],
          );
          assert.equal(rows.length, 1, `${key}: unique index ${index} exists`);
          const definition = rows[0]!.indexdef;
          assert.match(definition, /^CREATE UNIQUE INDEX /, `${key}: ${index} is unique`);
          const columns =
            /\(([^)]*)\)\s*$/
              .exec(definition)?.[1]
              ?.split(",")
              .map((c) => c.trim()) ?? [];
          for (const column of within)
            assert.ok(
              columns.includes(column),
              `${key}: ${index} (${columns.join(", ")}) is within ${column}`,
            );
        }
      });

      await t.test("every private listing shows another workspace none of the owner's records", async () => {
        const ownerIdentifiers = [
          owner,
          ownerActor.workspaceId,
          document.id,
          document.revisionId,
          exportJob.id,
          task.id,
          ...assessments,
          dataExport.id,
          privacyCaseId,
          orderId,
          concern.id,
          aiDraftId,
          supportCase.id,
          editionNoticeId,
          ruleNoticeId,
        ];
        const listings = listingOperations();
        assert.ok(listings.length >= 15, "listing operations were read from the contract");
        const outsider = identity("lister");
        await saveProfile(await resolveWorkspace(outsider), {
          expectedRevision: 0,
          profile: syntheticProfile,
        });
        for (const operation of listings) {
          const reply = await call(outsider, "GET", operation.path + (LIST_QUERIES[operation.key] ?? ""));
          assert.ok(
            reply.status < 500,
            `${operation.key} answered ${reply.status}: ${reply.text.slice(0, 300)}`,
          );
          for (const id of ownerIdentifiers)
            assert.ok(
              !reply.text.includes(id),
              `${operation.key} showed another workspace the owner's ${id}`,
            );
        }
        // The same listings show the owner its own records, so the check above can fail.
        const ownerSees: Record<string, string> = {
          "GET /workspace/documents": document.id,
          "GET /workspace/tasks": task.id,
          "GET /workspace/assessments": assessments[0]!,
          "GET /workspace/data-exports": dataExport.id,
          "GET /workspace/privacy-cases": privacyCaseId,
          "GET /workspace/support-cases": supportCase.id,
          "GET /workspace/edition-notices": editionNoticeId,
          "GET /workspace/rule-notices": ruleNoticeId,
        };
        for (const [key, id] of Object.entries(ownerSees)) {
          assert.ok(
            listings.some((o) => o.key === key),
            `${key} is a listing operation`,
          );
          const reply = await call(owner, "GET", key.slice("GET ".length) + (LIST_QUERIES[key] ?? ""));
          assert.equal(reply.status, 200, `${key} as the owner: ${reply.text.slice(0, 300)}`);
          assert.ok(reply.text.includes(id), `${key} shows the owner its own record`);
        }
      });

      await t.test("every private table has substitution cases or a recorded reason", async () => {
        // The tables row-level security limits to one workspace; rowSecurityGaps checks that
        // these are exactly the tables holding workspace rows.
        const { rows } = await pool.query<{ tablename: string }>(
          "SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'valo_workspace_scope' ORDER BY tablename",
        );
        const privateTables = rows.map((row) => row.tablename);
        assert.ok(privateTables.length >= 40, "private tables were read from the database");
        assert.deepEqual(
          privateTables.filter((table) => !(table in PRIVATE_TABLES)),
          [],
          "list each new private table with its cases or a reason",
        );
        assert.deepEqual(
          Object.keys(PRIVATE_TABLES).filter((table) => !privateTables.includes(table)),
          [],
          "remove tables that no longer hold workspace rows",
        );
        const known = new Set<string>([...CASE_KEYS, ...REQUEST_FIELD_CASES]);
        for (const [table, entry] of Object.entries(PRIVATE_TABLES))
          if ("cases" in entry) {
            assert.ok(entry.cases.length > 0, `${table} lists its cases`);
            for (const key of entry.cases)
              assert.ok(known.has(key), `${table}: ${key} is a substitution case`);
          }
      });

      await t.test("the owner can use the same identifiers and bodies", async () => {
        for (const key of CASE_KEYS) {
          const c = cases[key];
          if (c.ownerStatus === undefined) continue;
          const operation = operations.get(key)!;
          const reply = await call(
            owner,
            operation.method,
            pathFor(operation, c.params),
            c.body,
            c.headers?.(),
          );
          assert.equal(reply.status, c.ownerStatus, `${key}: ${reply.text}`);
        }
      });

      await t.test(
        "every staff operation refuses customers and anonymous callers and changes nothing",
        async () => {
          // Read from the contract, so a new staff operation is covered without editing this test.
          const staffOperations = contractOperations().filter((o) => o.path.startsWith("/admin/"));
          assert.ok(staffOperations.length >= 15, "staff operations were read from the contract");
          const customer = identity("customer-without-staff-role");
          await resolveWorkspace(customer);
          const staffRows = async () =>
            (
              await pool.query<{ n: string }>(
                "SELECT (SELECT count(*) FROM valo_staff_assignments) + (SELECT count(*) FROM valo_staff_role_changes) + (SELECT count(*) FROM valo_staff_access_audit) AS n",
              )
            ).rows[0]!.n;
          const ownerBeforeStaff = await ownerState(),
            staffBefore = await staffRows();
          for (const operation of staffOperations) {
            const params = Object.fromEntries(
              pathParameters(operation.path).map((name) => [
                name,
                name === "operation" ? "cancel" : randomUUID(),
              ]),
            );
            for (const caller of [customer, "anonymous"]) {
              const reply = await call(
                caller,
                operation.method,
                pathFor(operation, params),
                operation.method === "GET" ? undefined : {},
              );
              assert.ok(
                [401, 403, 404].includes(reply.status),
                `${operation.key} as ${caller === customer ? "a customer" : "an anonymous caller"} answered ${reply.status}: ${reply.text.slice(0, 200)}`,
              );
            }
          }
          assert.equal(await ownerState(), ownerBeforeStaff);
          assert.equal(await staffRows(), staffBefore, "no staff role, assignment or audit row was written");
        },
      );

      await t.test("every private operation answers its owner without a server error", async () => {
        // Customer requests act as a database role that may run only the commands they use
        // (decision 0008), so a missing grant would answer here as a server error. Read from
        // the contract, so a new private operation fails until it has a request below.
        const { customerAICases } = await import("../modules/ai-lanes/valo-customer-ai-fixtures");
        const today = new Date().toISOString().slice(0, 10);
        const profileRevision = async () =>
          Number(
            (
              await pool.query<{ profile_revision: number }>(
                "SELECT profile_revision FROM valo_workspaces WHERE id = $1",
                [ownerActor.workspaceId],
              )
            ).rows[0]!.profile_revision,
          );
        const { businessName: _name, marketingConsent: _consent, ...facts } = syntheticProfile;
        const withoutIdentifier: Record<string, { query?: string; body?: () => unknown }> = {
          "GET /v1/exports": {},
          "GET /workspace": {},
          "GET /workspace/account": {},
          "GET /workspace/ai-usage": {},
          "GET /workspace/assessments": {},
          "GET /workspace/correction-notices": { query: LIST_QUERIES["GET /workspace/correction-notices"]! },
          "GET /workspace/data-export": {},
          "GET /workspace/data-exports": {},
          "GET /workspace/disputes": {},
          "GET /workspace/document-editions": {},
          "GET /workspace/edition-notices": {},
          "GET /workspace/rule-notices": {},
          "GET /workspace/documents": {},
          "POST /workspace/form-documents": { body: () => ({ templateId: "TPL-01" }) },
          "GET /workspace/form-templates": {},
          "GET /workspace/privacy-cases": {},
          "GET /workspace/purchases": {},
          "GET /workspace/owned-template-editions": {},
          "GET /workspace/reminder-preferences": {},
          "GET /workspace/reminders": {},
          "GET /workspace/saved-templates": {},
          "GET /workspace/support-cases": { query: LIST_QUERIES["GET /workspace/support-cases"]! },
          "GET /workspace/tasks": {},
          "GET /workspace/tasks/page": { query: LIST_QUERIES["GET /workspace/tasks/page"]! },
          "POST /workspace/ai-drafts": {
            body: () => ({ ...structuredClone(customerAICases[0]!.input), idempotencyKey: randomUUID() }),
          },
          "POST /workspace/assessments": {
            body: async () => ({ ...assessmentInput, expectedProfileRevision: await profileRevision() }),
          },
          "POST /workspace/checker/preview": { body: () => ({ facts, asOfDate: today }) },
          "POST /workspace/data-exports": { body: () => ({ requestKey: randomUUID() }) },
          "POST /workspace/documents": { body: () => syntheticDocument },
          "POST /workspace/orders": {
            body: () => ({
              priceId,
              acceptedLicenceVersion: "test-only",
              acceptedCarriesToLaterEditions: true,
              requestKey: randomUUID(),
            }),
          },
          "POST /workspace/privacy-requests": {
            body: () => ({
              kind: "correction",
              message: "Synthetic correction request from the owner check.",
              acknowledgement: true,
              idempotencyKey: randomUUID(),
            }),
          },
          "POST /workspace/support": {
            body: () => ({
              category: "support",
              scope: "Synthetic owner support request for the owner check.",
              contactEmail: "synthetic@example.invalid",
              sharingConsent: false,
            }),
          },
          "POST /workspace/tasks": {
            body: () => ({
              title: "Synthetic owner check task",
              notes: "",
              dueDate: null,
              dateConfirmed: false,
              assessmentId: null,
              ruleId: null,
            }),
          },
          "PUT /workspace/profile": {
            body: async () => ({ expectedRevision: await profileRevision(), profile: syntheticProfile }),
          },
          "PUT /workspace/reminder-preferences": {
            body: async () => ({
              enabled: false,
              offsets: [],
              expectedRevision: Number(
                json(await call(owner, "GET", "/workspace/reminder-preferences")).revision,
              ),
            }),
          },
        };
        // Catalogue identifiers that are not the workspace's own; none of them is released here.
        const catalogue: Record<string, Record<string, string>> = {
          "POST /workspace/templates/{id}/draft": { id: randomUUID() },
          "GET /workspace/templates/{id}/files/{format}": { id: randomUUID(), format: "pdf" },
          "GET /workspace/manual-premium-templates/{id}/download": { id: randomUUID() },
          "PUT /workspace/saved-templates/{id}": { id: randomUUID() },
          "DELETE /workspace/saved-templates/by-template/{templateId}": { templateId: "SYNTHETIC-ABSENT" },
        };
        // Unexpected errors are logged and answered with this generic message; a deliberate
        // refusal names its reason.
        const serverError = (reply: Reply) => reply.status === 500 || saysUnexpectedFailure(reply.text);
        // Each request starts with the owner's rate limits unused, so it reaches its writes.
        const { quotaSubjectHash } = await import("../lib/valo-quota-policy");
        const ownerQuota = quotaSubjectHash(process.env.SESSION_SECRET, "user", owner);
        const all = contractOperations().filter(
          (o) => o.path === "/workspace" || o.path.startsWith("/workspace/") || o.path.startsWith("/v1/"),
        );
        assert.ok(all.length >= 60, "private operations were read from the contract");
        for (const operation of all) {
          const key = operation.key;
          let path: string, body: unknown, headers: Record<string, string> | undefined;
          if (key in cases) {
            const c = cases[key as (typeof CASE_KEYS)[number]];
            [path, body, headers] = [pathFor(operation, c.params), c.body, c.headers?.()];
          } else if (key in catalogue) {
            [path, body] = [pathFor(operation, catalogue[key]!), operation.method === "GET" ? undefined : {}];
          } else {
            const request = withoutIdentifier[key];
            assert.ok(request, `${key}: add an owner request to this check`);
            [path, body] = [operation.path + (request.query ?? ""), await request.body?.()];
          }
          await pool.query("DELETE FROM valo_rate_buckets WHERE subject_hash = $1", [ownerQuota]);
          let reply = await call(owner, operation.method, path, body, headers);
          // An earlier request may have changed the row; repeat once at its current revision.
          const current = reply.status === 409 ? json(reply).currentRevision : undefined;
          if (typeof current === "number" && body && typeof body === "object") {
            const field = "expectedRevision" in body ? "expectedRevision" : "expectedVersion";
            if (field in body)
              reply = await call(owner, operation.method, path, { ...body, [field]: current }, headers);
          }
          assert.ok(!serverError(reply), `${key} answered ${reply.status}: ${reply.text.slice(0, 300)}`);
        }
      });
    } finally {
      // The synthetic edition starts no further form after this test.
      if (formEdition) {
        await db
          .update(valoManualLibrary)
          .set({ state: "withdrawn", closedBy: formEdition.editor, closedAt: new Date() })
          .where(eq(valoManualLibrary.id, formEdition.id));
        await db
          .update(valoStaffAssignments)
          .set({ active: false })
          .where(eq(valoStaffAssignments.identityId, formEdition.editor));
      }
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
