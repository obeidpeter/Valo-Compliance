import { randomUUID, createHash } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { fileURLToPath } from "node:url";
import { chromium, expect, request, type Page, type Browser } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { clerkClient } from "@clerk/express";
import {
  CreateAssessmentResponse,
  ListTasksResponse,
  GetWorkspaceResponse,
  CreateCustomerAIDraftResponse,
  GetDocumentResponse,
  ListDocumentExportsResponse,
} from "@workspace/api-zod";
import { syntheticProfile } from "../lib/valo-test-fixtures";
import { logger } from "../platform/logger";
import { chromiumLaunchPath } from "../platform/chromium";
let browser: Browser | undefined,
  page: Page | undefined,
  identityId: string | undefined,
  phase = "guard";
const checks: { name: string; status: string; diagnostic?: string }[] = [];
const financialExports: Record<string, unknown>[] = [];
const report = {
  syntheticOnly: true,
  startedAt: new Date().toISOString(),
  checks,
  managedIdentityUsed: true,
  actualEmailDeliveryTested: false,
  sourceBackedRulesPublished: 0,
  r1Accepted: false,
  financialExports,
};
async function check(name: string, fn: () => Promise<void>) {
  phase = name;
  try {
    await fn();
    checks.push({ name, status: "pass" });
    logger.info({ event: "checker.journey", check: name, status: "pass" });
  } catch (error) {
    const diagnostic = name.includes("managed_verified")
      ? "Managed account flow failed; sensitive form diagnostics suppressed"
      : error instanceof Error
        ? error.message.split("\n")[0]!.slice(0, 240)
        : "Assertion failed";
    checks.push({ name, status: "fail", diagnostic });
    process.exitCode = 1;
    logger.error({ event: "checker.journey_check_failed", check: name, phase, diagnostic });
    if (name.startsWith("task_") && page?.url().includes("/workspace/tasks"))
      // Best-effort failure capture; the failed check is already recorded above.
      await page
        .screenshot({
          path: fileURLToPath(
            new URL("../../../../generated-artifacts/valo-checks/task-failure.png", import.meta.url),
          ),
        })
        .catch(() => {});
    // Keep independent journeys running. A failed check is retained, never converted into a pass.
  }
}
async function api(path: string, method = "GET", body?: unknown) {
  return page!.evaluate(
    async ({ path, method, body }) => {
      const r = await fetch(path, {
        method,
        headers: body === undefined ? {} : { "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: r.status === 204 ? null : await r.json() };
    },
    { path, method, body },
  );
}
try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.REPLIT_DEPLOYMENT ||
    process.env.VALO_RUN_CUSTOMER_JOURNEY !== "synthetic-development-only" ||
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
    !process.env.REPLIT_DEV_DOMAIN
  )
    throw Error("SYNTHETIC_DEVELOPMENT_INSTANCE_REQUIRED");
  await clerkSetup({ dotenv: false, debug: false });
  browser = await chromium.launch({
    ...chromiumLaunchPath(),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    viewport: { width: 1280, height: 900 },
  });
  await setupClerkTestingToken({ context });
  page = await context.newPage();
  page.setDefaultTimeout(25000);
  await check("anonymous_progressive_checker_has_real_gaps_and_no_false_exemption", async () => {
    await page!.goto("/checker");
    await expect(page!.getByTestId("text-anonymous")).toBeVisible();
    await page!.getByTestId("button-step-2").click();
    const states = page!.getByTestId("select-state");
    // The prompt to choose, then the 36 states and the FCT. "I do not know" and "Skip for now" are
    // choices beside the list.
    expect(await states.locator("option").count()).toBe(38);
    await states.selectOption("Lagos");
    await page!.getByTestId("button-step-5").click();
    await page!.getByTestId("button-run").click();
    await expect(page!.getByTestId("status-coverage-unavailable")).toBeVisible();
    expect((await api("/api/workspace/assessments")).status).toBe(401);
    await page!.reload();
    await expect(page!.getByTestId("assessment-result")).toHaveCount(0);
  });
  await check("managed_verified_account_and_consented_saved_profile_assessment", async () => {
    await page!.goto("/sign-up");
    await page!.locator(".cl-signUp-root").waitFor();
    for (const [name, value] of [
      ["firstName", "Synthetic"],
      ["lastName", "Checker"],
    ] as const) {
      const field = page!.locator(`input[name="${name}"]`);
      if (await field.isVisible()) await field.fill(value);
    }
    await page!
      .locator('input[name="emailAddress"]')
      .fill(`valo-checker-${randomUUID()}+clerk_test@example.com`);
    const password = page!.locator('input[name="password"]');
    if (await password.isVisible()) await password.fill(`Synthetic-${randomUUID()}!9`);
    const legal = page!.locator('input[name="legalAccepted"]');
    if (await legal.isVisible()) await legal.check();
    await page!.getByRole("button", { name: "Continue", exact: true }).click();
    await page!.getByRole("textbox", { name: "Enter verification code" }).pressSequentially("424242");
    await page!.waitForFunction("Boolean(window.Clerk?.user)", {}, { timeout: 30000 });
    identityId = await page!.evaluate(
      () => (globalThis as unknown as { Clerk: { user: { id: string } } }).Clerk.user.id,
    );
    await page!.goto("/workspace");
    const workspace = GetWorkspaceResponse.parse((await api("/api/workspace")).body);
    expect(
      (
        await api("/api/workspace/profile", "PUT", {
          expectedRevision: workspace.profileRevision,
          profile: { ...syntheticProfile, businessName: "Synthetic checker browser business" },
        })
      ).status,
    ).toBe(200);
    await page!.goto("/checker");
    await page!.getByTestId("button-step-5").click();
    await page!.getByTestId("button-run").click();
    await expect(page!.getByTestId("panel-save")).toBeVisible();
    await page!.getByTestId("radio-save-profile").check();
    await page!.getByTestId("checkbox-save-consent").check();
    await page!.getByTestId("button-save-assessment").click();
    await expect(page!).toHaveURL(/\/workspace\/assessments\/[a-f0-9-]+$/);
    await expect(page!.getByTestId("assessment-result")).toBeVisible();
    await page!.reload();
    await expect(page!.getByTestId("status-coverage-unavailable")).toBeVisible();
  });
  if (!identityId) throw Error("VERIFIED_ACCOUNT_PRECONDITION_FAILED");
  await check("assessment_comparison_keeps_profile_history", async () => {
    const oldId = new URL(page!.url()).pathname.split("/").at(-1)!;
    const current = GetWorkspaceResponse.parse((await api("/api/workspace")).body);
    expect(
      (
        await api("/api/workspace/profile", "PUT", {
          expectedRevision: current.profileRevision,
          profile: { ...current.profile, state: "Bayelsa", employees: "8" },
        })
      ).status,
    ).toBe(200);
    const result = await api("/api/workspace/assessments", "POST", {
      saveConsent: true,
      expectedProfileRevision: current.profileRevision + 1,
      asOfDate: new Date(Date.now() + 3600000).toISOString().slice(0, 10),
    });
    expect(result.status).toBe(201);
    const saved = CreateAssessmentResponse.parse(result.body);
    await page!.goto(`/workspace/assessments/${saved.id}`);
    await page!.getByTestId("select-compare").selectOption(oldId);
    await expect(page!.getByTestId("comparison")).toContainText(/State|state/);
    expect((await api(`/api/workspace/assessments/${oldId}`)).status).toBe(200);
  });
  await check("task_creation_reload_and_user_completion_are_real", async () => {
    await page!.goto("/workspace/tasks");
    await page!.getByTestId("button-new-task").click();
    const form = page!.getByTestId("panel-new-task");
    await form.getByRole("textbox").nth(0).fill("Synthetic browser task");
    await form.getByRole("textbox").nth(1).fill("Synthetic private note retained after reload");
    await form
      .locator('input[type="date"]')
      .fill(new Date(Date.now() + 40 * 86400000).toISOString().slice(0, 10));
    await form.getByRole("checkbox").check();
    await form.locator('button[type="submit"]').click();
    await expect(page!.getByText("Synthetic browser task", { exact: true })).toBeVisible();
    await page!.reload();
    await expect(page!.getByText("Synthetic browser task", { exact: true })).toBeVisible();
    const task = ListTasksResponse.parse((await api("/api/workspace/tasks")).body).find(
      (t) => t.title === "Synthetic browser task",
    )!;
    await page!.getByTestId("tab-all").click();
    phase = "task_completion_and_reopen";
    await page!.getByTestId(`button-toggle-${task.id}`).click();
    await expect
      .poll(
        async () =>
          ListTasksResponse.parse((await api("/api/workspace/tasks")).body).find((t) => t.id === task.id)
            ?.state,
      )
      .toBe("completed_by_user");
    await page!.getByTestId(`button-toggle-${task.id}`).click();
    await expect
      .poll(
        async () =>
          ListTasksResponse.parse((await api("/api/workspace/tasks")).body).find((t) => t.id === task.id)!
            .state,
      )
      .not.toBe("completed_by_user");
  });
  await check("opted_in_reminders_show_held_not_delivery_and_mobile_reflows", async () => {
    await page!.goto("/workspace/reminders");
    phase = "reminder_switch";
    const toggle = page!.getByTestId("switch-enabled");
    await toggle.focus();
    await toggle.press("Space");
    await expect(toggle).toBeChecked();
    phase = "reminder_save";
    await page!.getByTestId("button-save-prefs").click();
    await expect
      .poll(
        async () => ((await api("/api/workspace/reminder-preferences")).body as { enabled: boolean }).enabled,
      )
      .toBe(true);
    phase = "reminder_held_log";
    await expect(page!.getByTestId("list-reminders")).toContainText(/on hold/i);
    const rows = (await api("/api/workspace/reminders")).body as {
      status: string;
      deliveredAt: string | null;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === "held" && r.deliveredAt === null)).toBe(true);
    phase = "mobile_reflow";
    await page!.setViewportSize({ width: 360, height: 800 });
    expect(
      await page!.evaluate(() => {
        const w = globalThis as unknown as {
          innerWidth: number;
          document: { documentElement: { scrollWidth: number } };
        };
        return w.document.documentElement.scrollWidth <= w.innerWidth;
      }),
    ).toBe(true);
  });
  if (process.env.VALO_RUN_CUSTOMER_AI_BROWSER === "synthetic-development-only") {
    await page!.setViewportSize({ width: 1280, height: 900 });
    for (const task of ["invoice", "quotation", "payment_reminder", "business_proposal"]) {
      await check(`${task}_real_AI_edit_save_private_DOCX_PDF`, async () => {
        await page!.goto("/workspace/ai");
        const taskRadio = page!.getByTestId(`radio-task-${task}`);
        await taskRadio.focus();
        await taskRadio.press("Space");
        for (const [key, value] of Object.entries({
          issuerName: "Synthetic Browser Business",
          recipientName: "Synthetic Browser Buyer",
          documentNumber: `SYN-${task}`,
          issueDate: "2026-11-13",
          dueDate: "2026-11-20",
        })) {
          const input = page!.getByTestId(`input-ai-${key}`);
          if (await input.isVisible()) await input.fill(value);
        }
        if (task !== "payment_reminder") {
          if (!(await page!.getByTestId("input-ai-desc-0").isVisible()))
            await page!.getByTestId("button-ai-add-line").click();
          await page!.getByTestId("input-ai-desc-0").fill("Synthetic design service");
          await page!.getByTestId("input-ai-qty-0").fill("2");
          await page!.getByTestId("input-ai-price-0").fill("1250");
        } else await page!.getByTestId("input-ai-due").fill("2500");
        await page!.getByTestId("input-note-0").fill("Scope: Prepare the supplied design files for review.");
        const note = page!.getByTestId("checkbox-note-0");
        if (!(await note.isChecked())) {
          await note.focus();
          await note.press("Space");
        }
        const consent = page!.getByTestId("checkbox-ai-consent");
        await consent.focus();
        await consent.press("Space");
        const ready = page!.waitForResponse(
          (r) => r.url().endsWith("/api/workspace/ai-drafts") && r.request().method() === "POST",
          { timeout: 50000 },
        );
        await page!.getByTestId("button-ai-draft").click();
        const response = await ready;
        expect(response.status()).toBe(200);
        const preview = CreateCustomerAIDraftResponse.parse(await response.json());
        expect(preview.status).toBe("ready");
        expect(preview.providerCalls).toBeGreaterThan(0);
        expect(preview.modelUsed).toBeTruthy();
        await expect(page!).toHaveURL(new RegExp(`/workspace/ai/${preview.id}$`));
        await page!.reload();
        await expect(page!.getByTestId("input-ai-title")).toBeVisible();
        const text = page!.getByTestId("input-ai-block-0");
        await text.fill((await text.inputValue()) + "\nUser-edited synthetic note.");
        const confirm = page!.getByTestId("checkbox-confirm-draft");
        await confirm.focus();
        await confirm.press("Space");
        await page!.getByTestId("button-accept-draft").click();
        await expect(page!).toHaveURL(/\/workspace\/documents\/[a-f0-9-]+$/);
        const docId = new URL(page!.url()).pathname.split("/").at(-1)!;
        const saved = GetDocumentResponse.parse((await api(`/api/workspace/documents/${docId}`)).body);
        expect(saved.content.blocks.some((b) => b.text.includes("User-edited synthetic note."))).toBe(true);
        await page!.reload();
        await expect(page!.getByTestId("panel-financial")).toBeVisible();
        const panel = page!.getByTestId("private-exports"),
          ack = panel.getByRole("checkbox");
        await ack.focus();
        await ack.press("Space");
        await panel.getByRole("button", { name: "Make a Word file", exact: true }).click();
        await panel.getByRole("button", { name: "Make a PDF file", exact: true }).click();
        let jobs: ReturnType<typeof ListDocumentExportsResponse.parse> = [];
        await expect
          .poll(
            async () => {
              const r = await api(`/api/v1/documents/${docId}/exports`);
              expect(r.status).toBe(200);
              jobs = ListDocumentExportsResponse.parse(r.body);
              return jobs.filter((j) => j.status === "ready" && j.revisionId === saved.revisionId).length;
            },
            { timeout: 90000, intervals: [1000, 1500, 2000] },
          )
          .toBe(2);
        const anonymous = await request.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
        const dir = await mkdtemp(join(tmpdir(), "valo-ai-browser-"));
        try {
          for (const format of ["docx", "pdf"]) {
            const job = jobs.find((j) => j.format === format && j.revisionId === saved.revisionId)!;
            expect(job.sourceHash).toBe(saved.contentHash);
            const download = await context.request.get(job.downloadUrl!);
            expect(download.status()).toBe(200);
            expect(download.headers()["cache-control"]).toContain("no-store");
            const bytes = await download.body(),
              checksum = createHash("sha256").update(bytes).digest("hex");
            expect(checksum).toBe(job.checksum);
            let bodyText: string;
            if (format === "docx") {
              const zip = unzipSync(bytes);
              expect(zip["[Content_Types].xml"]).toBeTruthy();
              bodyText = strFromU8(zip["word/document.xml"]!);
            } else {
              expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
              const path = join(dir, "synthetic.pdf");
              await writeFile(path, bytes);
              bodyText = execFileSync("pdftotext", [path, "-"], { encoding: "utf8", timeout: 10000 });
            }
            expect(bodyText).toContain("2,500.00");
            expect(bodyText).toContain("₦");
            expect(bodyText).toContain("User-edited synthetic note.");
            const denied = await anonymous.get(job.downloadUrl!);
            expect(denied.status()).toBe(401);
            financialExports.push({
              task,
              format,
              revisionId: saved.revisionId,
              checksum,
              bytes: bytes.length,
              privateHeaders: true,
              anonymousStatus: denied.status(),
              model: preview.modelUsed,
              providerCalls: preview.providerCalls,
              parsedAndTextChecked: true,
            });
          }
        } finally {
          await anonymous.dispose();
          await rm(dir, { recursive: true, force: true });
        }
      });
    }
  }
} catch {
  logger.error({ event: "checker.journey_failed", phase });
  process.exitCode = 1;
} finally {
  if (identityId)
    await clerkClient.users.deleteUser(identityId).catch(() => {
      process.exitCode = 1;
    });
  await browser?.close();
  await writeFile(
    fileURLToPath(new URL("../../../../docs/valo/evidence/checker-customer-journey.json", import.meta.url)),
    JSON.stringify(
      {
        ...report,
        finishedAt: new Date().toISOString(),
        syntheticAppRowsRetained: true,
        verifiedAccountFlowPassed: checks.some(
          (c) =>
            c.name === "managed_verified_account_and_consented_saved_profile_assessment" &&
            c.status === "pass",
        ),
      },
      null,
      2,
    ) + "\n",
  );
}
