import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, inArray, sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import {
  db,
  pool,
  currentWorkspaceScope,
  runInWorkspaceScope,
  valoDocumentRevisions,
  valoDocuments,
  valoEvents,
  valoExportJobs,
  valoExportObjects,
  valoExportRequests,
  valoFileAssets,
  valoMemberships,
  valoPrivacyCases,
  valoPrivacyEvents,
  valoProfileVersions,
  valoReminderOutbox,
  valoReminderPreferences,
  valoStaffAccessAudit,
  valoStaffAssignments,
  valoSupportActions,
  valoSupportCases,
  valoSupportEscalations,
  valoSupportEvents,
  valoSupportMessages,
  valoSupportTickets,
  valoTasks,
  valoWorkspaceExportAttempts,
  valoWorkspaceExports,
  valoWorkspaces,
} from "@workspace/db";
import { resolveWorkspace, saveProfile, createDocument } from "../lib/valo-store";
import { syntheticDocument, syntheticProfile } from "../lib/valo-test-fixtures";
import { requestExport, getExport, executeExport } from "../lib/valo-exports";
import { createWorkspaceExport, executeWorkspaceExport } from "../lib/valo-workspace-export-jobs";
import { fixtureWorkspaceStorage } from "../lib/test-support/workspace-export-storage";
import { createTask, saveReminderPreferences, reminderInstant } from "../modules/tasks/valo-tasks";
import { processReminder } from "../modules/tasks/valo-reminder-worker";
import { createPrivacyCase, confirmPrivacyCase, simpleStaffPrivacyAction } from "../lib/valo-privacy";
import { processPrivacyAction } from "../lib/valo-privacy-processing";

type Checkout = { scope: string | undefined; statements: string[] };

/**
 * Runs `run` while recording every connection the shared pool hands out: the workspace scope
 * it was taken in, which decides whether it acts as the scoped role, and the statements sent
 * on it.
 */
async function recorded(run: () => Promise<unknown>): Promise<Checkout[]> {
  const checkouts: Checkout[] = [];
  const target = pool as unknown as { connect: (callback?: unknown) => unknown };
  const connect = target.connect;
  const watch = (client: PoolClient, checkout: Checkout) => {
    const own = Object.prototype.hasOwnProperty.call(client, "query"),
      // oxlint-disable-next-line typescript/unbound-method -- the recorder calls it with the client
      query = client.query,
      // oxlint-disable-next-line typescript/unbound-method -- the recorder calls it with the client
      release = client.release;
    client.query = function (this: PoolClient, config: unknown, ...rest: unknown[]) {
      const text = typeof config === "string" ? config : (config as { text?: unknown } | null)?.text;
      if (typeof text === "string") checkout.statements.push(text);
      return (query as (...args: unknown[]) => unknown).call(this, config, ...rest);
    } as typeof client.query;
    client.release = function (this: PoolClient, ...args: unknown[]) {
      if (own) client.query = query;
      else delete (client as { query?: unknown }).query;
      client.release = release;
      return (release as (...a: unknown[]) => void).apply(this, args);
    } as typeof client.release;
    return client;
  };
  target.connect = function (callback?: unknown) {
    const checkout: Checkout = { scope: currentWorkspaceScope(), statements: [] };
    checkouts.push(checkout);
    if (typeof callback !== "function")
      return (connect.call(pool) as Promise<PoolClient>).then((client) => watch(client, checkout));
    return connect.call(pool, (error: unknown, client: PoolClient | undefined, done: unknown) =>
      (callback as (...args: unknown[]) => void)(error, client && watch(client, checkout), done),
    );
  };
  try {
    await run();
  } finally {
    target.connect = connect;
  }
  return checkouts;
}

const sending = (checkouts: Checkout[], pattern: RegExp) =>
  checkouts.filter((c) => c.statements.some((statement) => pattern.test(statement)));
const scopes = (checkouts: Checkout[]) => [...new Set(checkouts.map((c) => c.scope ?? "application role"))];

/**
 * Background work done for one workspace reads that workspace's data in its database scope, so
 * row-level security also keeps what it produces to the workspace's own rows, while each job's
 * claim, storage and result stay with the application role (decision 0008).
 */
test(
  "background work for one workspace reads it in that workspace's scope",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    const tag = randomUUID();
    const [a, b] = await Promise.all(
      ["a", "b"].map((side) => resolveWorkspace(`synthetic-scope-jobs-${tag}-${side}`)),
    );
    const owners = [a!.workspaceId, b!.workspaceId],
      operators: string[] = [],
      directory = await mkdtemp(join(tmpdir(), "valo-scope-jobs-"));
    try {
      const documents = new Map<string, { id: string; revisionId: string }>();
      for (const actor of [a!, b!]) {
        await saveProfile(actor, { expectedRevision: 0, profile: syntheticProfile });
        documents.set(actor.workspaceId, await createDocument(actor, syntheticDocument));
      }

      await t.test("a scope cannot switch to another workspace", () => {
        assert.throws(
          () => runInWorkspaceScope(a!.workspaceId, () => runInWorkspaceScope(b!.workspaceId, () => 1)),
          TypeError,
        );
        assert.equal(
          runInWorkspaceScope(a!.workspaceId, () =>
            runInWorkspaceScope(a!.workspaceId.toUpperCase(), () => currentWorkspaceScope()),
          ),
          a!.workspaceId,
        );
      });

      await t.test("a document export reads the document in the workspace's scope", async () => {
        const document = documents.get(a!.workspaceId)!;
        const requested = await requestExport(a!, document.id, randomUUID(), {
          revisionId: document.revisionId,
          format: "docx",
          acknowledgeDraft: true,
        });
        const { job } = await getExport(a!, requested.id);
        const storage = {
          write: async (_key: string, bytes: Buffer) => ({
            checksum: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.length,
          }),
          remove: async () => {},
        };
        const checkouts = await recorded(() =>
          executeExport(job.id, job.workspaceId, job.queueId, undefined, storage),
        );
        const reads = sending(checkouts, /from "valo_document_revisions"/);
        assert.ok(reads.length > 0, "the document was read");
        assert.deepEqual(scopes(reads), [a!.workspaceId]);
        const bookkeeping = sending(checkouts, /update "valo_export_jobs"/);
        assert.ok(bookkeeping.length > 0);
        assert.deepEqual(scopes(bookkeeping), ["application role"], "the claim and result stay unscoped");
        assert.equal((await getExport(a!, job.id)).job.status, "ready");
      });

      await t.test("a workspace data export gathers its data in the workspace's scope", async () => {
        const created = await createWorkspaceExport(a!, randomUUID());
        const [row] = await db
          .select()
          .from(valoWorkspaceExports)
          .where(eq(valoWorkspaceExports.id, created.id));
        const checkouts = await recorded(() =>
          executeWorkspaceExport(created.id, a!.workspaceId, row!.queueId, {
            storage: fixtureWorkspaceStorage(directory),
          }),
        );
        const reads = sending(checkouts, /from "valo_documents"/);
        assert.ok(reads.length > 0, "the documents section was read");
        assert.deepEqual(scopes(reads), [a!.workspaceId]);
        const claim = sending(checkouts, /insert into "valo_workspace_export_attempts"/);
        assert.equal(claim.length, 1);
        assert.deepEqual(scopes(claim), ["application role"], "the claim stays unscoped");
        const [ready] = await db
          .select()
          .from(valoWorkspaceExports)
          .where(eq(valoWorkspaceExports.id, created.id));
        assert.equal(ready!.status, "ready");
      });

      await t.test("a reminder is delivered entirely in its workspace's scope", async () => {
        const due = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
          now = new Date(+reminderInstant(due, 1) + 1);
        await saveReminderPreferences(a!, { enabled: true, offsets: [1], expectedRevision: 0 });
        const task = await createTask(a!, {
          title: "Synthetic scope reminder",
          notes: "Synthetic only",
          dueDate: due,
          dateConfirmed: true,
          assessmentId: null,
          ruleId: null,
        });
        const [reminder] = await db
          .select()
          .from(valoReminderOutbox)
          .where(eq(valoReminderOutbox.taskId, task.id));
        const recipients: string[] = [];
        const sender = {
          send: async (input: { ownerIdentityId: string }) => {
            recipients.push(input.ownerIdentityId);
            return { providerMessageId: "synthetic-scope-acknowledgement" };
          },
        };
        let status: unknown;
        const checkouts = await recorded(async () => {
          status = await processReminder(a!.workspaceId, reminder!.id, sender, now);
        });
        assert.equal(status, "sent");
        assert.deepEqual(recipients, [a!.identityId]);
        assert.ok(checkouts.length >= 3, "the workspace, the claim and the delivery");
        assert.deepEqual(scopes(checkouts), [a!.workspaceId]);
        // Another workspace's scope cannot see the reminder at all.
        await assert.rejects(processReminder(b!.workspaceId, reminder!.id, sender, now), { status: 404 });
      });

      await t.test(
        "a staff privacy export gathers the requester's data in that workspace's scope",
        async () => {
          const staff = {
            identityId: `synthetic-scope-jobs-staff-${tag}`,
            recentMfa: true,
            verifiedAt: Date.now(),
          };
          operators.push(staff.identityId);
          await db.insert(valoStaffAssignments).values({
            id: randomUUID(),
            identityId: staff.identityId,
            role: "privacy",
            grantedBy: "synthetic",
            reason: "Synthetic scope check; no real account is granted access.",
          });
          const request = await createPrivacyCase(a!, "synthetic@example.invalid", {
            kind: "export",
            idempotencyKey: randomUUID(),
            message: "Synthetic privacy export for the scope check only.",
            acknowledgement: true,
          });
          const id = request.reference.slice(5);
          let result = await confirmPrivacyCase(a!, id, { expectedVersion: 1, acknowledgement: true });
          result = await simpleStaffPrivacyAction(staff, id, {
            expectedVersion: result.request.version,
            action: "claim",
            reason: "Synthetic assignment for the scope check.",
          });
          let prepared: Awaited<ReturnType<typeof processPrivacyAction>> | undefined;
          const checkouts = await recorded(async () => {
            prepared = await processPrivacyAction(staff, id, {
              expectedVersion: result.request.version,
              action: "prepare_export",
              reason: "Synthetic export for the scope check.",
            });
          });
          assert.equal((prepared as { request: { status: string } }).request.status, "partially_fulfilled");
          const reads = sending(checkouts, /from "valo_documents"/);
          assert.ok(reads.length > 0, "the documents section was read");
          assert.deepEqual(scopes(reads), [a!.workspaceId]);
          const cases = sending(checkouts, /update "valo_privacy_cases"/);
          assert.ok(cases.length > 0);
          assert.deepEqual(scopes(cases), ["application role"], "the case itself stays with staff");
        },
      );
    } finally {
      await db.transaction(async (tx) => {
        // Replica mode skips the append-only triggers and foreign key cascades, so each table
        // these synthetic workspaces touched is cleared explicitly.
        await tx.execute(sql`SET LOCAL session_replication_role=replica`);
        const cases = tx
          .select({ id: valoSupportCases.id })
          .from(valoSupportCases)
          .where(inArray(valoSupportCases.workspaceId, owners));
        for (const table of [valoSupportActions, valoSupportEvents, valoSupportEscalations])
          await tx.delete(table).where(inArray(table.caseId, cases));
        const privacy = tx
          .select({ id: valoPrivacyCases.id })
          .from(valoPrivacyCases)
          .where(inArray(valoPrivacyCases.workspaceId, owners));
        await tx.delete(valoPrivacyEvents).where(inArray(valoPrivacyEvents.caseId, privacy));
        for (const table of [
          valoPrivacyCases,
          valoExportRequests,
          valoFileAssets,
          valoExportObjects,
          valoExportJobs,
          valoWorkspaceExportAttempts,
          valoWorkspaceExports,
          valoReminderOutbox,
          valoReminderPreferences,
          valoTasks,
          valoDocumentRevisions,
          valoDocuments,
          valoProfileVersions,
          valoSupportMessages,
          valoSupportCases,
          valoSupportTickets,
          valoEvents,
          valoMemberships,
        ])
          await tx.delete(table).where(inArray(table.workspaceId, owners));
        await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, owners));
        if (operators.length) {
          await tx.delete(valoStaffAccessAudit).where(inArray(valoStaffAccessAudit.actorId, operators));
          await tx.delete(valoStaffAssignments).where(inArray(valoStaffAssignments.identityId, operators));
        }
      });
      await rm(directory, { recursive: true, force: true });
      await pool.end();
    }
  },
);
