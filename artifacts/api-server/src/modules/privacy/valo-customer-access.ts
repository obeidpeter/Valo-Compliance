import { randomUUID, createHash } from "node:crypto";
import { createPrivacyCase } from "./valo-privacy";
import { and, eq, desc, like, sql } from "drizzle-orm";
import { setImmediate as yieldPreparation } from "node:timers/promises";
import { abortable } from "../../lib/valo-abort";
import {
  db,
  valoAccessSupport,
  valoSupportTickets,
  valoProfileVersions,
  valoDocuments,
  valoDocumentRevisions,
  valoAssessments,
  valoTasks,
  valoReminderPreferences,
  valoReminderOutbox,
  valoAIDrafts,
  valoExportJobs,
  valoWorkspaceExports,
  valoFileAssets,
  valoEvents,
  valoSavedTemplates,
  valoSupportCases,
  valoSupportMessages,
} from "@workspace/db";
import { RequestAccessSupportBody } from "@workspace/api-zod";
import { consumeQuota, quotaLimit, quotaSubjectHash } from "../../lib/valo-quota";
import { authorizeWorkspaceRead, type WorkspaceActor } from "../workspaces";
import { ValoProblem } from "../../platform/valo-problem";
import {
  valoOrders,
  valoEntitlements,
  valoPurchaseOutbox,
  valoRefundRequests,
  valoPaymentReconciliations,
  valoPrivacyMessages,
  valoPrivacyCases,
  valoRefundTransitions,
  valoPaymentDisputes,
  valoDisputeTransitions,
  valoPaymentEvents,
} from "@workspace/db";
import { valoDisputeInformation, valoDisputeActions } from "@workspace/db";
import { ownedPaymentEvent } from "./valo-private-copy-inventory";
import { valoPaymentConcerns, valoConcernMessages, valoPaymentConcernEvents } from "@workspace/db";
import { setting } from "../../platform/settings";
export const accessMessage =
  "Request received and saved. No account details have been confirmed. Replies are not yet dispatched from this development build.";
const ack = (id: string) => ({
  reference: `VALO-ACCESS-${id}`,
  message: accessMessage,
  delivery: "not_dispatched" as const,
});
export async function saveAccessSupport(raw: unknown, remoteAddress: string) {
  const input = RequestAccessSupportBody.strict().parse(raw);
  const data = { email: input.email.trim().toLowerCase(), topic: input.topic, message: input.message.trim() };
  if (data.message.length < 20)
    throw new ValoProblem(422, "Please include at least 20 characters describing the problem.");
  const payloadHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  return db.transaction(async (tx) => {
    const id = randomUUID();
    const inserted = await tx
      .insert(valoAccessSupport)
      .values({
        id,
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        contactEmail: data.email,
        topic: data.topic,
        message: data.message,
        noticeVersion: "development-access-support-1",
      })
      .onConflictDoNothing({ target: valoAccessSupport.idempotencyKey })
      .returning();
    if (!inserted.length) {
      const [old] = await tx
        .select()
        .from(valoAccessSupport)
        .where(eq(valoAccessSupport.idempotencyKey, input.idempotencyKey));
      if (!old || old.payloadHash !== payloadHash)
        throw new ValoProblem(409, "This request key was already used. Start a new request.");
      return ack(old.id);
    }
    // Socket address only: hostile Forwarded/X-Forwarded-For cannot choose a quota identity.
    // One contact address, one network address and everyone together, each with ceilings of its own.
    for (const [kind, value, minute, day] of [
      ["user", `access-contact:${data.email}`, "public-support", "public-support-day"],
      ["ip", `access-socket:${remoteAddress}`, "public-support-socket", "public-support-socket-day"],
      ["user", "access-intake-global", "public-support-all", "public-support-all-day"],
    ] as const) {
      const hash = quotaSubjectHash(setting("SESSION_SECRET"), kind, value);
      for (const [bucket, window] of [
        [minute, "minute"],
        [day, "day"],
      ] as const) {
        const q = await consumeQuota(bucket, hash, quotaLimit(bucket), window, tx);
        if (!q.allowed)
          throw new ValoProblem(
            429,
            `Please retry in ${q.retryAfter} seconds. No new request was saved.`,
            undefined,
            q.retryAfter,
          );
      }
    }
    const { openSupportCase } = await import("../support");
    await openSupportCase(tx, "access", id, null);
    return ack(id);
  });
}
export async function customerAccount(actor: WorkspaceActor) {
  return db.transaction(async (tx) => {
    await authorizeWorkspaceRead(tx, actor);
    const rows = await tx
      .select()
      .from(valoSupportTickets)
      .where(
        and(
          eq(valoSupportTickets.workspaceId, actor.workspaceId),
          like(valoSupportTickets.scope, "Privacy request (%"),
        ),
      )
      .orderBy(desc(valoSupportTickets.createdAt))
      .limit(100);
    return {
      workspaceId: actor.workspaceId,
      privacyRequests: rows.map((r) => ({
        reference: `VALO-${r.id}`,
        request: r.scope,
        status: r.dispatchStatus,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  });
}
export async function requestPrivacy(actor: WorkspaceActor, email: string, raw: unknown) {
  return createPrivacyCase(actor, email, raw);
}
/**
 * An export pins a snapshot transaction for its whole run, and checks access on separate
 * short transactions so a revocation is seen at once. It therefore needs two pooled
 * connections at a time. Capping concurrent exports in each process keeps them from
 * taking the connections every other request needs. The worker runs one at a time.
 */
export const MAX_CONCURRENT_WORKSPACE_EXPORTS = 2;
let activeWorkspaceExports = 0;
export async function workspaceDataExport(
  actor: WorkspaceActor,
  sink?: (chunk: string) => Promise<void>,
  signal?: AbortSignal,
  onPage?: (section: string, rows: number) => Promise<void>,
) {
  signal?.throwIfAborted();
  if (activeWorkspaceExports >= MAX_CONCURRENT_WORKSPACE_EXPORTS)
    throw new ValoProblem(
      503,
      "Workspace data exports are busy. Nothing was changed; try again in a minute.",
      undefined,
      30,
    );
  activeWorkspaceExports++;
  try {
    return await snapshotExport(actor, sink, signal, onPage);
  } finally {
    activeWorkspaceExports--;
  }
}
async function snapshotExport(
  actor: WorkspaceActor,
  sink?: (chunk: string) => Promise<void>,
  signal?: AbortSignal,
  onPage?: (section: string, rows: number) => Promise<void>,
) {
  const currentAccess = () =>
    abortable(signal, () => db.transaction((tx) => authorizeWorkspaceRead(tx, actor)));
  await currentAccess();
  return db.transaction(
    async (tx) => {
      // Pin only source data, not authorization. Revocation is checked through
      // separate READ COMMITTED reads and never waits for this snapshot to end.
      await tx.execute(sql`set local statement_timeout='2000ms'`);
      await tx.execute(sql`set local idle_in_transaction_session_timeout='15000ms'`);
      await tx.execute(sql`select pg_current_snapshot()`);
      signal?.throwIfAborted();
      const header = {
        schemaVersion: 2,
        exportedAt: new Date().toISOString(),
        workspaceId: actor.workspaceId,
        scope:
          "Only the named application sections under data are included; this is not complete privacy fulfilment. Includes all historical application rows, linked financial event metadata, privacy case/result metadata and your own activity, but not private file bytes/storage locators. Previously prepared full workspace snapshots are deliberately not nested in new exports; their source records are exported directly. Private finance evidence/intent payloads, memberships, other people's activity, shared safety/usage/staff audits, managed identity, external processor copies and unlinked public contact intake are excluded. No ownership is inferred from a matching email.",
      };
      if (sink) await sink(JSON.stringify(header).slice(0, -1) + ',"data":{');
      const tables = {
        savedTemplates: valoSavedTemplates,
        profileVersions: valoProfileVersions,
        documents: valoDocuments,
        documentRevisions: valoDocumentRevisions,
        assessments: valoAssessments,
        tasks: valoTasks,
        reminderPreferences: valoReminderPreferences,
        reminderDeliveries: valoReminderOutbox,
        supportRequests: valoSupportTickets,
        aiDrafts: valoAIDrafts,
        orders: valoOrders,
        entitlements: valoEntitlements,
        purchaseMessages: valoPurchaseOutbox,
        refundRequests: valoRefundRequests,
        paymentReconciliations: valoPaymentReconciliations,
        privacyInformation: valoPrivacyMessages,
        disputeInformation: valoDisputeInformation,
        refundHistory: valoRefundTransitions,
        disputes: valoPaymentDisputes,
        disputeHistory: valoDisputeTransitions,
      };
      const data: Record<string, unknown> = {};
      let bytes = 0;
      let sections = 0;
      const counts: Record<string, number> = {};
      const collect = async <T>(name: string, query: (offset: number) => PromiseLike<T[]>) => {
        signal?.throwIfAborted();
        if (!sink) {
          append(name, await query(0));
          return;
        }
        await sink((sections++ ? "," : "") + JSON.stringify(name) + ":[");
        let offset = 0,
          first = true;
        for (;;) {
          signal?.throwIfAborted();
          await currentAccess();
          const rows = await query(offset);
          signal?.throwIfAborted();
          let produced = 0;
          for (const row of rows) {
            signal?.throwIfAborted();
            await sink((first ? "" : ",") + JSON.stringify(row));
            first = false;
            if (++produced % 25 === 0) await yieldPreparation(undefined, { signal });
          }
          counts[name] = (counts[name] ?? 0) + rows.length;
          await abortable(signal, async () => {
            await onPage?.(name, counts[name]!);
          });
          if (rows.length < 500) break;
          offset += rows.length;
        }
        await sink("]");
      };
      const append = (name: string, rows: unknown[]) => {
        if (rows.length > 5000)
          throw new ValoProblem(
            409,
            "This workspace needs an assisted full export. Submit a privacy export request; no partial file was returned.",
          );
        bytes += Buffer.byteLength(JSON.stringify(rows));
        if (bytes > 8_000_000)
          throw new ValoProblem(
            409,
            "This workspace needs an assisted full export. Submit a privacy export request; no partial file was returned.",
          );
        data[name] = rows;
      };
      for (const [name, table] of Object.entries(tables)) {
        await collect(name, (offset) =>
          tx
            .select()
            .from(table)
            .where(eq(table.workspaceId, actor.workspaceId))
            .orderBy("id" in table ? table.id : table.workspaceId)
            .limit(sink ? 500 : 5001)
            .offset(offset),
        );
      }
      // Payment concern text and public status/history only. Provider evidence,
      // private staff audit, receipt bytes, intent payloads and authority stay private.
      await collect("paymentConcerns", (offset) =>
        tx
          .select({
            id: valoPaymentConcerns.id,
            orderId: valoPaymentConcerns.orderId,
            message: valoPaymentConcerns.message,
            latestReply: valoPaymentConcerns.latestReply,
            status: valoPaymentConcerns.status,
            version: valoPaymentConcerns.version,
            createdAt: valoPaymentConcerns.createdAt,
            updatedAt: valoPaymentConcerns.updatedAt,
          })
          .from(valoPaymentConcerns)
          .where(eq(valoPaymentConcerns.workspaceId, actor.workspaceId))
          .orderBy(valoPaymentConcerns.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("paymentConcernMessages", (offset) =>
        tx
          .select({
            id: valoConcernMessages.id,
            concernId: valoConcernMessages.concernId,
            body: valoConcernMessages.body,
            createdAt: valoConcernMessages.createdAt,
          })
          .from(valoConcernMessages)
          .where(eq(valoConcernMessages.workspaceId, actor.workspaceId))
          .orderBy(valoConcernMessages.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("paymentConcernHistory", (offset) =>
        tx
          .select({
            id: valoPaymentConcernEvents.id,
            orderId: valoPaymentConcernEvents.orderId,
            concernId: valoPaymentConcernEvents.concernId,
            action: valoPaymentConcernEvents.action,
            reason: valoPaymentConcernEvents.reason,
            actorType: valoPaymentConcernEvents.actorType,
            createdAt: valoPaymentConcernEvents.createdAt,
          })
          .from(valoPaymentConcernEvents)
          .where(
            and(
              eq(valoPaymentConcernEvents.workspaceId, actor.workspaceId),
              eq(valoPaymentConcernEvents.customerVisible, true),
            ),
          )
          .orderBy(valoPaymentConcernEvents.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("disputeIntents", (offset) =>
        tx
          .select({
            id: valoDisputeActions.id,
            orderId: valoDisputeActions.orderId,
            disputeId: valoDisputeActions.disputeId,
            kind: valoDisputeActions.kind,
            status: valoDisputeActions.status,
            createdAt: valoDisputeActions.createdAt,
            updatedAt: valoDisputeActions.updatedAt,
          })
          .from(valoDisputeActions)
          .where(eq(valoDisputeActions.workspaceId, actor.workspaceId))
          .orderBy(valoDisputeActions.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("paymentEvents", (offset) =>
        tx
          .select()
          .from(valoPaymentEvents)
          .where(ownedPaymentEvent(actor.workspaceId))
          .orderBy(valoPaymentEvents.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("privacyRequests", (offset) =>
        tx
          .select({
            id: valoPrivacyCases.id,
            workspaceId: valoPrivacyCases.workspaceId,
            kind: valoPrivacyCases.kind,
            message: valoPrivacyCases.message,
            status: valoPrivacyCases.status,
            steps: valoPrivacyCases.steps,
            resultScope: valoPrivacyCases.resultScope,
            preparedResultAvailable: sql<boolean>`${valoPrivacyCases.resultJson} IS NOT NULL`,
            preparedResultKind: sql<string | null>`${valoPrivacyCases.resultJson}->>'kind'`,
            correctedProfileVersionId: sql<
              string | null
            >`CASE WHEN ${valoPrivacyCases.resultJson}->>'kind'='business_profile_correction'
        THEN ${valoPrivacyCases.resultJson}->>'profileVersionId' ELSE NULL END`,
            createdAt: valoPrivacyCases.createdAt,
            updatedAt: valoPrivacyCases.updatedAt,
          })
          .from(valoPrivacyCases)
          .where(eq(valoPrivacyCases.workspaceId, actor.workspaceId))
          .orderBy(valoPrivacyCases.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      // Explicit projections: never include storage locators, queue identifiers or leases.
      await collect("workspaceDataExports", (offset) =>
        tx
          .select({
            id: valoWorkspaceExports.id,
            status: valoWorkspaceExports.status,
            version: valoWorkspaceExports.version,
            attempts: valoWorkspaceExports.attempts,
            createdAt: valoWorkspaceExports.createdAt,
            expiresAt: valoWorkspaceExports.expiresAt,
            snapshotAt: valoWorkspaceExports.snapshotAt,
            size: valoWorkspaceExports.size,
            counts: valoWorkspaceExports.counts,
            scope: valoWorkspaceExports.scope,
            errorCode: valoWorkspaceExports.errorCode,
          })
          .from(valoWorkspaceExports)
          .where(
            and(
              eq(valoWorkspaceExports.workspaceId, actor.workspaceId),
              eq(valoWorkspaceExports.requesterId, actor.identityId),
            ),
          )
          .orderBy(valoWorkspaceExports.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("supportCases", (offset) =>
        tx
          .select({
            id: valoSupportCases.id,
            workspaceId: valoSupportCases.workspaceId,
            ticketId: valoSupportCases.ticketId,
            status: valoSupportCases.status,
            version: valoSupportCases.version,
            createdAt: valoSupportCases.createdAt,
            updatedAt: valoSupportCases.updatedAt,
          })
          .from(valoSupportCases)
          .where(eq(valoSupportCases.workspaceId, actor.workspaceId))
          .orderBy(valoSupportCases.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("supportReplies", (offset) =>
        tx
          .select({
            id: valoSupportMessages.id,
            workspaceId: valoSupportMessages.workspaceId,
            caseId: valoSupportMessages.caseId,
            authorKind: valoSupportMessages.authorKind,
            body: valoSupportMessages.body,
            createdAt: valoSupportMessages.createdAt,
          })
          .from(valoSupportMessages)
          .where(
            and(
              eq(valoSupportMessages.workspaceId, actor.workspaceId),
              eq(valoSupportMessages.visibility, "customer"),
            ),
          )
          .orderBy(valoSupportMessages.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("exportJobs", (offset) =>
        tx
          .select({
            id: valoExportJobs.id,
            workspaceId: valoExportJobs.workspaceId,
            documentId: valoExportJobs.documentId,
            revisionId: valoExportJobs.revisionId,
            revision: valoExportJobs.revision,
            format: valoExportJobs.format,
            renderVersion: valoExportJobs.renderVersion,
            sourceHash: valoExportJobs.sourceHash,
            status: valoExportJobs.status,
            attempts: valoExportJobs.attempts,
            errorCode: valoExportJobs.errorCode,
            createdAt: valoExportJobs.createdAt,
            updatedAt: valoExportJobs.updatedAt,
          })
          .from(valoExportJobs)
          .where(eq(valoExportJobs.workspaceId, actor.workspaceId))
          .orderBy(valoExportJobs.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("fileMetadata", (offset) =>
        tx
          .select({
            id: valoFileAssets.id,
            workspaceId: valoFileAssets.workspaceId,
            jobId: valoFileAssets.jobId,
            checksum: valoFileAssets.checksum,
            mime: valoFileAssets.mime,
            size: valoFileAssets.size,
            retentionAt: valoFileAssets.retentionAt,
            createdAt: valoFileAssets.createdAt,
          })
          .from(valoFileAssets)
          .where(eq(valoFileAssets.workspaceId, actor.workspaceId))
          .orderBy(valoFileAssets.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      await collect("yourActivity", (offset) =>
        tx
          .select()
          .from(valoEvents)
          .where(and(eq(valoEvents.workspaceId, actor.workspaceId), eq(valoEvents.actorId, actor.identityId)))
          .orderBy(valoEvents.id)
          .limit(sink ? 500 : 5001)
          .offset(offset),
      );
      signal?.throwIfAborted();
      await currentAccess();
      if (sink) await sink('},"counts":' + JSON.stringify(counts) + ',"complete":true}');
      return { ...header, data, counts };
    },
    { isolationLevel: "repeatable read" },
  );
}
