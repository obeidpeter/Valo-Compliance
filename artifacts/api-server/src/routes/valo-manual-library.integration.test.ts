import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express, { type Request, type Response, type NextFunction } from "express";
import { eq, sql } from "drizzle-orm";
import { coveragePlan } from "@workspace/valo-core";
import { strToU8, unzipSync, zipSync } from "fflate";
import { ValoProblem } from "../platform/valo-problem";
import { wordFromText } from "../modules/manual-library/files";
import { exerciseManualRegulatoryOwner } from "../test-support/manual-regulatory-owner";
import {
  exercisePremiumFormDocument,
  exercisePremiumManualTemplate,
} from "../test-support/manual-premium-template";
import { exercisePremiumPriceCommand } from "../test-support/premium-price-command";
import { exerciseOverduePremiumTemplate } from "../test-support/manual-overdue-premium";
import { exerciseWithdrawalReach } from "../test-support/manual-withdrawal-reach";
import {
  changeNote,
  libraryAction,
  templateDetails,
  withdrawalReason,
} from "../test-support/template-details";
import { exerciseOwnerRuleRoutes } from "../test-support/owner-rule-routes";
import {
  GetManualLibraryRevisionResponse,
  GetPublicCoverageResponse,
  GetPublicDiscoveryResponse,
  GetReleasedResourceResponse,
  GetReleasedTemplateResponse,
  ListManualLibraryResponse,
  ListPublicCatalogueResponse,
  ListRetainedDraftsResponse,
  ListSavedTemplatesResponse,
  LoadRetainedDraftsResponse,
  CreateTemplateDraftResponse,
  ListDocumentEditionsResponse,
  ListEditionNoticesResponse,
} from "@workspace/api-zod";
import { registeredManualGuidance } from "../modules/manual-guidance/regulatory-evidence";

test("consumer Gazette checks bind the exact reviewed pages and expire when the amendment search expires", async () => {
  const { checkConsumerGazette } = await import("../modules/manual-guidance/consumer-gazette");
  const { readGuidanceIntake } = await import("../modules/publication");
  const observed = {
    url: "https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf",
    leadId: "FCCPC-GAZETTE-2018",
    rawChecksum: "aa942cdef860387e8f984de52666e5683d12d6e2813cb47b10335e0bf82a07f5",
    checkedAt: "2026-11-22T17:00:00Z",
    text: "Unused OCR",
    mime: "application/pdf",
    retrieval: "official_url" as const,
  };
  const reviewedAt = new Date(observed.checkedAt);
  for (const id of ["GUD-16", "GUD-17", "GUD-18"]) {
    const { section } = await readGuidanceIntake(id);
    assert.deepEqual(checkConsumerGazette(id, section.body, observed, reviewedAt).holds, []);
    assert.ok(checkConsumerGazette(id, section.body + " correction", observed, reviewedAt).holds.length);
    assert.ok(
      checkConsumerGazette(id, section.body, { ...observed, rawChecksum: "c".repeat(64) }, reviewedAt).holds
        .length,
    );
    assert.ok(checkConsumerGazette(id, section.body, observed, new Date("2027-01-01")).holds.length);
  }
});

function samplePdf(text: string) {
  const lines = Array.from({ length: 9 }, () => "(" + text + ") Tj T*").join("\n");
  const stream = "BT /F1 12 Tf 14 TL 50 700 Td\n" + lines + "\nET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Length " + stream.length + " >>\nstream\n" + stream + "\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(pdf.length);
    pdf += String(offsets.length - 1) + " 0 obj\n" + obj + "\nendobj\n";
  }
  const start = pdf.length;
  pdf +=
    "xref\n0 6\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((o) => String(o).padStart(10, "0") + " 00000 n \n")
      .join("") +
    "trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n" +
    start +
    "\n%%EOF\n";
  return Buffer.from(pdf);
}
test(
  "retained official PDFs keep their retrieval date and require the pinned edition",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only" },
  async () => {
    const { readRetainedOfficialPdf, referenceFor } = await import("../modules/sources");
    const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { createHash } = await import("node:crypto");
    const folder = await mkdtemp(join(tmpdir(), "valo-synthetic-source-"));
    try {
      const bytes = samplePdf("Synthetic official source check"),
        rawSha256 = createHash("sha256").update(bytes).digest("hex");
      const retrievedAt = "2026-11-22T11:00:00Z",
        now = new Date("2026-11-22T12:00:00Z");
      const receipt = {
        leadId: "S04",
        url: referenceFor("S04").url,
        httpStatus: 200,
        rawSha256,
        retrievedAt,
      };
      await writeFile(join(folder, "S04.pdf"), bytes);
      await writeFile(join(folder, "S04.json"), JSON.stringify(receipt));
      const found = await readRetainedOfficialPdf("S04", folder, rawSha256, now);
      assert.equal(found.retrieval, "retained_official_pdf");
      assert.equal(Date.parse(found.checkedAt), Date.parse(retrievedAt));
      assert.match(found.text, /Synthetic official source check/);
      await assert.rejects(readRetainedOfficialPdf("S04", folder, "a".repeat(64), now), /BINDING_INVALID/);
      await assert.rejects(
        readRetainedOfficialPdf("S04", folder, rawSha256, new Date(+now + 86_400_000)),
        /BINDING_INVALID/,
      );
      await writeFile(
        join(folder, "S04.json"),
        JSON.stringify({ ...receipt, url: "https://example.invalid/wrong" }),
      );
      await assert.rejects(readRetainedOfficialPdf("S04", folder, rawSha256, now), /BINDING_INVALID/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);
test(
  "manual publishing through staff HTTP routes and public readers",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 240000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, pool, valoStaffAssignments, valoManualLibrary } = await import("@workspace/db");
    const { makeStaffGate } = await import("../middlewares/valo-staff-gate");
    const { createManualLibraryRouter, premiumManualTemplateRouter } = await import("./valo-manual-library");
    const { default: publicRouter } = await import("./valo");
    const editor = "synthetic-editor-" + randomUUID(),
      other = "synthetic-support-" + randomUUID();
    await db.insert(valoStaffAssignments).values(
      [
        { identityId: editor, role: "content" as const },
        { identityId: other, role: "support" as const },
      ].map((row) => ({
        ...row,
        id: randomUUID(),
        grantedBy: "synthetic test",
        reason: "Synthetic manual publishing test",
      })),
    );
    const authenticate = async (req: Request) => {
      const identityId = req.get("x-test-identity");
      if (!identityId) throw new ValoProblem(401, "Sign in.");
      return {
        identityId,
        mfaEnrolled: true,
        recentMfa: req.get("x-test-mfa") !== "stale",
        verifiedAt: Date.now(),
      };
    };
    const app = express();
    app.use(express.json({ limit: "128kb", inflate: false }));
    app.use("/admin", makeStaffGate(authenticate));
    app.use(createManualLibraryRouter(authenticate));
    app.use(
      [
        "/workspace/manual-premium-templates",
        "/workspace/owned-template-editions",
        "/workspace/purchases",
        "/workspace/orders",
      ],
      async (req, res, next) => {
        const session = await authenticate(req);
        const { resolveWorkspace } = await import("../modules/workspaces");
        const { runInWorkspaceScope } = await import("@workspace/db");
        res.locals.valoActor = await resolveWorkspace(session.identityId);
        // The identity middleware gives checkout the account's address on record; here, a synthetic one.
        res.locals.valoContactEmail = session.identityId + "@example.invalid";
        runInWorkspaceScope(res.locals.valoActor.workspaceId, next);
      },
    );
    app.use(premiumManualTemplateRouter);
    const { commerceRouter } = await import("./valo-commerce");
    app.use(commerceRouter);
    const { staffOperations } = await import("../modules/staff");
    const { createSourceControlsRouter } = await import("./valo-source-controls");
    const { makeSupportOperationsRouter } = await import("./valo-support-lifecycle");
    app.get("/admin/operations", async (req, res) =>
      res.json(await staffOperations(await authenticate(req), "content")),
    );
    app.use(createSourceControlsRouter(authenticate));
    app.use(makeSupportOperationsRouter(authenticate));
    app.use(publicRouter);
    app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) =>
      res.status(err.status ?? (err.name === "ZodError" ? 422 : 500)).json({ error: err.message }),
    );
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((ok) => server.once("listening", ok));
    const origin = "http://127.0.0.1:" + String((server.address() as AddressInfo).port);
    const oldOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = origin;
    t.after(async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
      if (oldOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = oldOrigin;
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(eq(valoStaffAssignments.identityId, editor));
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(eq(valoStaffAssignments.identityId, other));
      await pool.end();
    });
    function call(path: string, body?: unknown, actor = editor, extra: Record<string, string> = {}) {
      return fetch(origin + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          origin,
          "x-test-identity": actor,
          "content-type": path.endsWith("/drafts")
            ? "application/vnd.valo.manual-draft+json"
            : "application/json",
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    }
    const item = (id: string) => "/admin/manual-library/" + id;
    const draft = (id: string, value: unknown, actor = editor, extra: Record<string, string> = {}) =>
      call(item(id) + "/drafts", value, actor, extra);
    const input = (kind: string, title: string, industry: string | null = null) => ({
      title,
      kind,
      industry,
      body: "Synthetic editorial text",
      fileMode: "text",
      baseVersion: 0,
      requestId: randomUUID(),
      // A template is released only with its entry details (docs/architecture/library-entries.md).
      ...(kind === "template" || kind === "premium_template" ? templateDetails : {}),
    });
    async function ok(r: globalThis.Response) {
      const body = await r.json();
      assert.equal(r.status, 200, JSON.stringify(body));
      return body;
    }
    const revision = async (r: globalThis.Response) => GetManualLibraryRevisionResponse.parse(await ok(r));
    const publicResource = async (id: string) =>
      GetReleasedResourceResponse.strict().parse(await ok(await call("/public/resources/manual-" + id)));
    const industryCoverage = async (slug: string) =>
      GetPublicCoverageResponse.parse(await ok(await call("/public/coverage"))).industries.find(
        (i) => i.slug === slug,
      )!;
    const act = (id: string, action: string, r: { version: number; digest: string }) =>
      call(item(id) + "/actions", libraryAction(action, r));
    const industry = coveragePlan().industries[0]!.slug;
    const billing = async () =>
      (
        await db.execute(
          sql`select (select count(*) from valo_inference_budget_events) as events,(select count(*) from valo_inference_batches) as batches,(select count(*) from valo_content_versions) as machine_versions`,
        )
      ).rows[0];
    const startBudget = await billing();
    await t.test("private drafts, same-origin writes, staff roles and fresh MFA", async () => {
      const id = randomUUID(),
        path = item(id),
        data = input("practical_guide", "Synthetic private guide");
      assert.equal((await call(path, undefined, "")).status, 401);
      assert.equal((await draft(id, data, "synthetic-customer")).status, 403);
      assert.equal((await draft(id, data, other)).status, 403);
      assert.equal((await draft(id, data, editor, { "x-test-mfa": "stale" })).status, 403);
      assert.equal((await draft(id, data, editor, { origin: "https://other.example.invalid" })).status, 403);
      assert.equal((await draft(id, data, editor, { "content-type": "application/json" })).status, 403);
      assert.equal((await draft(id, { ...data, industry: "unknown" })).status, 422);
      const row = await revision(await draft(id, data));
      assert.equal(row.createdBy, editor);
      assert.equal(row.live, null);
      assert.equal((await call("/public/resources/manual-" + id)).status, 404);
      assert.equal((await revision(await draft(id, data))).id, row.id);
      assert.equal((await draft(id, { ...data, title: "Another title" })).status, 409);
      assert.equal((await act(id, "publish", { ...row, digest: "0".repeat(64) })).status, 409);
      assert.equal((await call(path)).headers.get("cache-control"), "private, no-store");
    });
    await t.test("preview, publish, correct, replace and withdraw a practical guide", async () => {
      const id = randomUUID(),
        data = input("practical_guide", "Synthetic guide " + id, industry);
      const r1 = await revision(await draft(id, data));
      const live = await revision(await act(id, "publish", r1));
      assert.equal(live.publishedBy, editor);
      assert.ok(live.publishedAt);
      const released = await publicResource(id);
      assert.equal(released.publicationMethod, "manual");
      assert.deepEqual(released.sources, []);
      assert.equal(released.body, data.body);
      assert.ok(!("createdBy" in released));
      assert.equal((await revision(await act(id, "publish", r1))).publishedAt, live.publishedAt);
      const changes = ["First correction", "Second correction"].map((body) =>
        draft(id, { ...data, requestId: randomUUID(), baseVersion: 1, body }),
      );
      const concurrent = await Promise.all(changes);
      assert.deepEqual(
        concurrent.map((r) => r.status).sort((a, b) => a - b),
        [200, 409],
      );
      const r2 = await revision(concurrent.find((r) => r.status === 200)!);
      assert.equal((await publicResource(id)).body, data.body);
      assert.equal((await act(id, "publish", r1)).status, 409);
      await revision(await act(id, "publish", r2));
      assert.equal((await publicResource(id)).body, r2.body);
      const filteredStaff = ListManualLibraryResponse.parse(
        await ok(
          await call(
            `/admin/manual-library?q=${encodeURIComponent(id)}&kind=practical_guide&state=published&industry=${encodeURIComponent(industry)}`,
          ),
        ),
      );
      assert.ok(filteredStaff.items.some((v) => v.itemId === id));
      const wrongKindStaff = ListManualLibraryResponse.parse(
        await ok(await call(`/admin/manual-library?q=${encodeURIComponent(id)}&kind=template`)),
      );
      assert.equal(wrongKindStaff.items.length, 0);
      const search = ListPublicCatalogueResponse.parse(await ok(await call("/public/catalogue?q=" + id)));
      assert.ok(search.items.some((v: { id: string }) => v.id === r2.id));
      const discovery = GetPublicDiscoveryResponse.parse(await ok(await call("/public/discovery")));
      assert.ok(discovery.items.some((v: { path: string }) => v.path === "/resources/manual-" + id));
      assert.equal((await act(id, "withdraw", r1)).status, 409);
      // A withdrawal says why, in 20 to 1,000 characters once trimmed, and is refused without one
      // (docs/architecture/editions.md, slice 3). A refused withdrawal changes nothing.
      const bare = { action: "withdraw", version: r2.version, digest: r2.digest };
      for (const reason of [undefined, "  Too short a reason  ", "x".repeat(1001)])
        assert.equal((await call(item(id) + "/actions", { ...bare, reason })).status, 422);
      assert.equal((await publicResource(id)).body, r2.body);
      await revision(await act(id, "withdraw", r2));
      await revision(await act(id, "withdraw", r2));
      // The reason is recorded once, with the withdrawal, and never changed.
      const recorded = await db.execute<{ reason: string; recorded_by: string }>(
        sql`select reason, recorded_by from valo_manual_withdrawals where edition = ${r2.id}`,
      );
      assert.deepEqual(recorded.rows, [{ reason: withdrawalReason, recorded_by: editor }]);
      // The database's refusal is the query error's cause.
      const keepsReason = (error: Error) =>
        /A withdrawal keeps the reason it was given/.test(
          String((error as { cause?: Error }).cause?.message ?? error.message),
        );
      await assert.rejects(
        db.execute(
          sql`update valo_manual_withdrawals set reason = ${"x".repeat(30)} where edition = ${r2.id}`,
        ),
        keepsReason,
      );
      await assert.rejects(
        db.execute(sql`delete from valo_manual_withdrawals where edition = ${r2.id}`),
        keepsReason,
      );
      assert.deepEqual(
        (
          await db.execute<{ reason: string; recorded_by: string }>(
            sql`select reason, recorded_by from valo_manual_withdrawals where edition = ${r2.id}`,
          )
        ).rows,
        [{ reason: withdrawalReason, recorded_by: editor }],
      );
      assert.equal((await call("/public/resources/manual-" + id)).status, 404);
      assert.equal((await act(id, "publish", r2)).status, 409);
    });
    await t.test(
      "a version released after an earlier one is released only with what changed, which its page shows while it is published",
      async () => {
        const id = randomUUID(),
          data = input("practical_guide", "Synthetic changed guide " + id);
        const publish = (r: { version: number; digest: string }, change?: string) =>
          call(item(id) + "/actions", {
            action: "publish",
            version: r.version,
            digest: r.digest,
            ...(change === undefined ? {} : { change }),
          });
        // A first release takes no note of what changed, and its page shows none.
        const first = await revision(await draft(id, data));
        assert.equal(first.previousRelease, null);
        assert.equal((await publish(first, changeNote)).status, 422);
        await revision(await publish(first));
        assert.equal((await publicResource(id)).change, undefined);
        // The next version follows a release: it is released only with what changed, in 20 to 1,000
        // characters once trimmed, and a refused release changes nothing.
        const body = "Synthetic corrected editorial text";
        const second = await revision(
          await draft(id, { ...data, requestId: randomUUID(), baseVersion: 1, body }),
        );
        assert.equal(second.previousRelease, 1);
        for (const change of [undefined, "  Too short a note  ", "x".repeat(1001), " ".repeat(30)])
          assert.equal((await publish(second, change)).status, 422);
        assert.equal((await publicResource(id)).body, data.body);
        const released = await revision(await publish(second, "  " + changeNote + "  "));
        const page = await publicResource(id);
        assert.equal(page.body, body);
        assert.equal(page.change?.note, changeNote);
        assert.equal(new Date(page.change!.on).toISOString(), released.publishedAt);
        // The note is recorded once, with the release, and never changed.
        const keepsNote = (error: Error) =>
          /A change note keeps what it said/.test(
            String((error as { cause?: Error }).cause?.message ?? error.message),
          );
        await assert.rejects(
          db.execute(
            sql`update valo_manual_changes set note = ${"x".repeat(30)} where edition = ${second.id}`,
          ),
          keepsNote,
        );
        assert.deepEqual(
          (
            await db.execute(
              sql`select note, recorded_by from valo_manual_changes where edition = ${second.id}`,
            )
          ).rows,
          [{ note: changeNote, recorded_by: editor }],
        );
        // A version released after a withdrawal follows a release too.
        await revision(await act(id, "withdraw", released));
        const third = await revision(
          await draft(id, { ...data, requestId: randomUUID(), baseVersion: 2, body: "Synthetic text again" }),
        );
        assert.equal(third.previousRelease, 2);
        assert.equal((await publish(third)).status, 422);
        await revision(await act(id, "publish", third));
        assert.equal((await publicResource(id)).change?.note, changeNote);
      },
    );
    await t.test(
      "a published entry is due for review 90 days after its release or last review, a Content editor records one, and an entry overdue for its review is held from new use",
      async () => {
        const { valoManualLibrary: library } = await import("@workspace/db");
        const { ListManualLibraryResponse, RecordManualLibraryReviewResponse } =
          await import("@workspace/api-zod");
        const day = 86_400_000;
        const listed = async (review = "") =>
          ListManualLibraryResponse.parse(
            await ok(await call("/admin/manual-library" + (review ? "?review=" + review : ""))),
          ).items;
        const near = (iso: string, at: number) => Math.abs(Date.parse(iso) - at) < 60_000;
        // A guide published now is due in 90 days, shown, and not listed as due.
        const fresh = randomUUID();
        const freshDraft = await revision(
          await draft(fresh, input("practical_guide", "Synthetic reviewed guide")),
        );
        await revision(await act(fresh, "publish", freshDraft));
        const freshEntry = (await listed()).find((i) => i.itemId === fresh)!;
        assert.ok(freshEntry.review && near(freshEntry.review.due, Date.now() + 90 * day));
        assert.ok(!(await listed("due")).some((i) => i.itemId === fresh));
        assert.equal((await call("/public/resources/manual-" + fresh)).status, 200);

        // A free template published 91 days ago is overdue: listed as due, and neither shown nor
        // downloaded anew. Released directly here, so it can be dated in the past; the library's own
        // trigger still requires its Content editor.
        const word = Buffer.from(wordFromText("Reviewed", "Synthetic reviewed template").bytes);
        const overdue = randomUUID();
        const overdueDraft = await revision(
          await draft(overdue, {
            ...input("template", "Synthetic overdue template"),
            fileMode: "upload",
            body: "",
            upload: { format: "docx", base64: word.toString("base64") },
          }),
        );
        await db
          .update(library)
          .set({ state: "published", publishedBy: editor, publishedAt: new Date(Date.now() - 91 * day) })
          .where(eq(library.id, overdueDraft.id));
        const download = "/account/manual-templates/" + overdueDraft.id + "/download";
        const fetchFile = () => call(download, undefined, "synthetic-reader", { "x-test-mfa": "stale" });
        assert.ok((await listed("due")).some((i) => i.itemId === overdue));
        assert.equal((await call("/public/templates/manual-" + overdue)).status, 404);
        assert.equal((await fetchFile()).status, 404);

        // A review needs the published version and a note, and comes from a Content editor only.
        const review = (body: unknown, actor = editor) =>
          call(item(overdue) + "/editorial-reviews", body, actor);
        const note =
          "Synthetic: re-read the template against its purpose and limits, and it needs no change.";
        const current = { version: overdueDraft.version, digest: overdueDraft.digest };
        assert.equal((await review({ ...current, digest: "0".repeat(64), note })).status, 409);
        assert.equal((await review({ ...current, note: "Too short." })).status, 422);
        assert.equal((await review({ ...current, note }, "synthetic-reader")).status, 403);
        assert.equal(
          (await call(item(randomUUID()) + "/editorial-reviews", { ...current, note })).status,
          404,
        );
        // Reviewed, it is shown and downloaded again, and its next review is due 90 days on.
        const recorded = RecordManualLibraryReviewResponse.parse(
          await ok(await review({ ...current, note })),
        );
        assert.ok(near(recorded.due, Date.now() + 90 * day));
        assert.ok(!(await listed("due")).some((i) => i.itemId === overdue));
        assert.equal((await call("/public/templates/manual-" + overdue)).status, 200);
        assert.equal((await fetchFile()).status, 200);
      },
    );
    await t.test(
      "a premium template overdue for its review is neither offered, ordered nor priced, while its buyer keeps its file, and is offered again once reviewed",
      () => exerciseOverduePremiumTemplate(call, editor),
    );
    // Whom a withdrawal tells, shown before it (docs/architecture/library-holds.md, slice 1).
    await t.test(
      "a template's published edition shows staff whom its withdrawal will tell, its buyers and the workspaces that made documents from it, and its notices then reach exactly those",
      () => exerciseWithdrawalReach(call, editor),
    );
    await t.test("one published introduction per industry and no implied regulatory evidence", async () => {
      const id = randomUUID(),
        second = randomUUID(),
        data = input("industry_introduction", "Synthetic industry introduction", industry);
      assert.equal((await draft(id, { ...data, industry: null })).status, 422);
      const before = await industryCoverage(industry);
      const first = await revision(await draft(id, data));
      await revision(await act(id, "publish", first));
      assert.equal((await publicResource(id)).kind, "industry_introduction");
      const after = await industryCoverage(industry);
      assert.equal(after.publishedItems, before.publishedItems + 1);
      assert.equal(after.sourceCheckedAt, before.sourceCheckedAt);
      assert.equal(after.evidenceState, before.evidenceState);
      const otherIntro = await revision(await draft(second, { ...data, requestId: randomUUID() }));
      assert.equal((await act(second, "publish", otherIntro)).status, 409);
      await revision(await act(id, "withdraw", first));
      await revision(await act(second, "publish", otherIntro));
      await revision(await act(second, "withdraw", otherIntro));
    });
    await t.test(
      "an industry pack belongs to one industry, which has one published pack at a time",
      async () => {
        const id = randomUUID(),
          second = randomUUID(),
          data = input("industry_pack", "Synthetic industry pack", industry);
        assert.equal((await draft(id, { ...data, industry: null })).status, 422);
        const before = await industryCoverage(industry);
        const first = await revision(await draft(id, data));
        assert.equal(first.kind, "industry_pack");
        await revision(await act(id, "publish", first));
        const shown = await publicResource(id);
        assert.equal(shown.kind, "industry_pack");
        assert.deepEqual(shown.industrySlugs, [industry]);
        const after = await industryCoverage(industry);
        assert.equal(after.publishedItems, before.publishedItems + 1);
        // A pack is everyday guidance: it implies no regulatory evidence for its industry.
        assert.equal(after.sourceCheckedAt, before.sourceCheckedAt);
        assert.equal(after.evidenceState, before.evidenceState);
        const otherPack = await revision(await draft(second, { ...data, requestId: randomUUID() }));
        const refused = await act(second, "publish", otherPack);
        assert.equal(refused.status, 409);
        assert.match(((await refused.json()) as { error: string }).error, /already has an industry pack/);
        await revision(await act(id, "withdraw", first));
        await revision(await act(second, "publish", otherPack));
        await revision(await act(second, "withdraw", otherPack));
        // The database holds the same rule for a write that does not come through the editor.
        const unplaced = randomUUID();
        await assert.rejects(
          pool.query(
            "insert into valo_manual_library (id,item_id,version,slug,kind,industry,title,body,digest,created_by) values ($1,$2::uuid,1,'manual-'||$2::text,'industry_pack',null,'Synthetic pack','Synthetic text',$3,$4)",
            [randomUUID(), unplaced, "0".repeat(64), editor],
          ),
          /valo_manual_text/,
        );
      },
    );
    await t.test(
      "regulatory items stay private and classification and immutable bytes cannot change",
      async () => {
        const id = randomUUID(),
          data = input("regulatory_article", "Synthetic regulatory draft");
        const r = await revision(await draft(id, data));
        assert.equal((await act(id, "publish", r)).status, 409);
        assert.equal(
          (await draft(id, { ...data, kind: "practical_guide", baseVersion: 1, requestId: randomUUID() }))
            .status,
          409,
        );
        await assert.rejects(
          pool.query(
            "update valo_manual_library set state='published',published_at=now(),published_by=$2 where id=$1",
            [r.id, editor],
          ),
          /current source check of this exact draft/,
        );
        await assert.rejects(
          pool.query("update valo_manual_library set kind='practical_guide' where id=$1", [r.id]),
          /Save corrections/,
        );
        await assert.rejects(pool.query("delete from valo_manual_library where id=$1", [r.id]), /immutable/);
        assert.equal((await call("/public/resources/manual-" + id)).status, 404);
      },
    );
    // docs/architecture/library-entries.md: a template's page says what it is for, what a customer
    // needs, its limits and how it was written (DOC-003, EDP-008), and the release carries them.
    await t.test(
      "a template is released only with its entry details, which never change once saved, and its page shows a related guide only while it is released",
      async () => {
        const guideId = randomUUID();
        const guide = await revision(
          await draft(guideId, input("practical_guide", "Synthetic related guide")),
        );
        const releasedGuide = await revision(await act(guideId, "publish", guide));
        const id = randomUUID(),
          title = "Synthetic detailed template";
        // Only a template has entry details, and each stays within its limits.
        assert.equal(
          (await draft(randomUUID(), { ...input("practical_guide", "Synthetic guide"), purpose: "For" }))
            .status,
          422,
        );
        assert.equal(
          (await draft(id, { ...input("template", title), purpose: "x".repeat(401) })).status,
          422,
        );
        assert.equal((await draft(id, { ...input("template", title), limits: "x".repeat(801) })).status, 422);
        const thirteen = Array.from({ length: 13 }, (_, i) => `Synthetic need ${i + 1}`).join("\n");
        assert.equal((await draft(id, { ...input("template", title), needs: thirteen })).status, 422);
        // Saved without them, a template is refused release, by the route in plain words and by the
        // database whoever asks.
        const bare = await revision(
          await draft(id, { ...input("template", title), purpose: null, limits: null, aiDrafted: null }),
        );
        assert.equal(bare.purpose, null);
        const refused = await act(id, "publish", bare);
        assert.equal(refused.status, 422);
        assert.match(
          ((await refused.json()) as { error: string }).error,
          /^Say what this template is for, give its limits and say whether AI drafted it/,
        );
        await assert.rejects(
          pool.query(
            "update valo_manual_library set state='published',published_at=now(),published_by=$2 where id=$1",
            [bare.id, editor],
          ),
          /released with what it is for, its limits and how it was written/,
        );
        // With them it is released, and its page shows them, its statement and its released guide.
        const missingGuide = randomUUID();
        const full = await revision(
          await draft(id, {
            ...input("template", title),
            baseVersion: 1,
            relatedItems: [guideId, missingGuide],
          }),
        );
        assert.equal(full.purpose, templateDetails.purpose);
        assert.equal(full.needs, templateDetails.needs);
        assert.equal(full.limits, templateDetails.limits);
        assert.equal(full.aiDrafted, true);
        assert.notEqual(full.digest, bare.digest);
        assert.deepEqual(
          full.relatedGuides.map((entry) => [entry.itemId, entry.title, entry.kind, entry.live]),
          [
            [guideId, "Synthetic related guide", "practical_guide", true],
            [missingGuide, null, null, false],
          ],
        );
        await revision(await act(id, "publish", full));
        const page = async () =>
          GetReleasedTemplateResponse.parse(await ok(await call("/public/templates/manual-" + id)));
        const shown = await page();
        assert.equal(shown.summary, templateDetails.purpose);
        assert.equal(shown.purpose, templateDetails.purpose);
        assert.deepEqual(shown.needs, templateDetails.needs.split("\n"));
        assert.equal(shown.limitations, templateDetails.limits);
        assert.match(shown.disclosure, /^Drafted with AI\. A Valo Content editor read this version/);
        assert.deepEqual(shown.relatedGuides, [
          { title: "Synthetic related guide", href: "/resources/manual-" + guideId, kind: "guide" },
        ]);
        const card = ListPublicCatalogueResponse.parse(
          await ok(await call("/public/catalogue?type=template&access=free&q=" + encodeURIComponent(title))),
        ).items.find((entry) => entry.slug === "manual-" + id);
        assert.equal(card?.summary, templateDetails.purpose);
        // The details change no more than the text, released or not.
        for (const change of ["purpose='Changed'", "needs=null", "related_items=null", "ai_drafted=false"])
          await assert.rejects(
            pool.query(`update valo_manual_library set ${change} where id=$1`, [full.id]),
            /Save corrections as a new revision/,
          );
        // A withdrawn guide drops from the page; the template stays, and the editor sees the guide is no
        // longer live.
        await revision(await act(guideId, "withdraw", releasedGuide));
        assert.equal((await page()).relatedGuides, undefined);
        assert.equal((await page()).purpose, templateDetails.purpose);
        const reopened = await revision(await call(item(id)));
        assert.deepEqual(
          reopened.relatedGuides.map((entry) => [entry.itemId, entry.live]),
          [
            [guideId, false],
            [missingGuide, false],
          ],
        );
      },
    );
    await t.test(
      "a distinct verified owner may release only the exact source-checked regulatory revision",
      () => exerciseManualRegulatoryOwner(call, editor),
    );
    await t.test("premium manual files require the purchasing workspace and the exact released edition", () =>
      exercisePremiumManualTemplate(call, editor),
    );
    await t.test(
      "the price command records the owner's exact terms for a published premium template, and closes its open price when the new one starts",
      () => exercisePremiumPriceCommand(call, editor),
    );
    await t.test(
      "only the recently verified development owner reaches the checker rule sign-off routes, and only from Valo's own pages",
      () => exerciseOwnerRuleRoutes(call, editor),
    );
    await t.test(
      "a template's form text is saved with its version, previewed against its form, and never public",
      async () => {
        const formText =
          "# Synthetic form text\n\nBetween [Party]{=party} and us.\n\nSigned: [ ]{=signature}";
        const id = randomUUID(),
          title = "Synthetic form text template";
        // Only a template has form text, and only text the forms can read is saved.
        assert.equal(
          (await draft(id, { ...input("practical_guide", "Synthetic guide with marks"), formText })).status,
          422,
        );
        const unreadable = await draft(id, {
          ...input("template", title),
          formText: "# T\n\nA {stray} brace.",
        });
        assert.equal(unreadable.status, 422);
        assert.match(
          ((await unreadable.json()) as { error: string }).error,
          /line 3: braces are used only for slots and spans/,
        );
        const plain = await revision(await draft(id, { ...input("template", title), formText: "  " }));
        assert.equal(plain.formText, null);
        assert.equal(plain.formFit, null);
        const filled = await revision(
          await draft(id, { ...input("template", title), baseVersion: 1, fileMode: "keep", formText }),
        );
        assert.equal(filled.formText, formText);
        assert.notEqual(filled.digest, plain.digest);
        assert.deepEqual(filled.formFit, { templateId: null, state: "no_template", problems: [] });
        // Published, the entry's public readers carry its text and file, never its form text (DOC-004).
        await revision(await act(id, "publish", filled));
        for (const path of [
          "/public/templates/manual-" + id,
          "/public/catalogue?type=template&access=free",
          "/public/resources",
          "/public/discovery",
        ]) {
          const r = await call(path);
          const body = await r.text();
          assert.equal(r.status, 200, path);
          assert.ok(!body.includes("{=party}") && !body.includes("formText"), path);
        }
        const { releasedManualEntries } = await import("../modules/manual-library");
        const [entry] = await releasedManualEntries("manual-" + id);
        assert.ok(entry && !("formText" in entry));
      },
    );
    await t.test("Word and PDF previews, original template downloads and withdrawal", async () => {
      const text = "Synthetic delivery checklist";
      const large = unzipSync(wordFromText("Checklist", text).bytes);
      large["docProps/custom.xml"] = strToU8("<Properties><!--" + "a".repeat(150000) + "--></Properties>");
      const word = Buffer.from(zipSync(large, { level: 0 }));
      for (const [format, bytes] of [
        ["docx", word],
        ["pdf", samplePdf(text)],
      ] as const) {
        const id = randomUUID();
        const data = {
          ...input("template", "Synthetic " + format),
          fileMode: "upload",
          body: "",
          upload: { format, base64: bytes.toString("base64") },
        };
        const r = await revision(await draft(id, data));
        assert.ok(r.body.includes(text));
        const privatePath = item(id) + "/revisions/1/file",
          download = "/account/manual-templates/" + r.id + "/download";
        assert.equal((await call(privatePath, undefined, "synthetic-customer")).status, 403);
        assert.deepEqual(Buffer.from(await (await call(privatePath)).arrayBuffer()), bytes);
        assert.equal((await call(download)).status, 404);
        await revision(await act(id, "publish", r));
        const projection = GetReleasedTemplateResponse.parse(
          await ok(await call("/public/templates/manual-" + id)),
        );
        assert.equal(projection.reviewBy, null);
        assert.deepEqual(projection.formats, [format]);
        const listing = ListPublicCatalogueResponse.parse(
          await ok(await call("/public/catalogue?type=template&access=free")),
        );
        const card = listing.items.find((entry) => entry.id === r.id);
        assert.equal(card?.freeDownloadPath, "/api" + download);
        assert.equal(card.priceId, undefined);
        assert.equal((await call(download, undefined, "")).status, 401);
        const original = await call(download, undefined, "synthetic-reader", { "x-test-mfa": "stale" });
        assert.equal(original.status, 200);
        assert.equal(original.headers.get("x-content-type-options"), "nosniff");
        assert.ok(original.headers.get("content-disposition")?.endsWith("." + format + '"'));
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
        const erasedIdentity = "synthetic-erased-reader-" + randomUUID();
        const { valoPrivacyTombstones } = await import("@workspace/db");
        const { privacySigner } = await import("../lib/valo-privacy-keys");
        const { quotaSubjectHash } = await import("../lib/valo-quota");
        await db.transaction(async (tx) => {
          const signer = await privacySigner(tx);
          await tx.insert(valoPrivacyTombstones).values({
            id: randomUUID(),
            workspaceId: randomUUID(),
            caseId: randomUUID(),
            identityHash: quotaSubjectHash(signer.key, "user", erasedIdentity),
            phase: "erased",
            keyVersion: signer.version,
          });
        });
        assert.equal(
          (await call(download, undefined, erasedIdentity, { "x-test-mfa": "stale" })).status,
          403,
        );
        const correction = await revision(
          await draft(id, {
            ...input("template", "Corrected title"),
            body: "Corrected preview",
            baseVersion: 1,
            fileMode: "keep",
          }),
        );
        await revision(await act(id, "publish", correction));
        assert.equal((await call(download)).status, 404);
        const corrected = "/account/manual-templates/" + correction.id + "/download";
        assert.deepEqual(Buffer.from(await (await call(corrected)).arrayBuffer()), bytes);
        await revision(await act(id, "withdraw", correction));
        assert.equal((await call(corrected)).status, 404);
        assert.equal((await call("/public/templates/manual-" + id)).status, 404);
        const guideId = randomUUID();
        // The same text and file saved as a guide, which has none of a template's entry details.
        const guide = await revision(
          await draft(guideId, {
            ...data,
            kind: "practical_guide",
            requestId: randomUUID(),
            purpose: undefined,
            needs: undefined,
            limits: undefined,
            aiDrafted: undefined,
          }),
        );
        assert.ok(guide.body.includes(text));
        assert.equal(guide.fileFormat, null);
        assert.equal((await call(item(guideId) + "/revisions/1/file")).status, 404);
      }
      const pasted = randomUUID(),
        data = input("template", "Synthetic pasted template");
      const preview = await revision(await draft(pasted, data));
      assert.equal(preview.fileFormat, "docx");
      assert.equal((await revision(await draft(pasted, data))).digest, preview.digest);
      assert.ok(
        unzipSync(Buffer.from(await (await call(item(pasted) + "/revisions/1/file")).arrayBuffer()))[
          "word/document.xml"
        ],
      );
      assert.equal(
        (
          await draft(randomUUID(), {
            ...input("template", "Malformed file"),
            fileMode: "upload",
            upload: { format: "docx", base64: "abcd" },
          })
        ).status,
        422,
      );
    });
    await t.test(
      "staff browser uploads an introduction, publishes the preview, then withdraws it",
      async () => {
        const { startApp } = await import("../test-support/app-in-browser");
        const { startWebServer } = await import("../test-support/web-server");
        const { expect } = await import("@playwright/test");
        const browser = await startApp("signed-in");
        const publicSite = await startWebServer(async (method, url) => {
          if (method !== "GET" || !url.pathname.startsWith("/api/public/")) return undefined;
          const response = await call(url.pathname.slice(4) + url.search, undefined, "");
          return { status: response.status, body: await response.json() };
        });
        type Answer = Parameters<typeof browser.desktop>[1];
        const answer: Answer = async (route, _method, path, query) => {
          const headers = { ...route.request().headers(), origin, "x-test-identity": editor };
          const response = await route.fetch({
            url: origin + path + (query.size ? "?" + query.toString() : ""),
            headers,
          });
          await route.fulfill({ response });
        };
        try {
          const staff = await browser.desktop("/staff", answer);
          const page = staff.page;
          const title = "Synthetic industry editor browser test";
          await page.getByLabel("Title", { exact: true }).fill(title);
          await page.getByLabel("Content type").selectOption("industry_introduction");
          await page.getByLabel("Industry", { exact: true }).selectOption(industry);
          await page.getByLabel("Content source").selectOption("upload");
          await page.getByLabel("Word or PDF file").setInputFiles({
            name: "intro.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            buffer: wordFromText(title, "Keep a dated delivery note.").bytes,
          });
          await page.getByRole("button", { name: "Save draft and preview" }).click();
          const preview = page.getByRole("region", { name: "Saved preview" });
          await expect(preview).toContainText("Keep a dated delivery note.");
          await page.getByRole("button", { name: "Publish this version" }).click();
          await expect(preview).toContainText("Readers can see version 1.");
          const publicPage = await publicSite.desktop("/industries/" + industry);
          const guidesPage = await publicSite.desktop("/resources");
          await guidesPage.page.getByLabel("Filter guides by industry").selectOption(industry);
          await expect(guidesPage.page.getByRole("link").filter({ hasText: title })).toBeVisible();
          await expect(publicPage.page.getByRole("heading", { name: title })).toBeVisible();
          await expect(publicPage.page.getByRole("region", { name: title })).toContainText(
            "Keep a dated delivery note.",
          );
          // The published version's review date, and a review of it (docs/architecture/guidance-currency.md,
          // slice 2): the note is asked for, and the next date is said once the review is recorded.
          await expect(page.getByText(/Published version 1 is due for review on/)).toBeVisible();
          await page.getByRole("button", { name: "Record a review" }).click();
          const reviewForm = page.getByRole("form", { name: "Record a review of the published version" });
          await expect(reviewForm.getByRole("button", { name: "Record review" })).toBeDisabled();
          await reviewForm
            .getByLabel("What you re-read, and why it needs no change")
            .fill("Synthetic: re-read the introduction, and it needs no change.");
          await reviewForm.getByRole("button", { name: "Record review" }).click();
          await expect(page.getByText(/Review recorded\. The next review is due on/)).toBeVisible();
          // A new version follows the release, so publishing it asks what changed, and the guide's page
          // then says so (docs/architecture/guidance-currency.md, slice 3).
          await page.getByLabel("Content source").selectOption("upload");
          await page.getByLabel("Word or PDF file").setInputFiles({
            name: "intro-2.docx",
            mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            buffer: wordFromText(title, "Keep a dated delivery note and a copy of the invoice.").bytes,
          });
          await page.getByRole("button", { name: "Save draft and preview" }).click();
          await expect(preview).toContainText("a copy of the invoice");
          await page.getByRole("button", { name: "Publish this version" }).click();
          const changeForm = page.getByRole("form", { name: "Say what changed, then publish this version" });
          await expect(changeForm.getByRole("button", { name: "Publish this version" })).toBeDisabled();
          await changeForm
            .getByLabel("What changed in this version?")
            .fill("It now says to keep a copy of the invoice too.");
          await changeForm.getByRole("button", { name: "Publish this version" }).click();
          await expect(preview).toContainText("Readers can see version 2.");
          await guidesPage.page.getByRole("link").filter({ hasText: title }).click();
          await expect(guidesPage.page.getByTestId("text-change")).toHaveText(
            /^Updated on \d{1,2} [A-Z][a-z]{2} \d{4}\. What changed: It now says to keep a copy of the invoice too\.$/,
          );
          // A withdrawal says why, for the customers who bought or used the version
          // (docs/architecture/editions.md, slice 3); "Keep it" withdraws nothing.
          await page.getByRole("button", { name: "Withdraw live version" }).click();
          await page.getByRole("button", { name: "Keep it" }).click();
          await expect(preview).toContainText("Readers can see version 2.");
          await page.getByRole("button", { name: "Withdraw live version" }).click();
          const withdrawal = page.getByRole("form", { name: "Withdraw the live version" });
          await expect(withdrawal.getByRole("button", { name: "Withdraw this version" })).toBeDisabled();
          // A guide has no buyers or documents, so its form says nobody is told
          // (docs/architecture/library-holds.md, slice 1), and the entry shows no counts.
          await expect(withdrawal).toContainText(
            "Readers can no longer open version 2. A guide has no buyers or documents, so no customer is told.",
          );
          await expect(preview.getByTestId("text-withdrawal-reach")).toHaveCount(0);
          await withdrawal
            .getByLabel("Why is it withdrawn?")
            .fill("A synthetic reason for the browser withdrawal.");
          await withdrawal.getByRole("button", { name: "Withdraw this version" }).click();
          // The form's own question says "withdrawn", so the public page is read again only once the
          // screen says the withdrawal was saved and the preview shows the withdrawn version.
          await expect(
            page.getByText("Withdrawn. Readers can no longer open this version.", { exact: true }),
          ).toBeVisible();
          await expect(preview).toContainText("Saved preview · version 2 · withdrawn");
          await expect(withdrawal).toHaveCount(0);
          await publicPage.page.reload();
          await expect(publicPage.page.getByTestId("link-industries")).toBeVisible();
          await expect(publicPage.page.getByRole("heading", { name: title })).toHaveCount(0);
          await page.getByRole("button", { name: "New item", exact: true }).click();
          await page.getByLabel("Title", { exact: true }).fill("Synthetic regulatory draft");
          await page.getByLabel("Content type").selectOption("regulatory_article");
          await page.getByLabel("Guide text").fill("Awaiting the owner's source check.");
          await page.getByRole("button", { name: "Save draft and preview" }).click();
          await expect(preview).toContainText("Awaiting the owner's source check.");
          await expect(page.getByRole("button", { name: "Publish this version" })).toHaveCount(0);
          // A template's entry details (docs/architecture/library-entries.md): the editor writes them,
          // previews them with the statement they make, and cannot publish the template without them.
          await page.getByRole("button", { name: "New item", exact: true }).click();
          await page.getByLabel("Title", { exact: true }).fill("Synthetic browser template");
          await page.getByLabel("Content type").selectOption("template");
          await page.getByLabel("Template text or description").fill("Synthetic template text.");
          await page.getByRole("button", { name: "Save draft and preview" }).click();
          const details = preview.getByTestId("preview-entry-details");
          await expect(details.getByTestId("preview-missing")).toContainText(
            "add what it is for, its limits and how it was written",
          );
          await page.getByRole("button", { name: "Publish this version" }).click();
          await expect(
            page.getByRole("alert").filter({ hasText: "Say what this template is for" }),
          ).toBeVisible();
          await page.getByLabel("What it is for").fill("Keep a synthetic record in the browser test.");
          await page
            .getByLabel("What you need (optional)")
            .fill("The first synthetic fact\nThe second synthetic fact");
          await page
            .getByLabel("Limits you should know")
            .fill("A synthetic template; it shows only what is entered.");
          await page.getByLabel("Drafted with AI").check();
          await page.getByLabel("Find a guide by its title").fill("Synthetic industry editor");
          await page.getByRole("button", { name: `Add “${title}” · Industry introduction` }).click();
          await page.getByRole("button", { name: "Save draft and preview" }).click();
          await expect(details).toContainText("Keep a synthetic record in the browser test.");
          await expect(
            details.getByRole("listitem").filter({ hasText: "The second synthetic fact" }),
          ).toBeVisible();
          // The withdrawn introduction is named, and readers would not see it until it is published.
          await expect(details).toContainText(title + " (readers see it once it is published)");
          await expect(details.getByTestId("preview-statement")).toHaveText(
            "Drafted with AI. A Valo Content editor read this version before releasing it. Valo ran no AI review of it, and no Nigerian legal, tax or sector specialist reviewed it.",
          );
          await expect(details.getByTestId("preview-missing")).toHaveCount(0);
          await page.getByRole("button", { name: "Publish this version" }).click();
          await expect(preview).toContainText("Readers can see version 2.");
          // Whom its withdrawal would tell, before it is made (docs/architecture/library-holds.md, slice 1):
          // nobody yet, then the workspace that makes a document from it, as the editor sees on opening it
          // again and in the withdrawal form. "Keep it" withdraws nothing.
          const reach = preview.getByTestId("text-withdrawal-reach");
          await expect(reach).toHaveText(
            "Withdrawing version 2 would tell no workspace: none bought this template or made a document from this version.",
          );
          const { runInWorkspaceScope } = await import("@workspace/db");
          const { resolveWorkspace } = await import("../modules/workspaces");
          const { createReleasedTemplateDraft } = await import("../modules/catalogue");
          const listing = ListManualLibraryResponse.parse(
            await ok(
              await call("/admin/manual-library?q=" + encodeURIComponent("Synthetic browser template")),
            ),
          );
          const browserTemplate = await revision(await call(item(listing.items[0]!.itemId)));
          assert.equal(browserTemplate.title, "Synthetic browser template");
          const user = await resolveWorkspace("synthetic-browser-reach-" + randomUUID());
          await runInWorkspaceScope(user.workspaceId, () =>
            createReleasedTemplateDraft(user, browserTemplate.id),
          );
          await page.getByRole("button").filter({ hasText: "Synthetic browser template" }).click();
          await expect(reach).toHaveText(
            "Withdrawing version 2 would tell 1 workspace: 1 made 1 document from this version.",
          );
          await page.getByRole("button", { name: "Withdraw live version" }).click();
          await expect(page.getByRole("form", { name: "Withdraw the live version" })).toContainText(
            "Readers can no longer open version 2. 1 workspace is told, with this reason: 1 made 1 document from this version.",
          );
          await page.getByRole("button", { name: "Keep it" }).click();
          await expect(preview).toContainText("Readers can see version 2.");
          assert.deepEqual(staff.errors, []);
          assert.deepEqual(publicPage.errors, []);
          assert.deepEqual(staff.unknown, []);
          assert.deepEqual(publicPage.unknown, []);
          await staff.close();
          await publicPage.close();
          await guidesPage.close();
        } finally {
          await Promise.all([browser.close(), publicSite.close()]);
        }
      },
    );
    await t.test(
      "the drafts kept in the repository are filed once each as private drafts, and the status shows where each stands",
      async () => {
        const retained = "/admin/manual-library/retained";
        const status = async () => ListRetainedDraftsResponse.parse(await ok(await call(retained)));
        const publicLists = async () => ({
          resources: (await ok(await call("/public/resources"))) as unknown[],
          discovery: GetPublicDiscoveryResponse.parse(await ok(await call("/public/discovery"))).items.length,
        });
        const before = await status();
        assert.equal(before.items.length, 108);
        assert.equal(new Set(before.items.map((item) => item.retainedId)).size, 108);
        const shownBefore = await publicLists();
        // Only content staff with a fresh second factor, from the site's own origin, may read or file them.
        assert.equal((await call(retained, undefined, "")).status, 401);
        assert.equal((await call(retained, undefined, other)).status, 403);
        assert.equal((await call(retained, { load: "missing" }, other)).status, 403);
        assert.equal(
          (await call(retained, { load: "missing" }, editor, { "x-test-mfa": "stale" })).status,
          403,
        );
        assert.equal(
          (await call(retained, { load: "missing" }, editor, { origin: "https://other.example.invalid" }))
            .status,
          403,
        );
        assert.equal((await call(retained, { load: "everything" })).status, 422);
        const loaded: string[] = [];
        let last = LoadRetainedDraftsResponse.parse(await ok(await call(retained, { load: "missing" })));
        loaded.push(...last.loaded);
        for (let round = 0; round < 10 && last.remaining > 0; round++) {
          assert.ok(last.loaded.length > 0 && last.loaded.length <= 20);
          last = LoadRetainedDraftsResponse.parse(await ok(await call(retained, { load: "missing" })));
          loaded.push(...last.loaded);
        }
        assert.equal(last.remaining, 0);
        assert.equal(new Set(loaded).size, loaded.length);
        assert.equal(
          loaded.length,
          before.items.filter((item) => item.state === "not_in_library").length,
          "each draft not yet filed was filed once",
        );
        const after = await status();
        assert.ok(after.items.every((item) => item.state !== "not_in_library"));
        for (const id of loaded) {
          const filed = after.items.find((item) => item.retainedId === id)!;
          assert.equal(filed.state, "draft", id);
          assert.equal(filed.version, 1, id);
          assert.equal(filed.shown, false, id);
        }
        // Filing again files nothing, and filing published nothing.
        assert.deepEqual(
          LoadRetainedDraftsResponse.parse(await ok(await call(retained, { load: "missing" }))).loaded,
          [],
        );
        assert.deepEqual(await publicLists(), shownBefore);
        // A filed regulatory guide is the exact text the owner's source check recognises, and an editor
        // cannot publish it.
        const guide = after.items.find((item) => item.retainedId === "GUD-01")!;
        if (loaded.includes("GUD-01")) {
          const r = GetManualLibraryRevisionResponse.parse(await ok(await call(item(guide.itemId!))));
          assert.equal(r.kind, "regulatory_article");
          assert.equal(r.createdBy, editor);
          assert.equal(await registeredManualGuidance(r.title, r.body), "GUD-01");
          assert.equal((await act(guide.itemId!, "publish", r)).status, 409);
        }
        // A filed premium template carries its blank Word master and a public description.
        const premium = after.items.find((item) => item.retainedId === "TPL-13")!;
        if (loaded.includes("TPL-13")) {
          const r = GetManualLibraryRevisionResponse.parse(await ok(await call(item(premium.itemId!))));
          assert.equal(r.kind, "premium_template");
          assert.equal(r.fileFormat, "docx");
          assert.ok(r.body.length <= 600 && r.body.startsWith("A blank service agreement template"));
          const file = await call(item(premium.itemId!) + "/revisions/1/file");
          assert.equal(file.status, 200);
          assert.equal(
            Buffer.from(await file.arrayBuffer())
              .subarray(0, 2)
              .toString(),
            "PK",
          );
        }
        // An industry pack is filed under its industry.
        const pack = after.items.find((item) => item.retainedId === "PACK-C01")!;
        assert.equal(pack.kind, "industry_pack");
        assert.equal(pack.industry, "retail-wholesale");
        // A template with a fill-in form is filed with the form text proposed for it, which its v2 form
        // fits. A version saved without it shows the proposal waiting, and filing it adds a draft version
        // with the latest one's text and file.
        const { FORM_TEXT_MAPS, proposedFormText } = await import("../modules/manual-library/form-text-maps");
        const proposed = await proposedFormText("TPL-01");
        const mapped = Object.keys(FORM_TEXT_MAPS);
        assert.ok(mapped.includes("TPL-01") && mapped.includes("TPL-02"));
        assert.ok(
          after.items.every((entry) => (entry.formText !== null) === mapped.includes(entry.retainedId)),
        );
        const invoice = after.items.find((entry) => entry.retainedId === "TPL-01")!;
        const latest = async () =>
          GetManualLibraryRevisionResponse.parse(await ok(await call(item(invoice.itemId!))));
        // A template is filed with the entry details proposed for it, its related guides linked by the
        // library items its guides are filed under (docs/architecture/library-entries.md).
        const { RETAINED_ENTRY_DETAILS } = await import("../modules/manual-library/retained-entry-details");
        const { retainedItemId } = await import("../modules/manual-library/retained");
        const proposal = RETAINED_ENTRY_DETAILS["TPL-01"]!;
        const proposedDetails = {
          purpose: proposal.purpose,
          needs: proposal.needs.join("\n"),
          limits: proposal.limits,
          relatedItems: proposal.guides.map(retainedItemId),
          aiDrafted: true,
        };
        const detailsOf = (r: {
          purpose: unknown;
          needs: unknown;
          limits: unknown;
          relatedItems: unknown;
          aiDrafted: unknown;
        }) => ({
          purpose: r.purpose,
          needs: r.needs,
          limits: r.limits,
          relatedItems: r.relatedItems,
          aiDrafted: r.aiDrafted,
        });
        assert.ok(after.items.every((entry) => (entry.details !== null) === entry.kind.endsWith("template")));
        if (loaded.includes("TPL-01")) {
          assert.equal(invoice.formText, "filed");
          assert.equal(invoice.details, "filed");
          const r = await latest();
          assert.equal(r.formText, proposed);
          assert.deepEqual(r.formFit, { templateId: "TPL-01", state: "fits", problems: [] });
          assert.deepEqual(detailsOf(r), proposedDetails);
          assert.ok(
            r.relatedGuides.every((entry) => entry.title !== null && entry.kind === "practical_guide"),
          );
        }
        const base = await latest();
        await revision(
          await draft(invoice.itemId!, {
            requestId: randomUUID(),
            baseVersion: base.version,
            title: base.title,
            kind: base.kind,
            industry: base.industry,
            body: base.body,
            fileMode: "keep",
            formText: null,
          }),
        );
        assert.equal(
          (await status()).items.find((entry) => entry.retainedId === "TPL-01")!.formText,
          "proposed",
        );
        // Waiting for its form text now: the invoice, and each mapped template that was in the library
        // before this test filed the drafts, under an item with no form text (an earlier test's
        // synthetic service agreement, for one). Every template this test filed has its form text.
        const waiting = (await status()).items
          .filter((entry) => entry.formText === "proposed")
          .map((entry) => entry.retainedId);
        assert.ok(waiting.includes("TPL-01"));
        assert.deepEqual(
          waiting.filter((id) => id !== "TPL-01" && loaded.includes(id)),
          [],
          "every template filed here was filed with its form text",
        );
        // Filing form text files exactly those, once each.
        const withForm = LoadRetainedDraftsResponse.parse(
          await ok(await call(retained, { load: "form_text" })),
        );
        assert.deepEqual(withForm.loaded, waiting);
        assert.equal(withForm.remaining, 0);
        assert.equal(withForm.status.items.find((entry) => entry.retainedId === "TPL-01")!.formText, "filed");
        const filedForm = await latest();
        assert.equal(filedForm.version, base.version + 2);
        assert.equal(filedForm.state, "draft");
        assert.equal(filedForm.formText, proposed);
        assert.equal(filedForm.body, base.body);
        assert.equal(filedForm.fileFormat, base.fileFormat);
        assert.deepEqual(
          LoadRetainedDraftsResponse.parse(await ok(await call(retained, { load: "form_text" }))).loaded,
          [],
        );
        // The version saved above has no entry details, and filing the form text kept that: the
        // invoice now waits for its details, as does each template that was in the library before this
        // test filed the drafts. Filing them adds a draft version with the proposed details, keeping its
        // text, file and form text.
        assert.deepEqual(detailsOf(filedForm), {
          purpose: null,
          needs: null,
          limits: null,
          relatedItems: [],
          aiDrafted: null,
        });
        const noDetails = withForm.status.items
          .filter((entry) => entry.details === "proposed" && entry.itemId !== null)
          .map((entry) => entry.retainedId);
        assert.ok(noDetails.includes("TPL-01"));
        assert.deepEqual(
          noDetails.filter((id) => id !== "TPL-01" && loaded.includes(id)),
          [],
          "every template filed here was filed with its entry details",
        );
        const withDetails = LoadRetainedDraftsResponse.parse(
          await ok(await call(retained, { load: "details" })),
        );
        assert.deepEqual(withDetails.loaded, noDetails);
        assert.equal(withDetails.remaining, 0);
        const detailed = await latest();
        assert.equal(detailed.version, filedForm.version + 1);
        assert.equal(detailed.state, "draft");
        assert.deepEqual(detailsOf(detailed), proposedDetails);
        assert.equal(detailed.formText, proposed);
        assert.equal(detailed.body, base.body);
        assert.equal(detailed.fileFormat, base.fileFormat);
        assert.equal(
          withDetails.status.items.find((entry) => entry.retainedId === "TPL-01")!.details,
          "filed",
        );
        assert.deepEqual(
          LoadRetainedDraftsResponse.parse(await ok(await call(retained, { load: "details" }))).loaded,
          [],
        );
        assert.deepEqual(await publicLists(), shownBefore);
      },
    );
    // docs/architecture/library-entries.md, slices 2 and 3: a workspace saves a library template and is
    // suggested others, and copies a free one into a document that keeps the release it came from. Each
    // call runs in the reader's workspace scope, as its request runs; the routes only pass it on, and the
    // same-origin check in front of them has a test of its own.
    await t.test(
      "a workspace saves a library template, is suggested others, and copies a free one into a document that keeps its release",
      async () => {
        const { resolveWorkspace } = await import("../modules/workspaces");
        const { createReleasedTemplateDraft, savedTemplateList, saveTemplate, unsaveTemplate } =
          await import("../modules/catalogue");
        const { runInWorkspaceScope } = await import("@workspace/db");
        const reader = await resolveWorkspace("synthetic-library-reader-" + randomUUID());
        const asReader = <T>(work: () => Promise<T>) => runInWorkspaceScope(reader.workspaceId, work);
        const savedList = async (work: () => Promise<unknown> = () => savedTemplateList(reader)) =>
          ListSavedTemplatesResponse.parse(await asReader(work));
        const refused = (status: number) => (error: unknown) =>
          (error as { status?: number }).status === status;
        const releaseOf = async (id: string, value: Record<string, unknown>) =>
          revision(await act(id, "publish", await revision(await draft(id, value))));
        const freeId = randomUUID(),
          otherId = randomUUID(),
          premiumId = randomUUID();
        const free = await releaseOf(freeId, {
          ...input("template", "Synthetic library copy"),
          body: "Synthetic opening paragraph.\n\nItem | Quantity\nSynthetic item | 2\n\nSynthetic closing paragraph.",
        });
        await releaseOf(otherId, input("template", "Synthetic library suggestion"));
        const { bytes } = wordFromText("Synthetic premium checklist", "Only a buyer reads this sentence.");
        const premium = await releaseOf(premiumId, {
          ...input("premium_template", "Synthetic library premium checklist"),
          body: "A synthetic premium checklist's public description.",
          fileMode: "upload",
          upload: { format: "docx", base64: bytes.toString("base64") },
        });
        // Saved, a library template is kept under its address name, and the others are suggested.
        const saved = await savedList(() => saveTemplate(reader, free.id));
        const entry = saved.items.find((item) => item.templateId === "manual-" + freeId);
        assert.equal(entry?.title, "Synthetic library copy");
        assert.equal(entry?.available, true);
        assert.equal(entry?.current?.href, "/library/manual-" + freeId);
        assert.ok(saved.recommendations.some((item) => item.templateId === "manual-" + otherId));
        assert.ok(!saved.recommendations.some((item) => item.templateId === "manual-" + freeId));
        // Saving again saves nothing more.
        await savedList(() => saveTemplate(reader, free.id));
        assert.equal(
          (await savedList()).items.filter((item) => item.templateId === "manual-" + freeId).length,
          1,
        );
        // A free one is copied from its released text: each paragraph a block, the bar lines a table.
        const copy = CreateTemplateDraftResponse.parse(
          await asReader(() => createReleasedTemplateDraft(reader, free.id)),
        );
        assert.equal(copy.title, "Synthetic library copy");
        assert.deepEqual(
          copy.content.blocks.map((block) => [block.type, block.text, block.rows]),
          [
            ["paragraph", "Synthetic opening paragraph.", []],
            [
              "table",
              "",
              [
                ["Item", "Quantity"],
                ["Synthetic item", "2"],
              ],
            ],
            ["paragraph", "Synthetic closing paragraph.", []],
          ],
        );
        const { valoDocuments } = await import("@workspace/db");
        const recorded = async () =>
          (
            await db
              .select({ edition: valoDocuments.libraryEdition })
              .from(valoDocuments)
              .where(eq(valoDocuments.id, copy.id))
          )[0]?.edition;
        assert.equal(await recorded(), free.id);
        // A premium one keeps its text in its file, so it has no copy here.
        await assert.rejects(
          asReader(() => createReleasedTemplateDraft(reader, premium.id)),
          refused(404),
        );
        // Withdrawn, the saved entry stays with the title it had, no copy can be made, and the copy
        // already made keeps its release.
        await revision(await act(freeId, "withdraw", free));
        const after = (await savedList()).items.find((item) => item.templateId === "manual-" + freeId);
        assert.equal(after?.available, false);
        assert.equal(after?.title, "Synthetic library copy");
        await assert.rejects(
          asReader(() => createReleasedTemplateDraft(reader, free.id)),
          refused(404),
        );
        assert.equal(await recorded(), free.id);
        // Removing it removes it.
        await savedList(() => unsaveTemplate(reader, "manual-" + freeId));
        assert.ok(!(await savedList()).items.some((item) => item.templateId === "manual-" + freeId));
      },
    );
    // docs/architecture/editions.md, slice 1: a document says where the template edition it was made
    // from stands, read in the workspace's scope as its request reads it.
    await t.test(
      "a copied document says when its template's edition is replaced by a later release and when the template is withdrawn",
      async () => {
        const { resolveWorkspace } = await import("../modules/workspaces");
        const { createReleasedTemplateDraft, listDocumentEditions } = await import("../modules/catalogue");
        const { runInWorkspaceScope } = await import("@workspace/db");
        const reader = await resolveWorkspace("synthetic-edition-reader-" + randomUUID()),
          stranger = await resolveWorkspace("synthetic-edition-stranger-" + randomUUID());
        const editions = async (actor = reader) =>
          ListDocumentEditionsResponse.parse(
            await runInWorkspaceScope(actor.workspaceId, () => listDocumentEditions(actor)),
          ).items;
        const itemId = randomUUID();
        const first = await revision(
          await act(
            itemId,
            "publish",
            await revision(await draft(itemId, input("template", "Synthetic edition register"))),
          ),
        );
        const copy = await runInWorkspaceScope(reader.workspaceId, () =>
          createReleasedTemplateDraft(reader, first.id),
        );
        // Made from the template's release: nothing to say.
        assert.equal(
          (await editions()).find((e) => e.documentId === copy.id),
          undefined,
        );
        // A later version released: the copy's edition reads replaced, with the new version and its page.
        const second = await revision(
          await act(
            itemId,
            "publish",
            await revision(
              await draft(itemId, { ...input("template", "Synthetic edition register"), baseVersion: 1 }),
            ),
          ),
        );
        const replaced = (await editions()).find((e) => e.documentId === copy.id);
        assert.equal(replaced?.state, "replaced");
        assert.equal(replaced?.title, "Synthetic edition register");
        assert.equal(replaced?.version, 1);
        assert.deepEqual(replaced?.current, { version: 2, href: "/library/manual-" + itemId });
        assert.ok(replaced?.since);
        // The later version withdrawn: the template is withdrawn now, and the copy itself is unchanged.
        await revision(await act(itemId, "withdraw", second));
        const withdrawn = (await editions()).find((e) => e.documentId === copy.id);
        assert.equal(withdrawn?.state, "withdrawn");
        assert.equal(withdrawn?.current, null);
        assert.ok(withdrawn?.since);
        // With the reason its editor gave (slice 3).
        assert.equal(withdrawn?.reason, withdrawalReason);
        const { valoDocuments } = await import("@workspace/db");
        assert.equal(
          (await db.select().from(valoDocuments).where(eq(valoDocuments.id, copy.id)))[0]?.libraryEdition,
          first.id,
        );
        // Another workspace sees nothing of it.
        assert.deepEqual(await editions(stranger), []);
      },
    );
    // docs/architecture/editions.md, slice 3: each workspace that made a document from an edition is
    // told once when it is replaced or withdrawn, by the database in the transaction that makes the
    // change. No other workspace is told, and a workspace may only mark its own notices read.
    await t.test(
      "each workspace that used an edition is told once when it is replaced or withdrawn, and no other workspace is",
      async () => {
        const { resolveWorkspace } = await import("../modules/workspaces");
        const { createReleasedTemplateDraft, listEditionNotices, markEditionNoticeRead } =
          await import("../modules/catalogue");
        const { runInWorkspaceScope } = await import("@workspace/db");
        const early = await resolveWorkspace("synthetic-notice-early-" + randomUUID()),
          late = await resolveWorkspace("synthetic-notice-late-" + randomUUID()),
          stranger = await resolveWorkspace("synthetic-notice-stranger-" + randomUUID());
        const inScope = <T>(actor: typeof early, work: () => Promise<T>) =>
          runInWorkspaceScope(actor.workspaceId, work);
        const notices = async (actor: typeof early) =>
          ListEditionNoticesResponse.parse(await inScope(actor, () => listEditionNotices(actor))).items;
        // Every notice written of an edition, whichever workspace it went to.
        const written = async (edition: string) =>
          (
            await db.execute(
              sql`select workspace_id, route, kind, title, version, replacement_version, reason, held, documents
                    from valo_edition_notices where edition = ${edition} order by kind`,
            )
          ).rows;
        const title = "Synthetic noticed register";
        const itemId = randomUUID();
        const release = async (baseVersion: number) =>
          revision(
            await act(
              itemId,
              "publish",
              await revision(await draft(itemId, { ...input("template", title), baseVersion })),
            ),
          );
        const first = await release(0);
        // Two copies of the first edition in one workspace make one notice, of two documents.
        for (const _copy of [1, 2]) await inScope(early, () => createReleasedTemplateDraft(early, first.id));
        assert.deepEqual(await written(first.id), []);
        const second = await release(1);
        // The notice of a replacement carries what changed in the new version
        // (docs/architecture/guidance-currency.md, slice 3).
        const replacedFirst = {
          workspace_id: early.workspaceId,
          route: "library",
          kind: "replaced",
          title,
          version: 1,
          replacement_version: 2,
          reason: changeNote,
          held: false,
          documents: 2,
        };
        assert.deepEqual(await written(first.id), [replacedFirst]);
        // Releasing it again changes nothing and tells nobody again.
        await revision(await act(itemId, "publish", second));
        assert.deepEqual(await written(first.id), [replacedFirst]);
        // A copy of the second edition in another workspace; its withdrawal tells that workspace, with
        // the reason, and not the workspace whose copies came from the first edition.
        await inScope(late, () => createReleasedTemplateDraft(late, second.id));
        await revision(await act(itemId, "withdraw", second));
        const withdrawnSecond = {
          workspace_id: late.workspaceId,
          route: "library",
          kind: "withdrawn",
          title,
          version: 2,
          replacement_version: null,
          reason: withdrawalReason,
          held: false,
          documents: 1,
        };
        assert.deepEqual(await written(second.id), [withdrawnSecond]);
        // A new edition released after the withdrawn one tells its users that it was replaced too, with
        // what changed (docs/architecture/guidance-currency.md, slice 3).
        await release(2);
        assert.deepEqual(await written(second.id), [
          { ...withdrawnSecond, kind: "replaced", replacement_version: 3, reason: changeNote },
          withdrawnSecond,
        ]);
        assert.deepEqual(await written(first.id), [replacedFirst]);

        // Each workspace reads its own notices in its own scope, newest first.
        const [earlyNotice, ...earlyRest] = await notices(early);
        assert.deepEqual(earlyRest, []);
        assert.deepEqual(
          { ...earlyNotice, id: undefined, createdAt: undefined },
          {
            id: undefined,
            route: "library",
            title,
            version: 1,
            kind: "replaced",
            replacementVersion: 2,
            reason: changeNote,
            held: false,
            documents: 2,
            createdAt: undefined,
          },
        );
        assert.deepEqual(
          (await notices(late)).map((n) => [n.kind, n.version, n.replacementVersion, n.reason]),
          [
            ["replaced", 2, 3, changeNote],
            ["withdrawn", 2, null, withdrawalReason],
          ],
        );
        assert.deepEqual(await notices(stranger), []);
        // Another workspace cannot mark it read, and is told only that it was not found.
        await assert.rejects(
          inScope(stranger, () => markEditionNoticeRead(stranger, earlyNotice!.id)),
          (error: unknown) => error instanceof ValoProblem && error.status === 404,
        );
        assert.equal((await notices(early)).length, 1);
        // Marked read, it leaves the list; marking it again changes nothing.
        assert.deepEqual(await inScope(early, () => markEditionNoticeRead(early, earlyNotice!.id)), {
          items: [],
        });
        const readAt = async () =>
          (
            await db.execute<{ read_at: Date | null }>(
              sql`select read_at from valo_edition_notices where id = ${earlyNotice!.id}`,
            )
          ).rows[0]?.read_at;
        const firstRead = await readAt();
        assert.ok(firstRead);
        await inScope(early, () => markEditionNoticeRead(early, earlyNotice!.id));
        assert.deepEqual(await readAt(), firstRead);
        assert.deepEqual(await written(first.id), [replacedFirst]);
        // In the workspace's scope a notice can be read and marked read, and nothing else.
        const refusal = (pattern: RegExp) => (error: Error) =>
          pattern.test(String((error as { cause?: Error }).cause?.message ?? error.message));
        await inScope(early, async () => {
          for (const statement of [
            sql`update valo_edition_notices set title = 'Changed' where id = ${earlyNotice!.id}`,
            sql`delete from valo_edition_notices where id = ${earlyNotice!.id}`,
            sql`insert into valo_edition_notices(workspace_id, route, edition, kind, title, version,
                  replacement_version, held, documents)
                values (${early.workspaceId}, 'library', ${first.id}, 'withdrawn', 'Forged', 1, null, true, 0)`,
          ])
            await assert.rejects(
              db.execute(statement),
              refusal(/permission denied for table valo_edition_notices/),
            );
        });
        assert.deepEqual(await written(first.id), [replacedFirst]);
      },
    );
    // docs/architecture/results.md, slice 1: a result finds the documents its rules relate by their
    // numbers. A library template filed as a registered one, by its title as the access check finds it, is
    // listed by that template's number; any other entry has none. After the retained drafts are filed, so
    // that the releases here are not found by title when they are.
    await t.test(
      "the released list names a library template by the number of the registered template it is filed as, finds it by that number alone, and stops finding it once it is withdrawn",
      async () => {
        const list = async (query: string) =>
          ListPublicCatalogueResponse.parse(await ok(await call("/public/catalogue?" + query)));
        const { bytes } = wordFromText("Synthetic numbered notice", "Only a buyer reads this sentence.");
        const premium = (title: string) => ({
          ...input("premium_template", title),
          body: "A synthetic numbered entry's public description.",
          fileMode: "upload",
          upload: { format: "docx", base64: bytes.toString("base64") },
        });
        const numberedId = randomUUID(),
          otherId = randomUUID();
        const numbered = await revision(
          await act(
            numberedId,
            "publish",
            await revision(await draft(numberedId, premium("Privacy notice"))),
          ),
        );
        await revision(
          await act(
            otherId,
            "publish",
            await revision(await draft(otherId, premium("Synthetic unnumbered checklist"))),
          ),
        );
        // Found by its number alone, and named by it; every entry found has that number.
        const found = await list("templateIds=TPL-29");
        const entry = found.items.find((item) => item.id === numbered.id);
        assert.equal(entry?.templateNumber, "TPL-29");
        assert.equal(entry?.templateId, "manual-" + numberedId);
        assert.equal(entry?.href, "/library/manual-" + numberedId);
        assert.ok(found.items.every((item) => item.templateNumber === "TPL-29"));
        // Another number does not find it, and an entry with no registered title has no number.
        assert.ok(!(await list("templateIds=TPL-01,TPL-30")).items.some((item) => item.id === numbered.id));
        const unnumbered = (await list("q=Synthetic%20unnumbered%20checklist")).items.find(
          (item) => item.slug === "manual-" + otherId,
        );
        assert.ok(unnumbered);
        assert.equal(unnumbered.templateNumber, undefined);
        // The route takes numbers only as the list writes them.
        for (const templateIds of ["TPL-1", "TPL-29;TPL-01", "privacy"])
          assert.equal((await call("/public/catalogue?templateIds=" + templateIds)).status, 422, templateIds);
        // Withdrawn, it is no longer found by its number.
        await revision(await act(numberedId, "withdraw", numbered));
        assert.ok(!(await list("templateIds=TPL-29")).items.some((item) => item.id === numbered.id));
      },
    );
    // Last, so that the editions it releases are not found by title when the retained drafts are filed.
    await t.test(
      "a premium form starts only from an edition the workspace bought with its wording, under its own verified order, which the document keeps",
      () => exercisePremiumFormDocument(call, editor),
    );
    assert.deepEqual(
      await billing(),
      startBudget,
      "manual publishing never writes provider budgets, batches or machine-reviewed versions",
    );
    assert.ok(
      (
        await db
          .select({ id: valoManualLibrary.id })
          .from(valoManualLibrary)
          .where(eq(valoManualLibrary.createdBy, editor))
      ).length > 0,
    );
  },
);
