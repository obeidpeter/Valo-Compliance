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
  GetManualLibraryRevisionResponse,
  GetPublicCoverageResponse,
  GetPublicDiscoveryResponse,
  GetReleasedResourceResponse,
  GetReleasedTemplateResponse,
  ListPublicCatalogueResponse,
} from "@workspace/api-zod";

test("consumer Gazette checks bind the exact reviewed pages and expire when the amendment search expires", async () => {
  const { checkConsumerGazette } = await import("../modules/manual-library/consumer-gazette");
  const { readGuidanceIntake } = await import("../modules/publication");
  const observed = {
    url: "https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf",
    leadId: "FCCPC-GAZETTE-2018",
    rawChecksum: "aa942cdef860387e8f984de52666e5683d12d6e2813cb47b10335e0bf82a07f5",
    checkedAt: "2026-11-22T17:00:00Z",
    text: "Unused OCR",
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
  const stream = "BT /F1 12 Tf 50 700 Td (" + text + ") Tj ET";
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
  "manual publishing through staff HTTP routes and public readers",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 90000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, pool, valoStaffAssignments, valoManualLibrary } = await import("@workspace/db");
    const { makeStaffGate } = await import("../middlewares/valo-staff-gate");
    const { createManualLibraryRouter } = await import("./valo-manual-library");
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
        assert.equal((await call(download, undefined, "")).status, 401);
        const original = await call(download, undefined, "synthetic-reader", { "x-test-mfa": "stale" });
        assert.equal(original.status, 200);
        assert.equal(original.headers.get("x-content-type-options"), "nosniff");
        assert.ok(original.headers.get("content-disposition")?.endsWith("." + format + '"'));
        assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
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
