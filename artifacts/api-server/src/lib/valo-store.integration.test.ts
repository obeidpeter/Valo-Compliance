import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  valoDocuments,
  valoDocumentRevisions,
  valoEvents,
  valoMemberships,
  valoProfileVersions,
  valoSupportCases,
  valoSupportTickets,
  valoWorkspaces,
} from "@workspace/db";
import * as store from "./valo-store";
import { resolveWorkspace, getWorkspace, saveProfile } from "../modules/workspaces";
import { syntheticDocument, syntheticProfile } from "./valo-test-fixtures";

test(
  "development PostgreSQL tenant, concurrency, history and durable-ticket proof",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
  },
  async (t) => {
    assert.notEqual(process.env.NODE_ENV, "production", "This test must never target production");
    const run = randomUUID();
    const identityA = `synthetic-test-a-${run}`,
      identityB = `synthetic-test-b-${run}`;
    const a = await resolveWorkspace(identityA),
      b = await resolveWorkspace(identityB);
    const workspaces = [a.workspaceId, b.workspaceId];
    try {
      await t.test("server membership resolution is idempotent and tenants are separate", async () => {
        assert.deepEqual(await resolveWorkspace(identityA), a);
        assert.notEqual(a.workspaceId, b.workspaceId);
        assert.equal((await getWorkspace(a)).profile, null);
      });
      await t.test(
        "profile correction appends history, preserves declined marketing and rejects stale saves",
        async () => {
          const first = await saveProfile(a, { expectedRevision: 0, profile: syntheticProfile });
          assert.equal(first.profileRevision, 1);
          assert.equal(first.profile.marketingConsent, false);
          await saveProfile(a, {
            expectedRevision: 1,
            profile: { ...syntheticProfile, state: "Bayelsa" },
          });
          await assert.rejects(saveProfile(a, { expectedRevision: 1, profile: syntheticProfile }), {
            status: 409,
          });
          const versions = await db
            .select()
            .from(valoProfileVersions)
            .where(eq(valoProfileVersions.workspaceId, a.workspaceId));
          assert.equal(versions.length, 2);
          assert.equal(versions.find((v) => v.revision === 1)!.profile.state, "unknown");
          assert.equal(versions.find((v) => v.revision === 2)!.profile.state, "Bayelsa");
          assert.equal((await getWorkspace(b)).profile, null);
        },
      );
      const document = await store.createDocument(a, syntheticDocument);
      await t.test("document and revision identifiers cannot expose a different tenant", async () => {
        assert.deepEqual(await store.listDocuments(b), []);
        await assert.rejects(store.getDocument(b, document.id), { status: 404 });
        await assert.rejects(store.listRevisions(b, document.id), { status: 404 });
        await assert.rejects(
          store.saveDocument(b, document.id, { ...syntheticDocument, expectedRevision: 1 }),
          { status: 404 },
        );
      });
      await t.test("two concurrent tabs produce exactly one new revision and one conflict", async () => {
        const results = await Promise.allSettled([
          store.saveDocument(a, document.id, {
            ...syntheticDocument,
            title: "Tab A synthetic",
            expectedRevision: 1,
          }),
          store.saveDocument(a, document.id, {
            ...syntheticDocument,
            title: "Tab B synthetic",
            expectedRevision: 1,
          }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        assert.equal(rejected.reason.status, 409);
        assert.equal((await store.getDocument(a, document.id)).revision, 2);
        const revisions = await store.listRevisions(a, document.id);
        assert.equal(revisions.length, 2);
        assert.equal(revisions.find((r) => r.revision === 1)!.contentHash, document.contentHash);
      });
      await t.test("restore appends a new revision without rewriting the original", async () => {
        const original = (await store.listRevisions(a, document.id)).find((r) => r.revision === 1)!;
        const restored = await store.saveDocument(a, document.id, {
          title: original.title,
          content: original.content,
          expectedRevision: 2,
        });
        assert.equal(restored.revision, 3);
        assert.equal(restored.contentHash, original.contentHash);
        assert.equal((await store.listRevisions(a, document.id)).length, 3);
      });
      await t.test(
        "enquiry acknowledgement follows a durable save, not an appointment or email claim",
        async () => {
          const receipt = await store.createTicket(a, {
            category: "support",
            scope: "Synthetic durability test",
            contactEmail: "synthetic@example.test",
            sharingConsent: false,
          });
          const [ticket] = await db
            .select()
            .from(valoSupportTickets)
            .where(
              and(
                eq(valoSupportTickets.id, receipt.reference.slice(5)),
                eq(valoSupportTickets.workspaceId, a.workspaceId),
              ),
            );
          assert.ok(ticket);
          assert.equal(ticket.dispatchStatus, "awaiting_staff");
          assert.equal(ticket.sharingConsent, false);
          const events = await db.select().from(valoEvents).where(eq(valoEvents.workspaceId, a.workspaceId));
          assert.ok(events.every((e) => !("content" in e) && !("scope" in e) && !("profile" in e)));
        },
      );
      await t.test(
        "a service enquiry needs consent, keeps what it captured, reaches the support queue and is received, not booked",
        async () => {
          const enquiry = {
            category: "tax",
            scope: "Synthetic service enquiry about filing dates",
            contactEmail: "synthetic-enquiry@example.test",
          };
          await assert.rejects(
            store.createTicket(a, { ...enquiry, sharingConsent: false }),
            /explicit contact-sharing consent/,
          );
          const receipt = await store.createTicket(a, { ...enquiry, sharingConsent: true });
          assert.match(receipt.message, /^Enquiry received and saved\./);
          assert.doesNotMatch(
            receipt.message,
            /\bbooked\b|booking confirmed|appointment (is )?(set|confirmed)/i,
          );
          const id = receipt.reference.slice(5);
          const [ticket] = await db
            .select()
            .from(valoSupportTickets)
            .where(and(eq(valoSupportTickets.id, id), eq(valoSupportTickets.workspaceId, a.workspaceId)));
          assert.ok(ticket);
          assert.equal(ticket.category, "tax");
          assert.equal(ticket.scope, enquiry.scope);
          assert.equal(ticket.contactEmail, enquiry.contactEmail);
          assert.equal(ticket.sharingConsent, true);
          assert.equal(ticket.dispatchStatus, "awaiting_staff");
          const cases = await db.select().from(valoSupportCases).where(eq(valoSupportCases.ticketId, id));
          assert.equal(cases.length, 1, "the enquiry opened exactly one support case for staff");
          assert.equal(cases[0]!.status, "open");
          assert.equal(cases[0]!.workspaceId, a.workspaceId);
        },
      );
      await t.test("suspended membership is not automatically restored", async () => {
        await db
          .update(valoMemberships)
          .set({ active: "no" })
          .where(eq(valoMemberships.identityId, identityB));
        await assert.rejects(resolveWorkspace(identityB), { status: 403 });
      });
    } finally {
      // Only these UUID-scoped synthetic records are removed. No real data or backups.
      await db.transaction(async (tx) => {
        await tx.delete(valoEvents).where(inArray(valoEvents.workspaceId, workspaces));
        await tx.delete(valoSupportTickets).where(inArray(valoSupportTickets.workspaceId, workspaces));
        await tx.delete(valoDocumentRevisions).where(inArray(valoDocumentRevisions.workspaceId, workspaces));
        await tx.delete(valoDocuments).where(inArray(valoDocuments.workspaceId, workspaces));
        await tx.delete(valoProfileVersions).where(inArray(valoProfileVersions.workspaceId, workspaces));
        await tx.delete(valoMemberships).where(inArray(valoMemberships.workspaceId, workspaces));
        await tx.delete(valoWorkspaces).where(inArray(valoWorkspaces.id, workspaces));
      });
      await pool.end();
    }
  },
);
