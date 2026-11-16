import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import {
  contractOperations,
  pathParameters,
  type ContractOperation,
} from "../test-support/contract-operations";

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
 * The real app runs: every middleware, router, error handler and PostgreSQL query.
 * Only the identity provider is controlled in this process. Synthetic records only.
 */

/** Operations whose identifier is not owned by a workspace, with the reason. */
const NOT_WORKSPACE_OWNED: Record<string, string> = {
  "POST /workspace/templates/{id}/draft":
    "Public catalogue template identifier; the draft is created in the caller's own workspace.",
  "GET /workspace/templates/{id}/files/{format}":
    "Public catalogue template identifier. Its entitlement check needs released content, which tests may not create; not yet covered.",
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
  "PATCH /workspace/tasks/{id}",
  "DELETE /workspace/tasks/{id}",
] as const;

function customerOperations(): ContractOperation[] {
  return contractOperations().filter(
    (o) => (o.path.startsWith("/workspace/") || o.path.startsWith("/v1/")) && o.path.includes("{"),
  );
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
    const { db, pool, valoAIDrafts, valoOrders, valoPrices } = await import("@workspace/db");
    const { resolveWorkspace, saveProfile } = await import("../lib/valo-store");
    const { syntheticDocument, syntheticProfile } = await import("../lib/valo-test-fixtures");
    const { financeHeldFixture } = await import("../lib/valo-finance-test-fixture");
    const { createPrivacyCase } = await import("../lib/valo-privacy");

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

      await t.test("another workspace's identifiers inside request bodies are refused", async () => {
        const attacker = identity("body-references");
        const ownDocument = json(await call(attacker, "POST", "/workspace/documents", syntheticDocument)) as {
          id: string;
        };
        const before = await ownerState();
        for (const [path, body, headers] of [
          [
            `/v1/documents/${ownDocument.id}/exports`,
            (revisionId: string) => ({ revisionId, format: "pdf", acknowledgeDraft: true }),
            () => ({ "Idempotency-Key": randomUUID() }),
          ],
          [
            "/workspace/tasks",
            (assessmentId: string) => ({
              title: "Synthetic task linked to another business",
              notes: "",
              dueDate: null,
              dateConfirmed: false,
              assessmentId,
              ruleId: null,
            }),
            () => ({}),
          ],
        ] as const) {
          const reference = path.startsWith("/v1/") ? document.revisionId : assessments[0]!;
          const foreign = await call(attacker, "POST", path, body(reference), headers());
          const unknown = await call(attacker, "POST", path, body(randomUUID()), headers());
          assert.ok(foreign.status >= 400 && foreign.status < 500, `${path} answered ${foreign.status}`);
          assert.equal(foreign.status, unknown.status, path);
        }
        assert.equal(await ownerState(), before);
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
    } finally {
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
