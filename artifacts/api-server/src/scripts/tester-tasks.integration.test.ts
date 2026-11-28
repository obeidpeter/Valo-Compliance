import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, type Page } from "@playwright/test";
import { ready, startApp } from "../test-support/app-in-browser";
import { startRealApi } from "../test-support/real-api-in-browser";

/**
 * The tasks a business owner is given in a usability session, done in a browser against the real
 * API and a real database: run the requirements check, make an invoice from its questions, get it
 * as a file, correct it and get the file again, save a task with a due date, and find where to
 * report a problem.
 *
 * Every other browser test answers the page's requests from fixtures, and every other API test
 * calls the API without drawing a screen. Here the web app's own code talks to the server's own
 * code, so a request the page sends that the server refuses, or an answer the page cannot draw,
 * fails this test before it stops a person.
 *
 * What is stood in for, and nothing else: the identity provider (its script cannot load in a test,
 * so the page is bundled with a signed-in or signed-out stand-in and the server is told which
 * synthetic account asks), and the queue's worker (the test makes each requested file by calling
 * the function the worker calls). No provider is called and every record is synthetic.
 *
 * Not here: the pages the server renders (decision 0011), which this bundle of the browser app does
 * not hold. The first page a visitor reads and the Help page are read by
 * public-server-pages.test.ts and primary-journeys-browser.test.ts.
 */
const enabled =
  process.env.VALO_RUN_DB_TESTS === "synthetic-development-only" &&
  process.env.VALO_RUN_EXPORT_TESTS === "synthetic-development-only";

test(
  "a business owner's first tasks work in a browser against the real API and database",
  { skip: !enabled, timeout: 300_000 },
  async (t) => {
    const owner = `synthetic-tester-${randomUUID()}`;
    const { api, answered, made, through, refused, closePage, close: stop } = await startRealApi(t, [owner]);
    const previousOrigin = process.env.VALO_TRUSTED_ORIGIN;

    const signedOut = await startApp("signed-out");
    const signedIn = await startApp("signed-in");
    // The two files are kept where VALO_TESTER_TASKS_FILES says, for a person to look at what a
    // customer would send; CI keeps them with the run. Otherwise they go with the test.
    const kept = process.env.VALO_TESTER_TASKS_FILES || undefined;
    const folder = kept ?? (await mkdtemp(join(tmpdir(), "valo-tester-tasks-")));
    if (kept) await mkdir(kept, { recursive: true });
    /** A downloaded PDF's text, laid out as on the page. */
    const pdfText = async (page: Page, open: () => Promise<void>, name: string) => {
      const [download] = await Promise.all([page.waitForEvent("download"), open()]);
      const path = join(folder, name);
      await download.saveAs(path);
      return (await promisify(execFile)("pdftotext", ["-layout", path, "-"])).stdout;
    };
    try {
      // Task 2: "Find out which requirements may apply to the business on your card."
      {
        const { page, errors, unknown, close } = await signedOut.phone("/checker", through(null));
        try {
          await ready(page);
          const choose = (name: string, value: string) =>
            page.locator(`label:has([data-testid="radio-${name}-${value}"])`).click();
          await choose("legalForm", "sole_proprietor");
          await choose("registrationStatus", "registered");
          await page.getByTestId("button-next").click();
          await page.getByTestId("button-next").click();
          await page.getByTestId("select-state").selectOption("Lagos");
          await page.getByTestId("input-lga").fill("Ikeja");
          await page.getByTestId("button-next").click();
          await page.getByTestId("input-employees").fill("3");
          await page.getByTestId("button-next").click();
          await choose("personalData", "yes");
          await page.getByTestId("button-next").click();
          await page.getByTestId("button-run").click();
          const result = page.getByTestId("assessment-result");
          await result.waitFor();
          // Nothing is published, and the result says so without calling that an exemption.
          await expect(page.getByTestId("status-coverage-unavailable")).toContainText(
            "No published rule covers these answers yet.",
          );
          await expect(result).toContainText("It is not a legal certificate.");
          await expect(result).toContainText("Check what applies in Lagos with the authorities there.");
          assert.deepEqual(errors, []);
          assert.deepEqual(unknown, []);
          assert.deepEqual(refused(), []);
        } finally {
          await closePage(close);
        }
      }

      // The page's own address is the one the server trusts for a change, as the site's is.
      process.env.VALO_TRUSTED_ORIGIN = signedIn.origin;
      const { page, errors, unknown, close } = await signedIn.desktop("/workspace", through(owner));
      try {
        await ready(page);
        // Task 3: "Example Schools owes you for the uniforms on your card. Make the invoice."
        // A new workspace is empty, and its home offers one way to start.
        await expect(page.locator("main")).toContainText("No documents yet");
        await page.getByTestId("link-first-document").click();
        await page.getByTestId("button-start-TPL-01").click();
        await page.waitForURL(/\/workspace\/documents\/[0-9a-f-]{36}$/);
        await page.getByTestId("guided-fields").waitFor();
        const today = new Date();
        const day = (after: number) => new Date(+today + after * 86_400_000).toISOString().slice(0, 10);
        for (const [id, value] of [
          ["issuerName", "Example Tailoring"],
          ["issuerAddress", "12 Example Street, Ikeja, Lagos"],
          ["recipientName", "Example Schools"],
          ["documentNumber", "INV-0001"],
          ["issueDate", day(0)],
          ["dueDate", day(14)],
          ["billingBasis", "Ten school uniforms, made to order."],
        ] as const)
          await page.locator(`#g-${id}`).fill(value);
        await page.locator("#g-taxMode").selectOption("none");
        await page.locator("#g-discountMode").selectOption("none");
        await page.locator("#gt-items-0-description").fill("School uniform");
        await page.locator("#gt-items-0-quantity").fill("10");
        await page.locator("#gt-items-0-unit").selectOption("each");
        const price = page.locator("#gt-items-0-unitPriceKobo");
        await price.fill("7500");
        // Everything the invoice needs is answered, and it is saved.
        await expect(page.getByTestId("card-missing")).toContainText(
          "Nothing is missing from the details Valo checks.",
          { timeout: 30_000 },
        );
        const saved = page.getByTestId("status-save");
        await expect(saved).toHaveText(/^Saved · version \d+$/, { timeout: 30_000 });
        const version = async () => Number((await saved.innerText()).replace(/\D/g, ""));
        const first = await version();

        // Task 4: "Get the invoice as a file you could send."
        const files = page.getByTestId("private-exports");
        await files.getByLabel(/^I want a draft copy/).check();
        await expect(files).toContainText(`Saved version ${first}`);
        await files.getByRole("button", { name: "Make a PDF file" }).click();
        const file = (of: number) => files.locator("li", { hasText: `PDF · version ${of} · ready` });
        await expect(file(first)).toBeVisible({ timeout: 90_000 });
        const invoice = await pdfText(
          page,
          () => file(first).getByRole("link", { name: "Download the PDF file" }).click(),
          "invoice-1.pdf",
        );
        for (const expected of [
          "INCOMPLETE DRAFT",
          `Saved version ${first}`,
          "Example Tailoring",
          "Example Schools",
          "School uniform",
          "₦7,500.00",
          "₦75,000.00",
        ])
          assert.ok(invoice.includes(expected), `the file holds "${expected}":\n${invoice}`);

        // "The price was wrong. It should be ₦8,000 each. Fix it and get the file again."
        await price.fill("8000");
        await expect(saved).not.toHaveText(`Saved · version ${first}`, { timeout: 30_000 });
        await expect(saved).toHaveText(/^Saved · version \d+$/, { timeout: 30_000 });
        const second = await version();
        assert.ok(second > first, "the correction is a newer version");
        await expect(files).toContainText(`Saved version ${second}`);
        await files.getByRole("button", { name: "Make a PDF file" }).click();
        await expect(file(second)).toBeVisible({ timeout: 90_000 });
        const corrected = await pdfText(
          page,
          () => file(second).getByRole("link", { name: "Download the PDF file" }).click(),
          "invoice-2.pdf",
        );
        for (const expected of [`Saved version ${second}`, "₦8,000.00", "₦80,000.00"])
          assert.ok(corrected.includes(expected), `the corrected file holds "${expected}":\n${corrected}`);
        assert.ok(!corrected.includes("7,500.00"), "the corrected file does not hold the old price");
        // The first file is still listed, for the version it was made from.
        await expect(file(first)).toBeVisible();
        // Coming back to the document later: a full load of the page shows the answers as saved.
        await page.reload();
        await ready(page);
        await expect(page.locator("#g-recipientName")).toHaveValue("Example Schools");
        await expect(page.locator("#gt-items-0-unitPriceKobo")).toHaveValue("8000");
        await expect(page.getByTestId("card-missing")).toContainText(
          "Nothing is missing from the details Valo checks.",
        );

        // Task 5: "You must renew something for the business by the end of next month."
        await page.locator('header nav a[href="/workspace/tasks"]').click();
        await page.getByTestId("button-new-task").click();
        const title = "Renew the shop's permit";
        await page.getByTestId("input-new-title").fill(title);
        const nextMonthEnd = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 0));
        await page.getByTestId("input-new-due").fill(nextMonthEnd.toISOString().slice(0, 10));
        await page.getByTestId("checkbox-new-confirm").check();
        await page.getByTestId("button-new-submit").click();
        await expect(page.locator('[data-testid^="card-task-"]', { hasText: title })).toBeVisible();
        // The reminders screen says plainly that no email is being sent.
        await page.locator('a[href="/workspace/reminders"]').first().click();
        await expect(page.getByTestId("status-delivery")).toContainText(
          "Reminder emails are not being sent yet",
        );

        // Task 6: "Something on the site did not work, and you want to tell Valo."
        // The workspace's way there is its Help link. The Help page is one the server renders
        // (decision 0011), which this bundle of the browser app does not hold; its link to the
        // report form is read in public-server-pages.test.ts. The form is opened as that link opens
        // it, with a full load, and sent to the real API.
        await expect(page.getByTestId("link-workspace-help")).toHaveAttribute("href", "/help");
        await page.goto(`${signedIn.origin}/support`);
        await ready(page);
        await page.getByTestId("form-ticket").waitFor();
        await page.getByTestId("input-scope").fill("Synthetic report: a button did nothing the first time.");
        await page.getByTestId("button-submit-ticket").click();
        const receipt = page.getByTestId("ticket-receipt");
        await expect(receipt).toContainText("Enquiry received");
        await expect(page.getByTestId("text-ticket-reference")).toHaveText(/^VALO-[0-9a-f-]{36}$/);

        assert.deepEqual(
          (await Promise.all(made)).filter((failure) => failure !== null),
          [],
          "each file was made",
        );
        assert.equal(made.length, 2, "two files were asked for");
        // Each step was the page's own request, answered by the real API.
        const sent = (method: string, path: RegExp) =>
          answered.filter((each) => each.method === method && path.test(each.path)).length;
        assert.deepEqual(
          {
            check: sent("POST", /^\/checker\/preview$/),
            started: sent("POST", /^\/workspace\/documents$/),
            filesAsked: sent("POST", /^\/v1\/documents\/[^/]+\/exports$/),
            filesFetched: sent("GET", /^\/v1\/exports\/[^/]+\/file$/),
            task: sent("POST", /^\/workspace\/tasks$/),
            report: sent("POST", /^\/workspace\/support$/),
          },
          { check: 1, started: 1, filesAsked: 2, filesFetched: 2, task: 1, report: 1 },
        );
        // EDT-008: "browsers and shared caches do not retain private responses as public assets". Each
        // file came from the application itself, as an attachment that no browser or cache may keep.
        const downloads = answered.filter(
          (each) => each.method === "GET" && /^\/v1\/exports\/[^/]+\/file$/.test(each.path),
        );
        for (const file of downloads) {
          assert.equal(file.status, 200);
          assert.match(file.headers["content-disposition"] ?? "", /^attachment; filename="[^"]+"$/);
          assert.equal(file.headers["cache-control"], "private, no-store");
          const vary = (file.headers.vary ?? "").split(",").map((each) => each.trim().toLowerCase());
          assert.ok(vary.includes("cookie") && vary.includes("authorization"), file.headers.vary);
          assert.equal(file.headers["x-content-type-options"], "nosniff");
        }
        // Without the account's session the same address gives no file, and the refusal is not kept.
        const anonymous = await fetch(`${api}/api${downloads[0]!.path}`);
        assert.equal(anonymous.status, 401);
        assert.match(anonymous.headers.get("cache-control") ?? "", /\bno-store\b/);
        assert.equal(anonymous.headers.get("content-disposition"), null);
        // The answers and then the correction were saved by the page itself, as it saves on its own.
        assert.ok(sent("PATCH", /^\/workspace\/documents\/[^/]+$/) >= 2);
        assert.deepEqual(errors, []);
        assert.deepEqual(unknown, []);
        assert.deepEqual(refused(), []);
      } catch (error) {
        // A step that fails says where the page was, what it showed and what the server refused.
        const shown = await page
          .locator("body")
          .innerText()
          .catch(() => "(the page could not be read)");
        console.error(
          `At ${page.url()}\nThe server refused: ${JSON.stringify(refused())}\nPage errors: ${JSON.stringify(errors)}\nThe page showed:\n${shown.slice(0, 3000)}`,
        );
        throw error;
      } finally {
        await closePage(close);
      }
    } finally {
      await Promise.all(made);
      if (!kept) await rm(folder, { recursive: true, force: true });
      await signedIn.close();
      await signedOut.close();
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await stop();
    }
  },
);
