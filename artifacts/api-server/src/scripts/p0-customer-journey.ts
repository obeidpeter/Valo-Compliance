import { randomUUID, createHash } from "node:crypto";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { chromium, expect, request, type Page, type Browser } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { clerkClient } from "@clerk/express";
import { logger } from "../platform/logger";
import { nigerianStates } from "../lib/valo-validation";
import {
  GetWorkspaceResponse,
  GetDocumentResponse,
  ListDocumentRevisionsResponse,
  ListDocumentExportsResponse,
} from "@workspace/api-zod";
import { chromiumLaunchPath } from "../platform/chromium";

// Browser callbacks are serialised by Playwright. Keep DOM types out of the Node service.
type BrowserProbe = {
  Clerk: { user?: { id: string }; session: { id: string } };
  innerWidth: number;
  location: { pathname: string };
  document: {
    documentElement: { scrollWidth: number };
    querySelectorAll(selector: string): ArrayLike<{
      name: string;
      type: string;
      offsetParent: unknown;
      innerText: string;
      textContent: string | null;
    }>;
  };
};

const checks: { name: string; status: "passed" | "failed"; durationMs: number }[] = [];
let phase = "development_guard",
  browser: Browser | undefined,
  activePage: Page | undefined;
const email = `valo-p0-${randomUUID()}+clerk_test@example.com`;
// Ephemeral synthetic credentials stay in process memory, never reports or logs.
const password = `Valo-Synthetic-${randomUUID()}!9`;
let testIdentityId: string | undefined;
const createdIdentities: { id: string; email: string }[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(),
  syntheticOnly: true,
  managedProviderTestMode: true,
  actualEmailDeliveryTested: false,
  checks,
  p0Accepted: false,
  r1Accepted: false,
  r2Unlocked: false,
  isolatedDatabaseRestoreTested: false,
};
async function check(name: string, fn: () => Promise<void>) {
  phase = name;
  const started = performance.now();
  try {
    await fn();
    checks.push({ name, status: "passed", durationMs: Math.round(performance.now() - started) });
    logger.info({ event: "p0.journey_check", check: name, status: "passed" });
  } catch {
    checks.push({ name, status: "failed", durationMs: Math.round(performance.now() - started) });
    throw Error("JOURNEY_CHECK_FAILED");
  }
}
async function fillIfVisible(page: Page, name: string, value: string) {
  const field = page.locator(`input[name="${name}"]`);
  if (await field.isVisible()) await field.fill(value);
}
try {
  if (
    process.env.NODE_ENV !== "development" ||
    process.env.REPLIT_DEPLOYMENT ||
    process.env.VALO_RUN_CUSTOMER_JOURNEY !== "synthetic-development-only" ||
    !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") ||
    !process.env.REPLIT_DEV_DOMAIN
  )
    throw Error("DEVELOPMENT_TEST_INSTANCE_REQUIRED");
  const domain = process.env.REPLIT_DEV_DOMAIN,
    base = `https://${domain}`;
  phase = "provider_testing_setup";
  // Preview uses Clerk's direct development FAPI. Let the official helper
  // derive it from the configured publishable key; don't assume the production proxy.
  await clerkSetup({ dotenv: false, debug: false });
  browser = await chromium.launch({
    ...chromiumLaunchPath(),
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({ baseURL: base, viewport: { width: 1280, height: 900 } });
  await setupClerkTestingToken({ context });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(20000);
  await check("signup_and_unverified_workspace_denial", async () => {
    phase = "signup_load";
    await page.goto("/sign-up");
    phase = "signup_wait_form";
    await page.locator(".cl-signUp-root").waitFor();
    await fillIfVisible(page, "firstName", "Synthetic");
    await fillIfVisible(page, "lastName", "Customer");
    phase = "signup_fill";
    await page.locator('input[name="emailAddress"]').fill(email);
    await fillIfVisible(page, "password", password);
    const accepted = page.locator('input[name="legalAccepted"]');
    if (await accepted.isVisible()) await accepted.check();
    phase = "signup_submit";
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    phase = "signup_wait_verification";
    await page.getByRole("textbox", { name: "Enter verification code" }).waitFor({ timeout: 30000 });
    const status = await page.evaluate(async () => (await fetch("/api/workspace")).status);
    expect([401, 403]).toContain(status);
    report.unverifiedWorkspaceStatus = status;
  });
  await check("managed_email_test_verification_and_workspace", async () => {
    await page.getByRole("textbox", { name: "Enter verification code" }).pressSequentially("424242");
    await page.waitForFunction(
      () => Boolean((globalThis as unknown as BrowserProbe).Clerk?.user),
      {},
      { timeout: 30000 },
    );
    testIdentityId = await page.evaluate(() => (globalThis as unknown as BrowserProbe).Clerk.user!.id);
    createdIdentities.push({ id: testIdentityId, email });
    await page.goto("/workspace");
    await expect(page.getByTestId("link-new-document")).toBeVisible({ timeout: 30000 });
    const workspace = await page.evaluate(async () => {
      const r = await fetch("/api/workspace");
      return { status: r.status, body: await r.json() };
    });
    const body = GetWorkspaceResponse.parse(workspace.body);
    expect(workspace.status).toBe(200);
    expect(body.profileRevision).toBe(0);
    report.workspaceId = body.id;
  });
  await check("profile_all_states_unknowns_and_marketing_decline", async () => {
    await page.goto("/workspace/profile");
    await expect(page.getByTestId("input-business-name")).toBeVisible();
    await page.getByTestId("input-business-name").fill("Synthetic P0 business");
    await page.getByTestId("input-activity-0").fill("Synthetic software service");
    const states = page.getByTestId("input-state");
    expect(await states.locator("option").count()).toBe(39);
    for (const state of nigerianStates) {
      await states.selectOption(state);
      await expect(states).toHaveValue(state);
    }
    await states.selectOption("unknown");
    await expect(page.getByTestId("checkbox-marketing")).not.toBeChecked();
    await page.getByTestId("button-save-profile").click();
    await expect(page.getByTestId("text-profile-revision")).toContainText("revision 1");
    await page.reload();
    await expect(page.getByTestId("input-business-name")).toHaveValue("Synthetic P0 business");
    await expect(states).toHaveValue("unknown");
    await expect(page.getByTestId("checkbox-marketing")).not.toBeChecked();
  });
  await check("saved_document_autosave_reload_and_preview", async () => {
    await page.goto("/workspace/documents/new");
    await page.getByTestId("button-new-draft").click();
    await expect(page.getByTestId("input-title")).toBeVisible();
    report.documentId = new URL(page.url()).pathname.split("/").at(-1);
    await page.getByTestId("input-title").fill("Synthetic P0 saved draft");
    await page.getByTestId("input-field-issuerName").fill("Synthetic P0 business");
    await page.getByTestId("input-field-recipientName").fill("Synthetic Recipient");
    await page.getByTestId("input-field-documentNumber").fill("SYNTHETIC-001");
    await page.getByTestId("input-field-issueDate").fill("2026-11-13");
    await page
      .getByTestId("input-block-0")
      .fill("Synthetic P0 body with naira ₦12,500. No verified payment or legal claim.");
    await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 30000 });
    await page.reload();
    await expect(page.getByTestId("input-title")).toHaveValue("Synthetic P0 saved draft");
    await expect(page.getByTestId("input-block-0")).toHaveValue(/Synthetic P0 body/);
    await page.getByTestId("tab-preview").click();
    await expect(page.getByTestId("preview-doc")).toContainText("Synthetic P0 body");
  });
  const documentId = String(report.documentId);
  const saved = GetDocumentResponse.parse(
    await (await context.request.get(`${base}/api/workspace/documents/${documentId}`)).json(),
  );
  report.savedRevision = { id: saved.revisionId, number: saved.revision, hash: saved.contentHash };
  let exports: ReturnType<typeof ListDocumentExportsResponse.parse> = [];
  await check("real_private_DOCX_PDF_same_revision_and_anonymous_denial", async () => {
    const panel = page.getByTestId("private-exports");
    await panel.getByRole("checkbox").check();
    await panel.getByRole("button", { name: "Make a Word file", exact: true }).click();
    await panel.getByRole("button", { name: "Make a PDF file", exact: true }).click();
    await expect
      .poll(
        async () => {
          const r = await context.request.get(`${base}/api/v1/documents/${documentId}/exports`);
          expect(r.status()).toBe(200);
          exports = ListDocumentExportsResponse.parse(await r.json());
          return exports.filter((j) => j.status === "ready" && j.revisionId === saved.revisionId).length;
        },
        { timeout: 90000 },
      )
      .toBe(2);
    const anonymous = await request.newContext({ baseURL: base });
    const temp = await mkdtemp(join(tmpdir(), "valo-synthetic-export-"));
    const files: Record<string, unknown>[] = [];
    try {
      for (const format of ["docx", "pdf"]) {
        const job = exports.find((j) => j.format === format && j.revisionId === saved.revisionId);
        if (!job?.downloadUrl || !job.checksum) throw Error("READY_EXPORT_CONTRACT_INVALID");
        expect(job.sourceHash).toBe(saved.contentHash);
        const response = await context.request.get(job.downloadUrl);
        expect(response.status()).toBe(200);
        expect(response.headers()["cache-control"]).toContain("no-store");
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: 30000 }),
          panel
            .getByRole("link", {
              name: `Download the ${format === "docx" ? "Word" : "PDF"} file`,
              exact: true,
            })
            .click(),
        ]);
        const stream = await download.createReadStream(),
          parts: Buffer[] = [];
        if (!stream) throw Error("DOWNLOAD_STREAM_MISSING");
        for await (const bytes of stream) parts.push(Buffer.from(bytes));
        const bytes = Buffer.concat(parts),
          digest = createHash("sha256").update(bytes).digest("hex");
        expect(digest).toBe(job.checksum);
        const path = join(temp, `synthetic.${format}`);
        await writeFile(path, bytes);
        let text: string;
        if (format === "docx") {
          expect(bytes.subarray(0, 2).toString()).toBe("PK");
          const xml = unzipSync(bytes)["word/document.xml"];
          if (!xml) throw Error("DOCX_XML_MISSING");
          text = strFromU8(xml);
        } else {
          expect(bytes.subarray(0, 4).toString()).toBe("%PDF");
          text = execFileSync("pdftotext", [path, "-"], {
            encoding: "utf8",
            timeout: 10000,
            maxBuffer: 2 * 1024 * 1024,
          });
        }
        expect(text).toContain("Synthetic P0 body");
        expect(text).toContain("₦12,500");
        const denied = await anonymous.get(job.downloadUrl);
        expect(denied.status()).toBe(401);
        files.push({
          format,
          jobId: job.id,
          revisionId: job.revisionId,
          checksum: digest,
          bytes: bytes.length,
          anonymousStatus: denied.status(),
          privateHeaders: true,
          openedAndTextChecked: true,
        });
      }
      report.exports = files;
    } finally {
      await anonymous.dispose();
      await rm(temp, { recursive: true, force: true });
    }
  });
  let secondPage: Page | undefined;
  await check("new_browser_session_sees_saved_profile_and_document", async () => {
    const second = await browser!.newContext({ baseURL: base, viewport: { width: 360, height: 800 } });
    await setupClerkTestingToken({ context: second });
    secondPage = await second.newPage();
    activePage = secondPage;
    secondPage.setDefaultTimeout(25000);
    await secondPage.goto("/sign-in");
    await secondPage.locator('input[name="identifier"]').fill(email);
    const passwordInitiallyVisible = await secondPage.locator('input[name="password"]').isVisible();
    if (passwordInitiallyVisible) await secondPage.locator('input[name="password"]').fill(password);
    await secondPage.getByRole("button", { name: "Continue", exact: true }).click();
    const signedIn = () =>
      secondPage!.evaluate(() => Boolean((globalThis as unknown as BrowserProbe).Clerk?.user));
    const otp = secondPage.getByRole("textbox", { name: "Enter verification code" });
    if (!passwordInitiallyVisible) {
      await expect
        .poll(
          async () =>
            (await signedIn()) ||
            (await secondPage!.locator('input[name="password"]').isVisible()) ||
            (await otp.isVisible()),
          { timeout: 30000 },
        )
        .toBe(true);
    }
    if (
      !(await signedIn()) &&
      (await secondPage.locator('input[name="password"]').isVisible()) &&
      !passwordInitiallyVisible
    ) {
      await secondPage.locator('input[name="password"]').fill(password);
      await secondPage.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await expect
      .poll(async () => (await signedIn()) || (await otp.isVisible()), { timeout: 30000 })
      .toBe(true);
    if (!(await signedIn()) && (await otp.isVisible())) await otp.pressSequentially("424242");
    await secondPage.waitForFunction(
      () => Boolean((globalThis as unknown as BrowserProbe).Clerk?.user),
      {},
      { timeout: 30000 },
    );
    await secondPage.goto("/workspace");
    await expect(secondPage.getByTestId("text-business-name")).toHaveText("Synthetic P0 business");
    await secondPage.goto(`/workspace/documents/${documentId}`);
    await expect(secondPage.getByTestId("input-title")).toHaveValue("Synthetic P0 saved draft");
    expect(
      await secondPage.evaluate(() => {
        const w = globalThis as unknown as BrowserProbe;
        return w.document.documentElement.scrollWidth <= w.innerWidth;
      }),
    ).toBe(true);
    report.mobileViewport = { width: 360, height: 800, noHorizontalOverflow: true };
  });
  activePage = page;
  await check("two_tabs_conflict_preserves_unsaved_text_then_explicit_save", async () => {
    await page.getByTestId("input-title").fill("Synthetic writer one");
    await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 30000 });
    await secondPage!.getByTestId("input-title").fill("Synthetic writer two preserved");
    await expect(secondPage!.getByTestId("status-save")).toContainText("changed somewhere else", {
      timeout: 30000,
    });
    await expect(secondPage!.getByTestId("input-title")).toHaveValue("Synthetic writer two preserved");
    await secondPage!.getByTestId("button-keep-mine").click();
    await expect(secondPage!.getByTestId("status-save")).toContainText("Saved", { timeout: 30000 });
    await page.reload();
    await expect(page.getByTestId("input-title")).toHaveValue("Synthetic writer two preserved");
  });
  await check("revision_restore_appends_and_preserves_previous_history", async () => {
    const before = GetDocumentResponse.parse(
      await (await context.request.get(`${base}/api/workspace/documents/${documentId}`)).json(),
    );
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByTestId(`button-restore-${saved.revision}`).click();
    await expect(page.getByTestId("input-title")).toHaveValue("Synthetic P0 saved draft");
    await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 30000 });
    const after = GetDocumentResponse.parse(
      await (await context.request.get(`${base}/api/workspace/documents/${documentId}`)).json(),
    );
    const history = ListDocumentRevisionsResponse.parse(
      await (await context.request.get(`${base}/api/workspace/documents/${documentId}/revisions`)).json(),
    );
    expect(after.revision).toBeGreaterThan(before.revision);
    expect(history.find((r) => r.revision === saved.revision)?.contentHash).toBe(saved.contentHash);
    expect(history.some((r) => r.title === "Synthetic writer two preserved")).toBe(true);
    report.revisionRestore = {
      newRevision: after.revision,
      preservedHash: saved.contentHash,
      databaseDisasterRecovery: false,
    };
  });
  await check("two_verified_businesses_cannot_substitute_document_or_export_identifiers", async () => {
    const otherEmail = `valo-p0-other-${randomUUID()}+clerk_test@example.com`;
    const other = await browser!.newContext({ baseURL: base });
    await setupClerkTestingToken({ context: other });
    const otherPage = await other.newPage();
    activePage = otherPage;
    otherPage.setDefaultTimeout(25000);
    await otherPage.goto("/sign-up");
    await otherPage.locator('input[name="emailAddress"]').fill(otherEmail);
    await fillIfVisible(otherPage, "password", password);
    await otherPage.getByRole("button", { name: "Continue", exact: true }).click();
    await otherPage.getByRole("textbox", { name: "Enter verification code" }).pressSequentially("424242");
    await otherPage.waitForFunction(
      () => Boolean((globalThis as unknown as BrowserProbe).Clerk?.user),
      {},
      { timeout: 30000 },
    );
    const otherId = await otherPage.evaluate(() => (globalThis as unknown as BrowserProbe).Clerk.user!.id);
    createdIdentities.push({ id: otherId, email: otherEmail });
    await otherPage.goto("/workspace");
    await expect(otherPage.getByTestId("link-new-document")).toBeVisible();
    const own = GetWorkspaceResponse.parse(await (await other.request.get("/api/workspace")).json());
    expect(own.id).not.toBe(report.workspaceId);
    expect(own.profileRevision).toBe(0);
    const spoof = GetWorkspaceResponse.parse(
      await (
        await other.request.get(`/api/workspace?workspaceId=${String(report.workspaceId)}`, {
          headers: { "X-Workspace-Id": String(report.workspaceId) },
        })
      ).json(),
    );
    expect(spoof.id).toBe(own.id);
    const substitutions = [
      `/api/workspace/documents/${documentId}`,
      `/api/workspace/documents/${documentId}/revisions`,
      `/api/v1/documents/${documentId}/exports`,
      ...exports.map((job) => job.downloadUrl!),
    ];
    for (const path of substitutions) expect((await other.request.get(path)).status()).toBe(404);
    for (const job of exports) {
      const status = await otherPage.evaluate(
        async (id) =>
          (
            await fetch(`/api/v1/exports/${id}/retry`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            })
          ).status,
        job.id,
      );
      expect(status).toBe(404);
    }
    await otherPage.goto("/workspace/documents/new");
    await otherPage.getByTestId("button-new-draft").click();
    await expect(otherPage.getByTestId("input-title")).toBeVisible();
    const otherDocumentId = new URL(otherPage.url()).pathname.split("/").at(-1);
    expect((await context.request.get(`/api/workspace/documents/${otherDocumentId}`)).status()).toBe(404);
    report.tenantIsolation = {
      verifiedBusinesses: 2,
      readSubstitutions: substitutions.length + 1,
      retrySubstitutions: exports.length,
      spoofedWorkspaceIgnored: true,
    };
    await other.close();
    activePage = page;
  });
  await check("revoked_provider_session_cannot_read_workspace_or_private_files", async () => {
    const sessionId = await secondPage!.evaluate(
      () => (globalThis as unknown as BrowserProbe).Clerk.session.id,
    );
    const stale = await request.newContext({
      baseURL: base,
      storageState: await secondPage!.context().storageState(),
    });
    try {
      expect((await stale.get("/api/workspace")).status()).toBe(200);
      await clerkClient.sessions.revokeSession(sessionId);
      expect((await stale.get("/api/workspace")).status()).toBe(401);
      for (const job of exports) {
        if (!job.downloadUrl) throw Error("READY_EXPORT_URL_MISSING");
        expect((await stale.get(job.downloadUrl)).status()).toBe(401);
      }
    } finally {
      await stale.dispose();
    }
  });
  await check("logout_removes_private_endpoint_access", async () => {
    await page.getByTestId("button-signout").click();
    await expect
      .poll(async () => (await context.request.get(`${base}/api/workspace`)).status(), { timeout: 15000 })
      .toBe(401);
  });
  report.execution = "passed";
} catch {
  report.execution = "failed";
  report.failedPhase = phase;
  process.exitCode = 1;
  if (activePage) {
    try {
      report.failureUi = await activePage.evaluate(() => {
        const { document, location } = globalThis as unknown as BrowserProbe;
        return {
          path: location.pathname,
          inputs: Array.from(document.querySelectorAll("input")).map((e) => ({
            name: e.name,
            type: e.type,
            visible: Boolean(e.offsetParent),
          })),
          buttons: Array.from(document.querySelectorAll("button"))
            .map((e) => e.innerText)
            .filter(Boolean),
          alerts: Array.from(document.querySelectorAll('[role="alert"],.cl-formFieldErrorText')).map((e) =>
            e.textContent?.slice(0, 250),
          ),
        };
      });
      await activePage.screenshot({
        path: new URL("../../../../generated-artifacts/valo-checks/p0-customer-failure.png", import.meta.url)
          .pathname,
      });
    } catch {
      report.failureCapture = "unavailable";
    }
  }
  logger.error({ event: "p0.customer_journey_failed", phase, code: "JOURNEY_CHECK_FAILED" });
} finally {
  await browser?.close();
  for (const identity of createdIdentities) {
    try {
      const user = await clerkClient.users.getUser(identity.id);
      if (user.emailAddresses.some((e) => e.emailAddress === identity.email)) {
        await clerkClient.users.deleteUser(identity.id);
        report.syntheticIdentityCleanup = "deleted_test_user";
      }
    } catch {
      report.syntheticIdentityCleanup = "failed";
      process.exitCode = 1;
    }
  }
  report.completedAt = new Date().toISOString();
  await writeFile(
    new URL("../../../../docs/valo/evidence/p0-customer-journey.json", import.meta.url),
    JSON.stringify(report, null, 2) + "\n",
  );
}
