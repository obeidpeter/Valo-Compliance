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
import { exercisePremiumManualTemplate } from "../test-support/manual-premium-template";
import { exercisePremiumPriceCommand } from "../test-support/premium-price-command";
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
  LoadRetainedDraftsResponse,
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
      call(item(id) + "/actions", { action, version: r.version, digest: r.digest });
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
      await revision(await act(id, "withdraw", r2));
      await revision(await act(id, "withdraw", r2));
      assert.equal((await call("/public/resources/manual-" + id)).status, 404);
      assert.equal((await act(id, "publish", r2)).status, 409);
    });
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
        const guide = await revision(
          await draft(guideId, { ...data, kind: "practical_guide", requestId: randomUUID() }),
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
          page.once("dialog", (dialog) => dialog.accept());
          await page.getByRole("button", { name: "Withdraw live version" }).click();
          await expect(preview).toContainText("withdrawn");
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
        const { proposedFormText } = await import("../modules/manual-library/form-text-maps");
        const proposed = await proposedFormText("TPL-01");
        assert.ok(
          after.items.every((entry) => (entry.formText !== null) === (entry.retainedId === "TPL-01")),
        );
        const invoice = after.items.find((entry) => entry.retainedId === "TPL-01")!;
        const latest = async () =>
          GetManualLibraryRevisionResponse.parse(await ok(await call(item(invoice.itemId!))));
        if (loaded.includes("TPL-01")) {
          assert.equal(invoice.formText, "filed");
          const r = await latest();
          assert.equal(r.formText, proposed);
          assert.deepEqual(r.formFit, { templateId: "TPL-01", state: "fits", problems: [] });
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
        const withForm = LoadRetainedDraftsResponse.parse(
          await ok(await call(retained, { load: "form_text" })),
        );
        assert.deepEqual(withForm.loaded, ["TPL-01"]);
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
        assert.deepEqual(await publicLists(), shownBefore);
      },
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
