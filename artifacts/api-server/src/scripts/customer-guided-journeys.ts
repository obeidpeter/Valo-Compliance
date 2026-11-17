import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";
import { GetDocumentResponse } from "@workspace/api-zod";
import { GUIDED_TEMPLATE_IDS, type GuidedField } from "@workspace/valo-core/guided";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { guidedDataFromBlocks, guidedDataIssues, guidedVisible } from "@workspace/valo-core/guided-runtime";
import { completeGuidedTestData } from "../lib/valo-guided-test-fixtures";
import { serializeRevisionV1 } from "../lib/valo-revision-codec";
type Api = (
  path: string,
  method?: string,
  body?: unknown,
) => Promise<{ status: number; body: unknown; cache: string | null }>;
export async function runGuidedCustomerJourneys(
  page: Page,
  api: Api,
  check: (name: string, fn: () => Promise<void>) => Promise<void>,
) {
  const details: unknown[] = [],
    dir = fileURLToPath(new URL("../../../../generated-artifacts/valo-guided-private/", import.meta.url));
  await mkdir(dir, { recursive: true });
  let lastExport = 0;
  const fill = async (f: GuidedField, id: string, value: string) => {
    const input = page.locator("#" + id);
    if (f.type === "acknowledgement") await input.check();
    else if (f.type === "select") await input.selectOption(value);
    else await input.fill(value);
  };
  const save = async (id: string) => {
    await page.keyboard.press("Control+s");
    await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 30000 });
    const stored = await api(`/api/workspace/documents/${id}`);
    expect(stored.status).toBe(200);
    return GetDocumentResponse.parse(stored.body);
  };
  for (const templateId of GUIDED_TEMPLATE_IDS)
    await check(`real_guided_${templateId}_questions_saved_revision_private_DOCX_PDF`, async () => {
      const spec = GUIDED_SPECS_V1[templateId],
        input = completeGuidedTestData(templateId);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/workspace");
      await page.getByTestId("select-guided-template").selectOption(templateId);
      await page.getByTestId("button-start-guided").click();
      await expect(page).toHaveURL(/\/workspace\/documents\/[a-f0-9-]+/);
      const id = new URL(page.url()).pathname.split("/").at(-1)!;
      await expect(page.getByTestId("guided-fields")).toBeVisible();
      await expect(page.getByTestId("status-guided-issues")).not.toContainText(
        "All shown answers are complete",
      );
      for (const f of spec.fields)
        if (guidedVisible(f, input.values)) await fill(f, "g-" + f.id, input.values[f.id]);
      for (const t of spec.tables)
        if (guidedVisible(t, input.values))
          for (const [rowIndex, row] of input.tables[t.id].entries())
            for (const c of t.columns)
              if (guidedVisible(c, { ...input.values, ...row }))
                await fill(c, `gt-${t.id}-${rowIndex}-${c.id}`, row[c.id]);
      await expect(page.getByTestId("status-guided-issues")).toHaveText("All shown answers are complete");
      await save(id);
      if (["TPL-13", "TPL-14", "TPL-15", "TPL-16", "TPL-17"].includes(templateId)) {
        await page.locator("#g-recipientName").fill("");
        await expect(page.getByTestId("status-guided-issues")).not.toContainText(
          "All shown answers are complete",
        );
        const incomplete = await save(id);
        expect(guidedDataFromBlocks(incomplete.content.blocks)!.values.recipientName).toBe("");
        await page.locator("#g-recipientName").fill(input.values.recipientName);
      }
      if (templateId === "TPL-01") {
        await page.locator("#g-dueDate").fill("2026-01-01");
        await page.locator("#gt-items-0-unitPriceKobo").fill("12.50");
        await expect(page.getByTestId("status-guided-issues")).not.toContainText(
          "All shown answers are complete",
        );
        const invalid = await save(id),
          raw = guidedDataFromBlocks(invalid.content.blocks)!;
        expect(raw.values.dueDate).toBe("2026-01-01");
        expect(raw.tables.items[0].unitPriceKobo).toBe("12.50");
        await page.locator("#g-dueDate").fill(input.values.dueDate);
        await page.locator("#gt-items-0-unitPriceKobo").fill(input.tables.items[0].unitPriceKobo);
      }
      const saved = await save(id),
        answers = guidedDataFromBlocks(saved.content.blocks)!;
      expect(guidedDataIssues(spec, answers)).toEqual({});
      for (const f of spec.fields)
        if (guidedVisible(f, input.values)) expect(answers.values[f.id]).toBe(input.values[f.id]);
      for (const t of spec.tables)
        if (guidedVisible(t, input.values))
          for (const [i, row] of input.tables[t.id].entries())
            for (const c of t.columns)
              if (guidedVisible(c, { ...input.values, ...row }))
                expect(answers.tables[t.id][i][c.id]).toBe(row[c.id]);
      await page.reload();
      await expect(page.locator("#g-issuerName")).toHaveValue(input.values.issuerName);
      await expect(page.getByTestId("status-guided-issues")).toHaveText("All shown answers are complete");
      await page.setViewportSize({ width: 360, height: 800 });
      expect(await page.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
      await page.locator("#g-issuerName").focus();
      expect(
        await page
          .locator("#g-issuerName")
          .evaluate((el) => !!el.ownerDocument.querySelector(`label[for="${el.id}"]`)),
      ).toBe(true);
      await page.keyboard.press("Tab");
      expect(await page.evaluate("document.activeElement!==document.body")).toBe(true);
      await page.screenshot({ path: `${dir}${templateId}-mobile.png` });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator('#private-exports input[type="checkbox"]').check();
      const savedHash = createHash("sha256")
        .update(serializeRevisionV1({ title: saved.title, content: saved.content }))
        .digest("hex");
      const formats: unknown[] = [];
      for (const format of ["docx", "pdf"] as const) {
        // Respect the existing ten-creation/minute limit; no overrides or lane changes.
        const wait = 6500 - (Date.now() - lastExport);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        const response = page.waitForResponse(
          (r) => r.request().method() === "POST" && r.url().includes(`/api/v1/documents/${id}/exports`),
        );
        await page.getByRole("button", { name: `Create ${format.toUpperCase()} draft`, exact: true }).click();
        lastExport = Date.now();
        const created = await response;
        expect(created.status()).toBe(202);
        const job = await created.json();
        const link = page.getByRole("link", { name: `Download ${format.toUpperCase()}`, exact: true });
        await expect(link).toBeVisible({ timeout: 65000 });
        const url = (await link.getAttribute("href"))!,
          download = await page.request.get(url);
        expect(download.status()).toBe(200);
        expect(download.headers()["cache-control"]).toContain("no-store");
        const buffer = await download.body(),
          checksum = createHash("sha256").update(buffer).digest("hex");
        const ready = await api(`/api/v1/documents/${id}/exports`);
        expect(ready.status).toBe(200);
        const savedJob = (ready.body as { id: string; sourceHash: string; checksum: string }[]).find(
          (row) => row.id === job.id,
        );
        expect(savedJob?.sourceHash).toBe(savedHash);
        expect(savedJob?.checksum).toBe(checksum);
        const path = `${dir}${templateId}.${format}`;
        await writeFile(path, buffer);
        const text =
          format === "docx"
            ? spawnSync("unzip", ["-p", path, "word/document.xml"], { encoding: "utf8" })
            : spawnSync("pdftotext", ["-layout", path, "-"], { encoding: "utf8" });
        expect(text.status).toBe(0);
        expect(text.stdout).toContain("Synthetic issuerName");
        expect(text.stdout).not.toContain("valo-guided-v1:");
        formats.push({
          format,
          jobId: job.id,
          revision: saved.revision,
          sourceHash: savedHash,
          checksum,
          size: buffer.length,
          actualPrivateDownloadStatus: download.status(),
          mechanicalReaderExit: text.status,
        });
      }
      details.push({
        templateId,
        status: "pass",
        revision: saved.revision,
        savedHash,
        formats,
        actualManagedCustomerUI: true,
        actualAPISaveReload: true,
        mobileWidth: 360,
        bodyValuesSynthetic: true,
        catalogueMasterUsed: false,
        publicationClaimed: false,
      });
    });
  return details;
}
