import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Page, type Browser } from "@playwright/test";
import { clerkSetup, setupClerkTestingToken } from "@clerk/testing/playwright";
import { mkdir as ensureReminderDirectory } from "node:fs/promises";
import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import {
  GetCustomerAccountResponse,
  GetDocumentResponse,
  DownloadWorkspaceDataResponse,
  GetCustomerPurchasesResponse,
} from "@workspace/api-zod";
import { ListPrivacyCasesResponse, GetPrivacyCaseResponse } from "@workspace/api-zod";
import { z } from "zod";
import { syntheticDocument } from "../lib/valo-test-fixtures";
import { synchronizeFinancialBlocks } from "@workspace/valo-core/money";
import { runGuidedCustomerJourneys } from "./customer-guided-journeys";
import { deletePrivateFile } from "../lib/valo-private-storage";
const checks: { name: string; status: string; diagnostic?: string }[] = [];
const run = randomUUID(),
  email = `valo-ux-${run}+clerk_test@example.com`;
let browser: Browser | undefined,
  page: Page | undefined,
  userId: string | undefined,
  workspaceId: string | undefined;
let unknownAck: string | undefined,
  phase = "guard";
const ownIntakeIds: string[] = [];
const ownCommercePriceIds: string[] = [];
let guidedDetails: unknown[] = [];
async function check(name: string, fn: () => Promise<void>) {
  if (
    process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "guided" &&
    name !== "managed_verified_customer_can_open_private_routes" &&
    !name.startsWith("real_guided_")
  )
    return;
  if (
    process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "support-details" &&
    ![
      "managed_verified_customer_can_open_private_routes",
      "controlled_support_display_preserves_mixed_full_messages_and_keyboard_mobile",
      "real_private_privacy_request_reload_and_JSON_download",
      "real_privacy_verification_cancellation_history_and_staff_denial",
    ].includes(name)
  )
    return;
  if (
    process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "editor-safety" &&
    ![
      "managed_verified_customer_can_open_private_routes",
      "real_editor_navigation_financial_restore_undo_and_concurrent_session",
      "real_task_notes_survive_filters_background_refresh_and_revision_conflict",
      "real_reminder_optout_without_offsets_survives_reload",
    ].includes(name)
  )
    return;
  if (
    process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "reminder" &&
    ![
      "managed_verified_customer_can_open_private_routes",
      "real_manual_reminder_records_past_due_dates_and_mobile_keyboard_flow",
    ].includes(name)
  )
    return;
  if (
    process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "commerce" &&
    ![
      "public_auth_fields_and_account_help_reflow_without_clipping",
      "managed_verified_customer_can_open_private_routes",
      "real_private_purchase_history_empty_state_mobile_and_api_controls",
    ].includes(name)
  )
    return;
  phase = name;
  try {
    await fn();
    checks.push({ name, status: "pass" });
  } catch (error) {
    const safe = await page
      ?.evaluate(
        `({path:location.pathname,headings:document.querySelectorAll("main h1").length,
      width:innerWidth,scroll:document.documentElement.scrollWidth,focus:document.activeElement?.tagName,
      focusOutline:document.activeElement?getComputedStyle(document.activeElement).outline:null,
      focusId:document.activeElement?.id,focusVisible:document.activeElement?.matches(":focus-visible"),
      alerts:Array.from(document.querySelectorAll('[role="alert"]')).slice(0,4).map(e=>e.textContent?.slice(0,350)),
      overflow:Array.from(document.querySelectorAll("main *")).filter(e=>e.getBoundingClientRect().right>innerWidth+1)
        .slice(0,5).map(e=>({tag:e.tagName,class:String(e.className)}))})`,
      )
      .catch(() => null);
    const location =
      error instanceof Error
        ? error.stack
            ?.split("\n")
            .find((line) => /customer-(experience-journey|guided-journeys)\.ts:\d/.test(line))
        : undefined;
    checks.push({
      name,
      status: "fail",
      diagnostic: JSON.stringify({ state: safe ?? "Unavailable; raw form details suppressed", location }),
    });
    process.exitCode = 1;
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
      return { status: r.status, cache: r.headers.get("cache-control"), body: await r.json() };
    },
    { path, method, body },
  );
}
async function reflow() {
  expect(await page!.evaluate("document.documentElement.scrollWidth<=innerWidth")).toBe(true);
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
    executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || "/repl/tools/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
    baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
    viewport: { width: 1280, height: 900 },
  });
  await setupClerkTestingToken({ context });
  page = await context.newPage();
  page.setDefaultTimeout(20000);
  await check("desktop_exact_hero_and_public_about_contact_routes", async () => {
    await page!.goto("/");
    await expect(page!.getByTestId("text-headline")).toHaveText(
      "The documents you need. The business rules you should know.",
    );
    for (const path of [
      "/about",
      "/contact",
      "/account-access",
      "/help",
      "/library",
      "/resources",
      "/industries",
    ]) {
      await page!.goto(path);
      await expect(page!.locator("main h1")).toHaveCount(1);
      await reflow();
    }
  });
  await check("catalogue_pagination_first_full_final_empty_and_keyboard_filter_fixtures", async () => {
    let total = 45;
    await page!.route("**/api/public/catalogue*", (r) => {
      const p = Number(new URL(r.request().url()).searchParams.get("page") ?? 1);
      return r.fulfill({
        json: {
          page: p,
          total,
          heldTemplates: 40,
          items: Array.from({ length: Math.max(0, Math.min(20, total - (p - 1) * 20)) }, (_, i) => ({
            id: `fixture-${(p - 1) * 20 + i}`,
            slug: `fixture-${(p - 1) * 20 + i}`,
            title: `Pagination fixture ${(p - 1) * 20 + i}`,
            type: "template",
            industry: "All industries",
            summary: "Browser-only pagination fixture; not a release.",
          })),
        },
      });
    });
    await page!.goto("/library");
    await expect(page!.getByTestId("button-prev")).toBeDisabled();
    await expect(page!.getByTestId("button-next")).toBeEnabled();
    await page!.getByTestId("button-next").click();
    await expect(page!).toHaveURL(/page=2/);
    await expect(page!.getByTestId("button-next")).toBeEnabled();
    await page!.getByTestId("button-next").click();
    await expect(page!).toHaveURL(/page=3/);
    await expect(page!.getByTestId("button-next")).toBeDisabled();
    await page!.getByTestId("button-prev").click();
    await expect(page!).toHaveURL(/page=2/);
    await page!.goto("/library?page=4");
    await expect(page!.getByRole("link", { name: /Pagination fixture/ })).toHaveCount(0);
    const next = page!.getByTestId("button-next");
    if (await next.count()) await expect(next).toBeDisabled();
    total = 0;
    await page!.goto("/library");
    await expect(page!.getByRole("link", { name: /Pagination fixture/ })).toHaveCount(0);
    const filters = page!.getByRole("group", { name: "Content type filters" });
    await expect(filters.getByRole("tab")).toHaveCount(0);
    await page!.getByTestId("tab-type-guidance").focus();
    await page!.keyboard.press("Space");
    await expect(page!.getByTestId("tab-type-guidance")).toHaveAttribute("aria-pressed", "true");
    await expect(page!).toHaveURL(/type=guidance/);
    await page!.unroute("**/api/public/catalogue*");
  });
  async function editorSafetyJourney() {
    const input = structuredClone(syntheticDocument);
    input.title = "Synthetic editor safety";
    input.content = synchronizeFinancialBlocks({
      ...input.content,
      financialInput: {
        kind: "invoice" as const,
        lines: [{ description: "Synthetic goods", quantity: "1", unitPriceKobo: "10000" }],
        taxAmountKobo: null,
        taxLabel: "",
        discountKobo: null,
        amountDueKobo: null,
      },
    });
    input.content.blocks.push({
      id: "unresolved-party",
      type: "paragraph",
      text: "Counterparty: [Counterparty address]",
      rows: [],
    });
    input.content = synchronizeFinancialBlocks(input.content);
    const created = await api("/api/workspace/documents", "POST", input);
    expect(created.status).toBe(201);
    const saved = GetDocumentResponse.parse(created.body),
      url = `/workspace/documents/${saved.id}`,
      endpoint = `/api/workspace/documents/${saved.id}`;
    await page!.goto(url);
    await expect(page!.getByTestId("input-title")).toHaveValue(input.title);
    await expect(page!.getByTestId("card-missing")).toContainText("unresolved template placeholders");
    await expect(page!.getByText("All details filled in", { exact: true })).toHaveCount(0);
    await page!.getByTestId("input-title").fill("Synthetic saved before leaving");
    await page!.getByTestId("link-back").click();
    await expect(page!.getByRole("dialog")).toBeVisible();
    await page!.getByTestId("button-stay-editor").click();
    await expect(page!.getByTestId("input-title")).toHaveValue("Synthetic saved before leaving");
    await page!.getByTestId("link-back").click();
    await page!.getByTestId("button-save-leave").click();
    await expect(page!).toHaveURL(/\/workspace$/);
    expect(GetDocumentResponse.parse((await api(endpoint)).body).title).toBe(
      "Synthetic saved before leaving",
    );
    await page!.goto(url);
    await page!.getByTestId("input-doc-price-0").fill("250.00");
    await expect(page!.getByTestId("status-financial-unsaved")).toBeVisible();
    expect(
      GetDocumentResponse.parse((await api(endpoint)).body).content.financialInput?.lines[0].unitPriceKobo,
    ).toBe("10000");
    await page!.getByTestId("link-back").click();
    await page!.getByTestId("button-save-leave").click();
    await expect(page!).toHaveURL(/\/workspace$/);
    expect(
      GetDocumentResponse.parse((await api(endpoint)).body).content.financialInput?.lines[0].unitPriceKobo,
    ).toBe("25000");
    await page!.goto(url);
    await page!.getByTestId("input-doc-price-0").fill("12x");
    await page!.getByTestId("link-back").click();
    await page!.getByTestId("button-save-leave").click();
    await expect(page!.getByRole("dialog")).toContainText("Correct the financial fields");
    await page!.getByTestId("button-stay-editor").click();
    await expect(page!.getByTestId("input-doc-price-0")).toHaveValue("12x");
    await page!.getByTestId("link-back").click();
    await page!.getByTestId("button-discard-leave").click();
    await expect(page!).toHaveURL(/\/workspace$/);
    expect(
      GetDocumentResponse.parse((await api(endpoint)).body).content.financialInput?.lines[0].unitPriceKobo,
    ).toBe("25000");
    await page!.goto(url);
    await page!.getByTestId("input-doc-price-0").fill("999.00");
    page!.once("dialog", (dialog) => dialog.accept());
    await page!.getByTestId("button-restore-1").click();
    await expect(page!.getByTestId("input-doc-price-0")).toHaveValue("100");
    await expect(page!.getByTestId("button-apply-financial")).toBeDisabled();
    await page!.getByTestId("input-doc-price-0").fill("200.00");
    await page!.getByTestId("button-apply-financial").click();
    await page!.getByTestId("button-undo").click();
    await expect(page!.getByTestId("input-doc-price-0")).toHaveValue("100");
    await expect
      .poll(
        async () =>
          GetDocumentResponse.parse((await api(endpoint)).body).content.financialInput?.lines[0]
            .unitPriceKobo,
      )
      .toBe("10000");
    const other = await page!.context().newPage();
    try {
      await other.goto(url);
      await expect(other.getByTestId("input-doc-price-0")).toHaveValue("100");
      let release: (() => Promise<void>) | undefined;
      await page!.route("**" + endpoint, async (route) => {
        if (route.request().method() !== "PATCH") return route.continue();
        release = () => route.continue();
      });
      await page!.getByTestId("input-title").fill("Synthetic local conflict");
      await expect.poll(() => Boolean(release), { timeout: 20000 }).toBe(true);
      await other.getByTestId("input-doc-price-0").fill("300.00");
      await other.getByTestId("button-apply-financial").click();
      await other.keyboard.press("Control+s");
      await expect
        .poll(
          async () =>
            GetDocumentResponse.parse((await api(endpoint)).body).content.financialInput?.lines[0]
              .unitPriceKobo,
        )
        .toBe("30000");
      await release!();
      await page!.unroute("**" + endpoint);
      await expect(page!.getByTestId("button-load-theirs")).toBeVisible();
      page!.once("dialog", (dialog) => dialog.accept());
      await page!.getByTestId("button-load-theirs").click();
      await expect(page!.getByTestId("input-doc-price-0")).toHaveValue("300");
      await expect(page!.getByTestId("button-apply-financial")).toBeDisabled();
    } finally {
      await other.close();
    }
  }
  await check("real_mobile_menu_keyboard_focus_and360px_public_routes", async () => {
    await page!.setViewportSize({ width: 360, height: 800 });
    for (const path of [
      "/",
      "/about",
      "/contact",
      "/account-access",
      "/help",
      "/library",
      "/resources",
      "/industries",
    ]) {
      await page!.goto(path);
      await expect(page!.locator("main h1")).toHaveCount(1);
      await reflow();
      await page!.keyboard.press("Tab");
      expect(await page!.evaluate("document.activeElement!==document.body")).toBe(true);
      await expect(page!.locator(":focus")).toBeVisible();
    }
    await page!.goto("/industries");
    const menu = page!.getByTestId("button-menu");
    await menu.focus();
    await page!.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await page!.keyboard.press("Tab");
    await page!.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
    const first = page!.locator('main a[href^="/industries/"]').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page!.locator("main h1")).toHaveCount(1);
    await reflow();
  });
  await check("real_anonymous_account_access_form_keyboard_submit_and_durable_ack", async () => {
    await page!.goto("/account-access");
    await page!.getByTestId("input-access-email").fill(`unknown-${run}@example.invalid`);
    await page!
      .getByTestId("input-access-message")
      .fill("Synthetic unable-to-sign-in request; no passwords or confidential records.");
    await page!.getByTestId("button-access-submit").focus();
    const response = page!.waitForResponse(
      (r) => r.url().endsWith("/api/public/access-support") && r.request().method() === "POST",
    );
    await page!.keyboard.press("Enter");
    const r = await response;
    expect(r.status()).toBe(201);
    const ack = await r.json();
    unknownAck = ack.message;
    const id = ack.reference.replace("VALO-ACCESS-", "");
    ownIntakeIds.push(id);
    await expect(page!.getByTestId("access-support-ack")).toBeVisible();
    await reflow();
    expect(ack.delivery).toBe("not_dispatched");
    expect(
      (await pool.query("SELECT status FROM valo_access_support WHERE id=$1", [id])).rows[0].status,
    ).toBe("awaiting_staff");
    const controls = await page!
      .locator('main input:not([type="hidden"]),main textarea')
      .evaluateAll((els) =>
        els
          .filter((e) => e.getAttribute("type") !== "radio" && e.getAttribute("tabindex") !== "-1")
          .every((e) =>
            Boolean(
              (e as unknown as { labels?: ArrayLike<unknown> }).labels?.length ||
              e.getAttribute("aria-label"),
            ),
          ),
      );
    expect(controls).toBe(true);
  });
  await check(
    "released_resource_UI_fixture_links_plain_text_and_withdrawal_are_not_publication",
    async () => {
      // Browser-only response fixtures: never inserted or published in the running database.
      const resource = {
        id: randomUUID(),
        slug: "synthetic-ui-resource",
        title: "Synthetic UI-only resource",
        kind: "guide",
        industrySlugs: [],
        summary: "UI-only response fixture, not released regulatory guidance.",
        body: "UI-only fixture.\n\n<script>window.fixtureExecuted=true</script>",
        reviewedAt: new Date().toISOString(),
        disclosure: "Synthetic browser fixture only; no publication or review claimed.",
        scope: "UI wiring only",
        limitations: "Not real Nigerian guidance",
        sources: [{ url: "https://example.invalid/source", title: "Fixture reference", locator: "Fixture" }],
      };
      let available = true;
      await page!.route("**/api/public/resources", (r) => r.fulfill({ json: available ? [resource] : [] }));
      await page!.route("**/api/public/resources/synthetic-ui-resource", (r) =>
        r.fulfill({ status: available ? 200 : 404, json: available ? resource : { error: "Unavailable" } }),
      );
      await page!.goto("/resources");
      await page!
        .getByRole("link", { name: /Synthetic UI-only resource/ })
        .first()
        .click();
      await expect(page!.locator("main h1")).toHaveText(resource.title);
      expect(await page!.evaluate("window.fixtureExecuted")).toBeUndefined();
      await expect(page!.getByText(resource.body.split("\n\n")[1], { exact: true })).toBeVisible();
      await reflow();
      available = false;
      await page!.reload();
      await expect(page!.locator("main")).toContainText(/unavailable|no longer|withdrawn/i);
      await page!.unroute("**/api/public/resources");
      await page!.unroute("**/api/public/resources/synthetic-ui-resource");
    },
  );
  await check("template_library_detail_preview_UI_fixture_keeps_real_account_and_release_gates", async () => {
    const id = randomUUID(),
      slug = "synthetic-ui-template";
    const row = {
      id,
      slug,
      title: "Synthetic UI-only form",
      type: "template",
      industry: "All industries",
      summary: "UI fixture, not a released document.",
    };
    await page!.route("**/api/public/catalogue*", (r) =>
      r.fulfill({ json: { items: [row], total: 1, page: 1, heldTemplates: 40 } }),
    );
    await page!.route(`**/api/public/templates/${slug}`, (r) =>
      r.fulfill({
        json: {
          ...row,
          templateId: "TPL-07",
          version: 1,
          reviewedAt: new Date().toISOString(),
          reviewBy: new Date(Date.now() + 86400000).toISOString(),
          disclosure: "Synthetic UI fixture, not an actual reviewed or published form.",
          scope: "UI-only wiring",
          limitations: "No actual content eligibility or export demonstrated",
          preview: ["SAMPLE FIELD: Business name [your information]"],
          developmentOnly: true,
          commercialLicenceAccepted: false,
          formats: ["docx", "pdf"],
        },
      }),
    );
    await page!.goto("/library");
    await page!.getByRole("link", { name: /Synthetic UI-only form/ }).click();
    await expect(page!.getByTestId("section-preview")).toContainText("SAMPLE FIELD");
    await expect(page!.getByTestId("link-sign-in")).toBeVisible();
    await expect(page!.getByTestId("button-download-pdf")).toHaveCount(0);
    expect((await api(`/api/workspace/templates/${id}/files/pdf`)).status).toBe(401);
    await page!.unroute("**/api/public/catalogue*");
    await page!.unroute(`**/api/public/templates/${slug}`);
  });
  await check("public_auth_fields_and_account_help_reflow_without_clipping", async () => {
    for (const width of [320, 360, 390, 768, 1280]) {
      await page!.setViewportSize({ width, height: 900 });
      for (const route of ["sign-in", "sign-up"]) {
        await page!.goto(`/${route}`);
        await page!.locator(route === "sign-in" ? ".cl-signIn-root" : ".cl-signUp-root").waitFor();
        await reflow();
        const emailField = page!.locator('input[name="identifier"],input[name="emailAddress"]').first();
        await expect(emailField).toBeVisible();
        const bounds = await emailField.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
        await expect(page!.getByTestId("link-auth-access-help")).toBeVisible();
        await page!.getByTestId("link-auth-access-help").focus();
        await page!.keyboard.press("Enter");
        await expect(page!).toHaveURL(/account-access/);
      }
    }
  });
  await check("managed_verified_customer_can_open_private_routes", async () => {
    await page!.setViewportSize({ width: 1280, height: 900 });
    await page!.goto("/sign-up");
    await page!.locator(".cl-signUp-root").waitFor();
    for (const [name, value] of [
      ["firstName", "Synthetic"],
      ["lastName", "Experience"],
    ] as const) {
      const field = page!.locator(`input[name="${name}"]`);
      if (await field.isVisible()) await field.fill(value);
    }
    await page!.locator('input[name="emailAddress"]').fill(email);
    const password = page!.locator('input[name="password"]');
    if (await password.isVisible()) await password.fill(`Synthetic-${randomUUID()}!9`);
    const legal = page!.locator('input[name="legalAccepted"]');
    if (await legal.isVisible()) await legal.check();
    await page!.getByRole("button", { name: "Continue", exact: true }).click();
    await page!.getByRole("textbox", { name: "Enter verification code" }).pressSequentially("424242");
    await page!.waitForFunction("Boolean(window.Clerk?.user)", {}, { timeout: 30000 });
    userId = await page!.evaluate<string>("window.Clerk.user.id");
    const account = await api("/api/workspace/account");
    expect(account.status).toBe(200);
    workspaceId = GetCustomerAccountResponse.parse(account.body).workspaceId;
    for (const path of [
      "/workspace/checker",
      "/workspace/assessments",
      "/workspace/tasks",
      "/workspace/notifications",
      "/workspace/purchases",
      "/workspace/account",
      "/workspace/privacy",
    ]) {
      await page!.goto(path);
      await expect(page!.locator("main h1").first()).toBeVisible();
      await expect(page!.locator("main")).not.toContainText("Something went wrong");
    }
  });
  if (process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "guided" && userId && workspaceId)
    guidedDetails = await runGuidedCustomerJourneys(page!, api, check);
  await check("controlled_support_display_preserves_mixed_full_messages_and_keyboard_mobile", async () => {
    // The customer really signs in, and really lacks staff permission. Only the
    // display payload below is intercepted; this is NOT a staff/MFA proof.
    expect((await api("/api/admin/operations?area=support")).status).toBe(403);
    const message =
      "Synthetic account-access context. ".repeat(22) +
      "<script>window.__valoSupportXss=1</script> PUBLIC-MESSAGE-END";
    const scope =
      "Privacy request (correction): synthetic workspace details. ".repeat(18) + " PRIVATE-SCOPE-END";
    const publicId = "00000000-0000-4000-8000-000000000001",
      privateId = "00000000-0000-4000-8000-000000000002";
    const records = [
      {
        id: publicId,
        contactEmail: "synthetic-access@example.invalid",
        topic: "sign_in_trouble",
        message,
        status: "awaiting_staff",
        noticeVersion: "synthetic-notice",
        createdAt: "2026-11-14T12:00:00Z",
        kind: "public_access_request",
      },
      {
        id: privateId,
        workspaceId,
        category: "support",
        scope,
        contactEmail: "synthetic-privacy@example.invalid",
        sharingConsent: false,
        consentVersion: "synthetic-consent",
        dispatchStatus: "awaiting_staff",
        createdAt: "2026-11-14T12:01:00Z",
        kind: "workspace_request",
      },
    ];
    await page!.route("**/api/admin/operations*", (route) => {
      const area = new URL(route.request().url()).searchParams.get("area") ?? "content";
      return route.fulfill({
        json: {
          area,
          notice: "Controlled display fixture; not actual authorised staff access.",
          records: area === "support" ? records : [],
        },
      });
    });
    try {
      await page!.goto("/staff");
      await page!.getByTestId("tab-staff-support").click();
      await expect(page!.getByTestId("support-records")).toBeVisible();
      const publicSummary = page!.getByTestId(`support-details-public_access_request-${publicId}`);
      const privateSummary = page!.getByTestId(`support-details-workspace_request-${privateId}`);
      const publicMessage = page!.getByTestId(`support-message-public_access_request-${publicId}`);
      const privateScope = page!.getByTestId(`support-scope-workspace_request-${privateId}`);
      await expect(publicMessage).not.toBeVisible();
      await expect(privateScope).not.toBeVisible();
      await publicSummary.focus();
      await page!.keyboard.press("Enter");
      await expect(publicMessage).toBeVisible();
      expect(await publicMessage.textContent()).toBe(message);
      const outline = z.object({ width: z.number(), style: z.string() }).parse(
        await publicSummary.evaluate((el) => {
          const style = el.ownerDocument.defaultView!.getComputedStyle(el);
          return { width: parseFloat(style.outlineWidth), style: style.outlineStyle };
        }),
      );
      expect(outline.width).toBeGreaterThanOrEqual(2);
      expect(outline.style).not.toBe("none");
      await privateSummary.focus();
      await page!.keyboard.press("Enter");
      await expect(privateScope).toBeVisible();
      expect(await privateScope.textContent()).toBe(scope);
      const privateCard = page!.getByTestId(`support-record-workspace_request-${privateId}`);
      await expect(privateCard.getByText("Category", { exact: true })).toBeVisible();
      await expect(privateCard.getByText("Not given", { exact: true })).toBeVisible();
      await expect(privateCard.getByText("synthetic-privacy@example.invalid", { exact: true })).toBeVisible();
      expect(await page!.evaluate("window.__valoSupportXss===undefined")).toBe(true);
      for (const width of [1280, 360]) {
        await page!.setViewportSize({ width, height: 900 });
        await reflow();
        expect(await publicMessage.textContent()).toBe(message);
        expect(await privateScope.textContent()).toBe(scope);
      }
      await privateSummary.focus();
      await page!.keyboard.press("Space");
      await expect(privateScope).not.toBeVisible();
      await page!.keyboard.press("Space");
      await expect(privateScope).toBeVisible();
    } finally {
      await page!.unroute("**/api/admin/operations*");
    }
  });
  await check("real_editor_navigation_financial_restore_undo_and_concurrent_session", editorSafetyJourney);
  await check("real_task_notes_survive_filters_background_refresh_and_revision_conflict", async () => {
    const body = {
      title: "Synthetic notes safety",
      notes: "Original synthetic notes",
      dueDate: null,
      dateConfirmed: false,
      assessmentId: null,
      ruleId: null,
    };
    const created = await api("/api/workspace/tasks", "POST", body);
    expect(created.status).toBe(201);
    const task = created.body as { id: string; revision: number };
    await page!.goto("/workspace/tasks");
    await page!.getByRole("button", { name: "Edit", exact: true }).first().click();
    const notes = page!.locator("textarea").first();
    await notes.fill("Unsaved synthetic task notes");
    page!.once("dialog", (dialog) => dialog.dismiss());
    await page!.getByTestId("tab-done").click();
    await expect(notes).toHaveValue("Unsaved synthetic task notes");
    let refreshed = false;
    const observe = async (response: import("playwright").Response) => {
      if (
        response.url().includes("/api/workspace/tasks/page") &&
        response.request().method() === "GET" &&
        response.status() === 200
      ) {
        const value = await response.json().catch(() => null);
        if (
          value?.items?.some(
            (item: { id: string; revision: number }) => item.id === task.id && item.revision > task.revision,
          )
        )
          refreshed = true;
      }
    };
    page!.on("response", observe);
    try {
      const updated = await api(`/api/workspace/tasks/${task.id}`, "PATCH", {
        title: body.title,
        notes: "Authoritative synthetic notes",
        dueDate: null,
        dateConfirmed: false,
        state: "not_started",
        expectedRevision: task.revision,
      });
      expect(updated.status).toBe(200);
      // A real background query refresh through the customer control; no timer
      // or headless-tab visibility assumptions and no substituted response.
      await page!.getByTestId("button-refresh-tasks").click();
      await expect.poll(() => refreshed, { timeout: 10000 }).toBe(true);
      await expect(notes).toHaveValue("Unsaved synthetic task notes");
      const conflict = page!.waitForResponse(
        (response) =>
          response.url().endsWith(`/api/workspace/tasks/${task.id}`) &&
          response.request().method() === "PATCH",
      );
      await page!.getByRole("button", { name: "Save changes", exact: true }).click();
      expect((await conflict).status()).toBe(409);
      await expect(page!.getByText("This task changed elsewhere", { exact: true })).toBeVisible();
      await expect(notes).toHaveValue("Unsaved synthetic task notes");
      page!.once("dialog", (dialog) => dialog.accept());
      await page!.getByTestId("tab-done").click();
      await page!.getByTestId("tab-all").click();
      await expect(page!.getByText("Authoritative synthetic notes", { exact: true })).toBeVisible();
      await expect(page!.getByTestId("button-task-next")).toBeDisabled();
      await expect(page!.getByTestId("text-task-total")).toContainText("1 total");
    } finally {
      page!.off("response", observe);
    }
  });
  await check("real_reminder_optout_without_offsets_survives_reload", async () => {
    await page!.goto("/workspace/reminders");
    await expect(page!.getByRole("note")).toContainText("Development-only delivery");
    await page!.getByTestId("switch-enabled").focus();
    await page!.keyboard.press("Space");
    await expect(page!.getByTestId("switch-enabled")).toBeChecked();
    await page!.getByTestId("checkbox-offset-1").focus();
    await page!.keyboard.press("Space");
    await expect(page!.getByTestId("checkbox-offset-1")).not.toBeChecked();
    await page!.getByTestId("switch-enabled").focus();
    await page!.keyboard.press("Space");
    await expect(page!.getByTestId("switch-enabled")).not.toBeChecked();
    const preferenceSave = page!.waitForResponse(
      (response) =>
        response.url().endsWith("/api/workspace/reminder-preferences") &&
        !["GET", "OPTIONS"].includes(response.request().method()),
    );
    await page!.getByTestId("button-save-prefs").click();
    expect((await preferenceSave).status()).toBe(200);
    const preferences = (await api("/api/workspace/reminder-preferences")).body as {
      enabled: boolean;
      offsets: number[];
    };
    expect(preferences.enabled).toBe(false);
    expect(preferences.offsets).toEqual([]);
    await page!.reload();
    await expect(page!.getByTestId("switch-enabled")).not.toBeChecked();
    await expect(page!.getByTestId("checkbox-offset-1")).not.toBeChecked();
  });
  await check("real_private_purchase_history_empty_state_mobile_and_api_controls", async () => {
    expect(workspaceId).toBeTruthy();
    await page!.goto("/workspace/purchases");
    await expect(page!.getByRole("heading", { name: "Purchases and licences" })).toBeVisible();
    await expect(page!.getByText("No orders saved", { exact: true })).toBeVisible();
    await expect(page!.getByText(/no released documents with approved prices/i)).toBeVisible();
    const held = await pool.query("select id from valo_content_versions where status='held' limit 1");
    expect(held.rowCount).toBe(1);
    const price = randomUUID(),
      order = randomUUID(),
      reference = `valo-test-${order}`;
    ownCommercePriceIds.push(price);
    const line = {
      title: "Controlled browser test order — not a payment",
      contentVersionId: held.rows[0].id,
      licenceVersion: "controlled-not-approved",
      licenceText: "Controlled browser licence snapshot only; no sales approval.",
      taxTreatment: "Test value only, no tax assertion.",
    };
    await pool.query(
      `insert into valo_prices(id,content_version_id,title,amount_kobo,licence_version,licence_text,tax_treatment,approval_reference,effective_from)
      values($1,$2,$3,12345,$4,$5,$6,'CONTROLLED_BROWSER_FIXTURE_NOT_APPROVAL',now())`,
      [price, held.rows[0].id, line.title, line.licenceVersion, line.licenceText, line.taxTreatment],
    );
    await pool.query(
      `insert into valo_orders(id,workspace_id,requested_by,reference,request_key,price_id,line,amount_kobo)
      values($1,$2,$3,$4,$5,$6,$7,12345)`,
      [order, workspaceId, userId, reference, randomUUID(), price, JSON.stringify(line)],
    );
    // A clearly labelled controlled ledger record is real persisted UI data, NOT provider settlement/publication.
    await page!.reload();
    await expect(page!.getByRole("heading", { name: line.title })).toBeVisible();
    await expect(page!.getByText("Order saved — not paid", { exact: true })).toBeVisible();
    await page!.getByText(/Licence at purchase/).click();
    await expect(page!.getByText(line.licenceText, { exact: true })).toBeVisible();
    await expect(page!.getByRole("button", { name: "Download test purchase receipt" })).toHaveCount(0);
    await expect(page!.getByRole("button", { name: "Request refund review" })).toHaveCount(0);
    for (const width of [360, 390, 768, 1280]) {
      await page!.setViewportSize({ width, height: 900 });
      await reflow();
      const refresh = page!.getByRole("button", { name: "Check payment status", exact: true });
      await page!.keyboard.press("Tab");
      await refresh.focus();
      await expect(refresh).toBeFocused();
      await expect(refresh).toHaveCSS("outline-style", "solid");
      await expect(refresh).toHaveCSS("outline-width", "2px");
    }
    await page!.getByRole("button", { name: "Check payment status", exact: true }).click();
    const card = page!.locator("article").filter({ has: page!.getByRole("heading", { name: line.title }) });
    await expect(card.getByRole("alert")).toContainText(/configured Paystack test merchant/);
    await page!.getByRole("button", { name: "Continue hosted test checkout", exact: true }).click();
    await expect(card.getByRole("alert")).toContainText(/unavailable for new checkout/);
    await page!.reload();
    await expect(page!.getByText("Order saved — not paid", { exact: true })).toBeVisible();
    const history = await api("/api/workspace/purchases");
    expect(history.status).toBe(200);
    expect(history.cache).toContain("no-store");
    const recorded = GetCustomerPurchasesResponse.parse(history.body);
    expect(recorded.orders[0].reference).toBe(reference);
    expect(recorded.livePaymentsEnabled).toBe(false);
    const receipt = await api(`/api/workspace/orders/${order}/receipt`);
    expect(receipt.status).toBe(409);
    const data = await api("/api/workspace/data-export");
    expect(data.status).toBe(200);
    const exported = DownloadWorkspaceDataResponse.parse(data.body);
    expect(
      z
        .object({ orders: z.array(z.object({ id: z.string() })) })
        .parse(exported.data)
        .orders.some((o) => o.id === order),
    ).toBe(true);
    await ensureReminderDirectory("../../generated-artifacts/valo-commerce", { recursive: true });
    await page!.screenshot({
      path: "../../generated-artifacts/valo-commerce/purchase-history.png",
      fullPage: true,
    });
  });
  await check("real_privacy_verification_cancellation_history_and_staff_denial", async () => {
    // The request is created through the actual customer API when absent.
    // Nothing in this group intercepts a customer or staff response.
    const before = await api("/api/workspace/privacy-cases");
    expect(before.status).toBe(200);
    let row = ListPrivacyCasesResponse.parse(before.body)[0];
    if (!row) {
      const created = await api("/api/workspace/privacy-requests", "POST", {
        kind: "deletion",
        message: "Synthetic owner request for verification and cancellation only.",
        acknowledgement: true,
        idempotencyKey: randomUUID(),
      });
      expect(created.status).toBe(201);
      row = ListPrivacyCasesResponse.parse((await api("/api/workspace/privacy-cases")).body)[0];
    }
    if (!row) throw Error("Persisted privacy request was not returned.");
    await page!.goto("/workspace/privacy");
    const card = page!.getByTestId("privacy-case").filter({ hasText: row.reference });
    await card.getByRole("button", { name: "View request", exact: true }).click();
    await expect(card).toContainText("awaiting verification");
    await card.locator('input[type="checkbox"]').check();
    await card.getByRole("button", { name: "Verify my request", exact: true }).click();
    await expect(card.locator("strong").first()).toHaveText("verified");
    const verified = await api(`/api/workspace/privacy-cases/${row.id}`);
    expect(verified.status).toBe(200);
    const verifiedValue = GetPrivacyCaseResponse.parse(verified.body);
    expect(verifiedValue.request.version).toBe(2);
    expect(verifiedValue.events.map((e) => e.action)).toEqual(["request_received", "identity_verified"]);
    expect((await api(`/api/workspace/privacy-cases/${row.id}/result`)).status).toBe(404);
    expect((await api("/api/admin/privacy-cases?page=1")).status).toBe(403);
    await page!.setViewportSize({ width: 360, height: 900 });
    await reflow();
    await card.getByRole("button", { name: "Cancel before processing", exact: true }).focus();
    await expect(card.getByRole("button", { name: "Cancel before processing", exact: true })).toBeFocused();
    await page!.screenshot({
      path: "generated-artifacts/valo-customer-ux/privacy-processing-mobile.png",
      fullPage: true,
    });
    await card.getByRole("button", { name: "Cancel before processing", exact: true }).click();
    await expect(card.locator("strong").first()).toHaveText("cancelled");
    await page!.reload();
    await reflow();
    await expect(page!.getByTestId("privacy-case").filter({ hasText: row.reference })).toContainText(
      "cancelled",
    );
    const cancelled = await api(`/api/workspace/privacy-cases/${row.id}`);
    const cancelledValue = GetPrivacyCaseResponse.parse(cancelled.body);
    expect(cancelledValue.events.length).toBe(3);
    expect(cancelledValue.request.resultAvailable).toBe(false);
  });
  await check("real_private_privacy_request_reload_and_JSON_download", async () => {
    expect(userId).toBeTruthy();
    await page!.goto("/workspace/privacy");
    await expect(page!.getByTestId("workspace-export-scope")).toContainText(
      "not complete privacy fulfilment",
    );
    await expect(page!.getByTestId("workspace-export-scope")).toContainText("file/job metadata");
    const created = await api("/api/workspace/documents", "POST", syntheticDocument);
    expect(created.status).toBe(201);
    const createdDocument = GetDocumentResponse.parse(created.body);
    await page!.getByTestId("radio-privacy-deletion").check();
    await page!
      .getByTestId("input-privacy-message")
      .fill("Synthetic request only. Verify all systems before any deletion.");
    await page!.getByTestId("checkbox-privacy-ack").check();
    await page!.getByTestId("button-privacy-submit").click();
    await expect(page!.getByTestId("privacy-ack")).toBeVisible();
    await page!.reload();
    const privacyRequests = GetCustomerAccountResponse.parse(
      (await api("/api/workspace/account")).body,
    ).privacyRequests;
    expect(privacyRequests.length).toBe(2);
    expect(privacyRequests[0].status).toBe("awaiting_staff");
    const download = page!.waitForEvent("download");
    await page!.getByTestId("button-download-workspace").click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/valo-workspace.*json/);
    const raw = await api("/api/workspace/data-export");
    expect(raw.status).toBe(200);
    expect(raw.cache).toContain("no-store");
    const exported = DownloadWorkspaceDataResponse.parse(raw.body);
    expect(exported.workspaceId).toBe(workspaceId);
    expect(exported.scope).toContain("not complete privacy fulfilment");
    expect(exported.scope).toContain("membership/audit records");
    expect(
      (exported.data.documentRevisions as { documentId: string }[]).some(
        (r) => r.documentId === createdDocument.id,
      ),
    ).toBe(true);
    await page!.goto("/workspace/purchases");
    await expect(page!.getByTestId("text-purchases-message")).toContainText(/not proof of payment/);
    await page!.goto("/staff");
    expect((await api("/api/admin/operations?area=support")).status).toBe(403);
  });
  await check("real_manual_reminder_records_past_due_dates_and_mobile_keyboard_flow", async () => {
    await page!.goto("/workspace/ai");
    const reminderRadio = page!.getByTestId("radio-task-payment_reminder");
    await reminderRadio.focus();
    await reminderRadio.press("Space");
    await expect(reminderRadio).toBeChecked();
    for (const [key, value] of Object.entries({
      issuerName: "Fictional Business A",
      recipientName: "Fictional Customer B",
      documentNumber: "DEMO-REM-003",
      issueDate: "2026-11-13",
      dueDate: "2026-11-05",
    }))
      await page!.locator(`input[id$="${key}"]`).fill(value);
    await page!.getByTestId("input-ai-recorded-balance").check();
    await page!.getByTestId("input-ai-invoice-amount").fill("20000.00");
    for (const [i, reference, amount] of [
      [0, "DEMO-P3A", "5000.00"],
      [1, "DEMO-P3B", "2500.00"],
    ] as const) {
      await page!.getByTestId("button-ai-add-payment").click();
      await page!.getByTestId(`input-ai-payment-reference-${i}`).fill(reference);
      await page!.getByTestId(`input-ai-payment-amount-${i}`).fill(amount);
      await expect(page!.getByTestId(`input-ai-payment-reference-${i}`)).toHaveAccessibleName(
        `Payment reference ${i + 1}`,
      );
    }
    await expect(page!.getByTestId("text-ai-summary")).toContainText("₦12,500.00");
    await page!.getByTestId("input-ai-payment-reference-1").fill(" demo-p3a ");
    await expect(page!.getByRole("alert").filter({ hasText: "references must be distinct" })).toBeVisible();
    await page!.getByTestId("input-ai-payment-reference-1").fill("DEMO-P3B");
    await page!.getByTestId("input-ai-payment-amount-1").fill("20000.00");
    await expect(page!.getByRole("status").filter({ hasText: "no positive amount due" })).toBeVisible();
    await page!.getByTestId("input-ai-payment-amount-1").fill("2500.00");
    for (const width of [360, 390, 768, 1280]) {
      await page!.setViewportSize({ width, height: 874 });
      await reflow();
      await page!.getByTestId("input-ai-payment-reference-0").focus();
      await page!.keyboard.press("Tab");
      await expect(page!.getByTestId("input-ai-payment-amount-0")).toBeFocused();
      await expect(page!.getByTestId("input-ai-payment-amount-0")).toHaveCSS("outline-style", "solid");
      await expect(page!.getByTestId("input-ai-payment-amount-0")).toHaveCSS("outline-width", "2px");
    }
    await page!.setViewportSize({ width: 390, height: 874 });
    await reflow();
    await ensureReminderDirectory(
      fileURLToPath(new URL("../../../../generated-artifacts/valo-customer-ux/", import.meta.url)),
      { recursive: true },
    );
    await page!.getByTestId("input-ai-invoice-amount").scrollIntoViewIfNeeded();
    await page!.screenshot({
      path: fileURLToPath(
        new URL("../../../../generated-artifacts/valo-customer-ux/reminder-mobile.jpg", import.meta.url),
      ),
    });
    // No AI consent or provider call: the independent manual editor must remain useful.
    const request = page!.waitForResponse(
      (r) => r.url().endsWith("/api/workspace/documents") && r.request().method() === "POST",
    );
    await page!.getByTestId("button-manual-draft").click();
    const response = await request;
    expect(response.status()).toBe(201);
    const document = GetDocumentResponse.parse(await response.json());
    expect(document.content.financialInput?.amountDueKobo).toBe("1250000");
    expect(document.content.financialInput?.paymentRecord?.payments.map((p) => p.reference)).toEqual([
      "DEMO-P3A",
      "DEMO-P3B",
    ]);
    await page!.waitForURL(`**/workspace/documents/${document.id}`);
    await page!.reload();
    const reopened = GetDocumentResponse.parse((await api(`/api/workspace/documents/${document.id}`)).body);
    expect(reopened.content.fields.dueDate).toBe("2026-11-05");
    expect(reopened.content.financialInput).toEqual(document.content.financialInput);
  });
  await check("multiple_activity_labels_and_editor_keyboard_relationships_across_mobile_sizes", async () => {
    await page!.goto("/workspace/profile");
    await expect(page!.getByTestId("button-add-activity")).toBeVisible();
    while ((await page!.locator('input[id^="activity-"]').count()) < 3)
      await page!.getByTestId("button-add-activity").click();
    for (let i = 0; i < 3; i++)
      await expect(page!.getByTestId(`input-activity-${i}`)).toHaveAccessibleName(
        new RegExp(`Business activity ${i + 1}`),
      );
    for (const width of [320, 390, 768]) {
      await page!.setViewportSize({ width, height: 850 });
      await reflow();
    }
    await page!.setViewportSize({ width: 1280, height: 900 });
    const input = structuredClone(syntheticDocument);
    input.title = "Synthetic accessible mobile editor";
    input.content.fields.issuerName = "Very long synthetic organisation ".repeat(4);
    input.content.blocks.push({
      id: "mobile-table",
      type: "table",
      text: "",
      rows: Array.from({ length: 12 }, (_, i) => [
        `Row ${i + 1}`,
        "LongUnbrokenSyntheticBusinessReference".repeat(5),
        "₦12,345.67",
      ]),
    });
    const created = await api("/api/workspace/documents", "POST", input);
    expect(created.status).toBe(201);
    const doc = GetDocumentResponse.parse(created.body);
    await page!.goto(`/workspace/documents/${doc.id}`);
    const title = page!.getByTestId("input-title");
    for (const width of [320, 360, 390, 768]) {
      await page!.setViewportSize({ width, height: 850 });
      await reflow();
      await title.focus();
      await page!.keyboard.press("Tab");
      await page!.keyboard.press("Shift+Tab");
      await expect(title).toBeFocused();
      expect(
        await title.evaluate((e) => {
          const s = e.ownerDocument.defaultView!.getComputedStyle(e);
          return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2;
        }),
      ).toBe(true);
      const edit = page!.getByRole("tab", { name: "Edit", exact: true }),
        preview = page!.getByRole("tab", { name: "Saved preview" });
      await edit.focus();
      await page!.keyboard.press("ArrowRight");
      await expect(preview).toBeFocused();
      await expect(preview).toHaveAttribute("aria-selected", "true");
      await reflow();
      await expect(page!.locator("#editor-preview-panel")).toBeVisible();
      await expect(page!.locator("#editor-edit-panel")).toBeHidden();
      if (width < 768) {
        const table = page!.getByTestId("preview-doc").getByRole("region").last();
        await table.focus();
        await page!.keyboard.press("ArrowRight");
        await expect.poll(() => table.evaluate((e) => e.scrollLeft)).toBeGreaterThan(0);
        await reflow();
        await preview.focus();
      }
      await page!.keyboard.press("Home");
      await expect(edit).toBeFocused();
      await reflow();
      await expect(edit).toHaveAttribute("aria-controls", "editor-edit-panel");
      await expect(page!.locator("#editor-edit-panel")).toHaveAttribute("aria-labelledby", "editor-tab-edit");
      await page!.keyboard.press("End");
      await expect(preview).toBeFocused();
      await page!.keyboard.press("ArrowLeft");
      await expect(edit).toBeFocused();
    }
    await page!.setViewportSize({ width: 1280, height: 900 });
  });
  await check("private_account_and_notification_mobile_reflow", async () => {
    expect(userId).toBeTruthy();
    await page!.setViewportSize({ width: 360, height: 800 });
    for (const path of [
      "/workspace/privacy",
      "/workspace/notifications",
      "/workspace/purchases",
      "/workspace/account",
    ]) {
      await page!.goto(path);
      await expect(page!.locator("main h1").first()).toBeVisible();
      await reflow();
      await page!.keyboard.press("Tab");
      await expect(page!.locator(":focus")).toBeVisible();
    }
  });
  await check("actual_suspended_account_still_has_public_non_enumerating_support", async () => {
    expect(userId).toBeTruthy();
    await clerkClient.users.banUser(userId!);
    await page!.goto("/account-access");
    await page!.getByTestId("input-access-email").fill(email);
    await page!
      .getByTestId("input-access-message")
      .fill(
        "Synthetic suspended account cannot sign in. Please review access without sharing account details.",
      );
    const response = page!.waitForResponse(
      (r) => r.url().endsWith("/api/public/access-support") && r.request().method() === "POST",
    );
    await page!.getByTestId("button-access-submit").click();
    const r = await response;
    expect(r.status()).toBe(201);
    const ack = await r.json();
    ownIntakeIds.push(ack.reference.replace("VALO-ACCESS-", ""));
    expect(ack.message).toBe(unknownAck);
    expect(ack.delivery).toBe("not_dispatched");
    expect((await api("/api/workspace/account")).status).toBeGreaterThanOrEqual(401);
  });
} catch {
  checks.push({
    name: phase,
    status: "fail",
    diagnostic: "Journey setup failed; sensitive details suppressed.",
  });
  process.exitCode = 1;
} finally {
  let cleanupErrors = 0;
  if (userId)
    await clerkClient.users.deleteUser(userId).catch(() => {
      process.exitCode = 1;
      cleanupErrors++;
    });
  await browser?.close();
  for (const id of ownIntakeIds)
    await pool.query("DELETE FROM valo_access_support WHERE id=$1", [id]).catch(() => {
      cleanupErrors++;
      process.exitCode = 1;
    });
  if (workspaceId) {
    const assets = await pool.query("SELECT object_key FROM valo_file_assets WHERE workspace_id=$1", [
      workspaceId,
    ]);
    for (const row of assets.rows) {
      try {
        if (!row.object_key.startsWith(`valo/development/${workspaceId}/`))
          throw Error("OWN_PRIVATE_OBJECT_REQUIRED");
        await deletePrivateFile(row.object_key);
      } catch {
        cleanupErrors++;
        process.exitCode = 1;
      }
    }
    for (const table of [
      "valo_privacy_events",
      "valo_privacy_tombstones",
      "valo_privacy_cases",
      "valo_payment_reconciliations",
      "valo_refund_requests",
      "valo_purchase_outbox",
      "valo_entitlements",
      "valo_orders",
      "valo_support_tickets",
      "valo_reminder_outbox",
      "valo_reminder_preferences",
      "valo_tasks",
      "valo_assessments",
      "valo_export_requests",
      "valo_export_objects",
      "valo_file_assets",
      "valo_export_jobs",
      "valo_ai_drafts",
      "valo_document_revisions",
      "valo_documents",
      "valo_profile_versions",
      "valo_events",
      "valo_memberships",
      "valo_workspaces",
    ]) {
      await pool
        .query(`DELETE FROM ${table} WHERE ${table === "valo_workspaces" ? "id" : "workspace_id"}=$1`, [
          workspaceId,
        ])
        .catch(() => {
          cleanupErrors++;
          process.exitCode = 1;
        });
    }
  }
  for (const id of ownCommercePriceIds)
    await pool.query("DELETE FROM valo_prices WHERE id=$1", [id]).catch(() => {
      cleanupErrors++;
      process.exitCode = 1;
    });
  await pool.end();
  await writeFile(
    fileURLToPath(
      new URL(
        process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "guided"
          ? "../../../../generated-artifacts/valo-customer-ux/browser-guided.json"
          : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "support-details"
            ? "../../../../generated-artifacts/valo-customer-ux/browser-support-details.json"
            : "../../../../generated-artifacts/valo-customer-ux/browser.json",
        import.meta.url,
      ),
    ),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        syntheticDevelopmentOnly: true,
        checks,
        guidedDetails,
        selection:
          process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "guided"
            ? "managed-identity-twelve-private-guided-drafts"
            : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "support-details"
              ? "managed-identity-support-details-and-privacy-scope"
              : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "editor-safety"
                ? "managed-identity-editor-safety"
                : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "commerce"
                  ? "managed-identity-commerce-only"
                  : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "reminder"
                    ? "managed-identity-reminder-only"
                    : "full-existing-journey",
        actualManagedIdentityUsed: Boolean(userId),
        realEmailDeliveryClaimed: false,
        actualNewPublications: 0,
        fixtureDisclosure:
          process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "guided"
            ? "Actual managed synthetic customer verification, twelve private answer-form layouts, actual typed UI answers, saved/reloaded revisions and private durable export requests. No application response interception, published catalogue master, professional review, real email or commerce execution. Word/PDF checks use mechanical readers, not an actual Microsoft Word/manual assistive-technology session."
            : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "support-details"
              ? "Actual managed synthetic customer verification, private routes, saved privacy ticket and workspace JSON download. The real staff API denied this customer. ONLY the staff display payload was intercepted with synthetic mixed request records for full-message, XSS, keyboard and mobile checks. No actual authorised staff/MFA session, privacy fulfilment, provider-wide export or erasure was proven. No messages sent."
              : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "editor-safety"
                ? "Actual managed synthetic verified identity, application API and PostgreSQL. Two real browser tabs; one PATCH delayed then released unchanged to order a revision conflict. No forged API responses, provider sends, AI calls or payment calls."
                : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "commerce"
                  ? "An unpaid controlled order/licence fixture was saved in the actual database and displayed through authenticated APIs; it was not a released product, price approval or real payment. All owned fixture records were removed."
                  : process.env.VALO_CUSTOMER_JOURNEY_SELECTION === "reminder"
                    ? "No intercepted content fixture groups were executed in this managed-identity/reminder subset."
                    : "Resource, template and staff-display fixtures were intercepted only in this browser, never inserted/published. No content eligibility, real published-master download or authorised staff/MFA session was proven by those fixture groups.",
        r1Accepted: false,
        r2Accepted: false,
        cleanupErrors,
        cleanup: cleanupErrors
          ? "Synthetic cleanup needs attention"
          : "Owned synthetic identity and application rows removed; provider usage history untouched.",
      },
      null,
      2,
    ) + "\n",
  );
}
