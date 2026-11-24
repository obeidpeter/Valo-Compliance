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
import { createTicket } from "../support";
import {
  listDocuments,
  getDocument,
  getDocumentForm,
  listRevisions,
  createDocument,
  saveDocument,
  startFormDocument,
} from "./valo-documents";
import { serializeRevision } from "./valo-revision-codec";
import { runInWorkspaceScope, valoManualLibrary, valoStaffAssignments } from "@workspace/db";
import { sha256 } from "@workspace/valo-core";
import { parseFormText } from "@workspace/valo-core/form-text";
import { formDocumentContent } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedDataV2 } from "@workspace/valo-core/guided-v2";
import { proposedFormText } from "../manual-library/form-text-maps";
import { GetDocumentResponse } from "@workspace/api-zod";
import { resolveWorkspace, getWorkspace, saveProfile } from "../workspaces";
import { syntheticDocument, syntheticProfile } from "../../lib/valo-test-fixtures";

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
      const document = await createDocument(a, syntheticDocument);
      await t.test("document and revision identifiers cannot expose a different tenant", async () => {
        assert.deepEqual(await listDocuments(b), []);
        await assert.rejects(getDocument(b, document.id), { status: 404 });
        await assert.rejects(listRevisions(b, document.id), { status: 404 });
        await assert.rejects(saveDocument(b, document.id, { ...syntheticDocument, expectedRevision: 1 }), {
          status: 404,
        });
      });
      await t.test("two concurrent tabs produce exactly one new revision and one conflict", async () => {
        const results = await Promise.allSettled([
          saveDocument(a, document.id, {
            ...syntheticDocument,
            title: "Tab A synthetic",
            expectedRevision: 1,
          }),
          saveDocument(a, document.id, {
            ...syntheticDocument,
            title: "Tab B synthetic",
            expectedRevision: 1,
          }),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
        assert.equal(rejected.reason.status, 409);
        assert.equal((await getDocument(a, document.id)).revision, 2);
        const revisions = await listRevisions(a, document.id);
        assert.equal(revisions.length, 2);
        assert.equal(revisions.find((r) => r.revision === 1)!.contentHash, document.contentHash);
      });
      await t.test("restore appends a new revision without rewriting the original", async () => {
        const original = (await listRevisions(a, document.id)).find((r) => r.revision === 1)!;
        const restored = await saveDocument(a, document.id, {
          title: original.title,
          content: original.content,
          expectedRevision: 2,
        });
        assert.equal(restored.revision, 3);
        assert.equal(restored.contentHash, original.contentHash);
        assert.equal((await listRevisions(a, document.id)).length, 3);
      });
      await t.test(
        "enquiry acknowledgement follows a durable save, not an appointment or email claim",
        async () => {
          const receipt = await createTicket(a, {
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
            createTicket(a, { ...enquiry, sharingConsent: false }),
            /explicit contact-sharing consent/,
          );
          const receipt = await createTicket(a, { ...enquiry, sharingConsent: true });
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
      await t.test(
        "a form document starts from the released invoice edition, saves only what its answers make, and keeps its edition after withdrawal",
        async () => {
          const inA = <T>(work: () => Promise<T>) => runInWorkspaceScope(a.workspaceId, work);
          const inB = <T>(work: () => Promise<T>) => runInWorkspaceScope(b.workspaceId, work);
          // Only a free template with a v2 form starts one.
          await assert.rejects(
            inA(() => startFormDocument(a, { templateId: "TPL-06" })),
            { status: 404 },
          );
          await assert.rejects(
            inA(() => startFormDocument(a, { templateId: "TPL-13" })),
            { status: 404 },
          );
          // A Content editor releases the invoice's form text in the staff library.
          const formText = (await proposedFormText("TPL-01"))!;
          const editor = `synthetic-form-editor-${run}`,
            edition = randomUUID();
          await db.insert(valoStaffAssignments).values({
            id: randomUUID(),
            identityId: editor,
            role: "content",
            grantedBy: "synthetic test",
            reason: "Synthetic form document test",
          });
          await db.insert(valoManualLibrary).values({
            id: edition,
            itemId: edition,
            version: 1,
            slug: "manual-" + edition,
            kind: "template",
            title: "Invoice",
            body: "Synthetic invoice description",
            digest: "a".repeat(64),
            fileFormat: "docx",
            fileBytes: Buffer.from("synthetic"),
            formText,
            createdBy: editor,
          });
          await db
            .update(valoManualLibrary)
            .set({ state: "published", publishedBy: editor, publishedAt: new Date() })
            .where(eq(valoManualLibrary.id, edition));
          // Responses as the contract types them.
          const typed = async (made: Promise<unknown>) => GetDocumentResponse.parse(await made);
          const started = await typed(inA(() => startFormDocument(a, { templateId: "TPL-01" })));
          assert.equal(started.title, "Invoice");
          assert.deepEqual(started.form, { version: 2, edition, digest: sha256(formText) });
          assert.equal(started.content.formAnswers?.templateId, "TPL-01");
          assert.ok(started.content.blocks.every((block) => block.id.startsWith("valo-guided-v2:TPL-01:")));
          assert.ok(
            started.content.blocks.filter((block) => block.type === "table").every((t) => t.headerRows === 1),
          );
          // The workspace's saved business name is filled in as the issuing business, and nothing
          // else; a workspace with no saved profile starts with the placeholder.
          assert.deepEqual(
            Object.entries(started.content.formAnswers?.values ?? {}).filter(([, value]) => value !== ""),
            [["issuerName", "Synthetic development business"]],
          );
          assert.equal(
            started.content.blocks[0]!.text,
            "Synthetic development business\n[Seller contact/address]",
          );
          const unnamed = await typed(inB(() => startFormDocument(b, { templateId: "TPL-01" })));
          assert.equal(unnamed.content.formAnswers?.values.issuerName, "");
          assert.equal(unnamed.content.blocks[0]!.text, "[Seller name]\n[Seller contact/address]");
          // Its form text is the workspace's own to read, and no other's.
          assert.equal((await inA(() => getDocumentForm(a, started.id))).formText, formText);
          await assert.rejects(
            inB(() => getDocumentForm(b, started.id)),
            { status: 404 },
          );
          const plainDocument = await createDocument(a, syntheticDocument);
          await assert.rejects(
            inA(() => getDocumentForm(a, plainDocument.id)),
            { status: 404 },
          );
          // A save keeps exactly what the answers make from the edition.
          const spec = GUIDED_SPECS_V2["TPL-01"]!,
            text = parseFormText(formText);
          const answers: GuidedDataV2 = structuredClone(started.content.formAnswers as GuidedDataV2);
          answers.values = {
            ...answers.values,
            issuerName: "Synthetic Supplies Ltd",
            recipientName: "Synthetic Buyer Ltd",
            documentNumber: "SYN-INV-002",
            issueDate: "2026-11-02",
            dueDate: "2026-11-30",
            billingBasis: "Synthetic supplies",
            taxMode: "none",
            discountMode: "none",
          };
          answers.tables.items = [
            {
              description: "Synthetic paper",
              quantity: "2",
              unit: "each",
              otherUnit: "",
              unitPriceKobo: "150000",
            },
          ];
          const contentFor = (data: GuidedDataV2) => {
            const { unfilled: _unfilled, ...content } = formDocumentContent(
              spec,
              text,
              data,
              started.content,
            );
            return content;
          };
          const saved = await typed(
            inA(() =>
              saveDocument(a, started.id, {
                expectedRevision: 1,
                title: "Invoice",
                content: contentFor(answers),
              }),
            ),
          );
          assert.equal(saved.revision, 2);
          assert.equal(saved.content.fields.issuerName, "Synthetic Supplies Ltd");
          assert.deepEqual(saved.form, started.form);
          assert.ok(
            saved.content.blocks.some((block) =>
              block.rows.some((row) => row.join(" | ") === "Invoice total | ₦3,000.00"),
            ),
          );
          assert.equal(
            saved.contentHash,
            sha256(serializeRevision({ title: "Invoice", content: contentFor(answers) })),
          );
          assert.match(
            serializeRevision({ title: "Invoice", content: contentFor(answers) }),
            /^valo-document-revision-v2\n/,
          );
          // Changed wording, answers the form does not take, and a save without answers are refused.
          const changed = contentFor(answers);
          changed.blocks = changed.blocks.map((block, i) =>
            i === 0 ? { ...block, text: "Synthetic other words" } : block,
          );
          await assert.rejects(
            inA(() =>
              saveDocument(a, started.id, { expectedRevision: 2, title: "Invoice", content: changed }),
            ),
            { status: 422, message: /comes from its released template/ },
          );
          await assert.rejects(
            inA(() =>
              saveDocument(a, started.id, {
                expectedRevision: 2,
                title: "Invoice",
                content: contentFor({ ...answers, values: { ...answers.values, unknownQuestion: "x" } }),
              }),
            ),
            { status: 422, message: /Some answers cannot be saved/ },
          );
          const { formAnswers: _answers, ...withoutAnswers } = contentFor(answers);
          await assert.rejects(
            inA(() =>
              saveDocument(a, started.id, { expectedRevision: 2, title: "Invoice", content: withoutAnswers }),
            ),
            { status: 422, message: /Save it with the form's answers/ },
          );
          // A document made like this one starts from the released edition with the answers it is
          // given and a title of its own; another form's answers, or an answer the form does not
          // take, are refused.
          const copied: GuidedDataV2 = {
            ...answers,
            values: { ...answers.values, documentNumber: "", issueDate: "", dueDate: "" },
          };
          const another = await typed(
            inA(() =>
              startFormDocument(a, {
                templateId: "TPL-01",
                title: "Invoice for Synthetic Buyer Ltd",
                formAnswers: copied,
              }),
            ),
          );
          assert.equal(another.title, "Invoice for Synthetic Buyer Ltd");
          assert.deepEqual(another.form, started.form);
          assert.deepEqual(another.content.formAnswers, copied);
          {
            const { unfilled: _unfilled, ...expected } = formDocumentContent(spec, text, copied);
            assert.deepEqual(another.content.blocks, expected.blocks);
          }
          await assert.rejects(
            inA(() =>
              startFormDocument(a, {
                templateId: "TPL-01",
                formAnswers: { ...copied, templateId: "TPL-02" },
              }),
            ),
            { status: 422, message: /belong to another form/ },
          );
          await assert.rejects(
            inA(() =>
              startFormDocument(a, {
                templateId: "TPL-01",
                formAnswers: { ...copied, values: { ...copied.values, unknownQuestion: "x" } },
              }),
            ),
            { status: 422, message: /Some answers cannot be saved/ },
          );
          // A plain document holds no form document's parts.
          const heading = {
            id: "section-2",
            type: "heading" as const,
            level: 2 as const,
            text: "Synthetic",
            rows: [],
          };
          await assert.rejects(
            createDocument(a, {
              ...syntheticDocument,
              content: { ...syntheticDocument.content, blocks: [heading] },
            }),
            { status: 422, message: /belong to a document started from a form/ },
          );
          await assert.rejects(
            saveDocument(a, plainDocument.id, {
              expectedRevision: 1,
              title: syntheticDocument.title,
              content: { ...syntheticDocument.content, formAnswers: answers },
            }),
            { status: 422, message: /belong to a document started from a form/ },
          );
          // The record never changes: the database refuses it (the query error's cause).
          await assert.rejects(
            db
              .update(valoDocuments)
              .set({ formDigest: "b".repeat(64) })
              .where(eq(valoDocuments.id, started.id)),
            (error: unknown) =>
              /keeps the form it was started with/.test(String((error as { cause?: unknown }).cause)),
          );
          // Withdrawn, the edition starts no new form; the document made from it stays its owner's.
          await db
            .update(valoManualLibrary)
            .set({ state: "withdrawn", closedBy: editor, closedAt: new Date() })
            .where(eq(valoManualLibrary.id, edition));
          await assert.rejects(
            inA(() => startFormDocument(a, { templateId: "TPL-01" })),
            { status: 409 },
          );
          const after = await inA(() =>
            saveDocument(a, started.id, {
              expectedRevision: 2,
              title: "Invoice",
              content: contentFor({
                ...answers,
                values: { ...answers.values, documentNumber: "SYN-INV-003" },
              }),
            }),
          );
          assert.equal(after.revision, 3);
          assert.equal((await inA(() => getDocumentForm(a, started.id))).edition, edition);
          await db
            .update(valoStaffAssignments)
            .set({ active: false })
            .where(eq(valoStaffAssignments.identityId, editor));
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
