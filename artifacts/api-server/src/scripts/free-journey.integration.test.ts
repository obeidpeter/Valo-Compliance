import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { strFromU8, unzipSync } from "fflate";
import { expect, devices, type BrowserContextOptions, type Page } from "@playwright/test";
import { ready, startApp } from "../test-support/app-in-browser";
import { startRealApi } from "../test-support/real-api-in-browser";
import type { SyntheticAnswer } from "../test-support/synthetic-api";
import { startWebServer } from "../test-support/web-server";

/**
 * UAT-01, the free journey: "visitor finds a free template, saves a draft and exports it", whose
 * evidence is a "Recorded mobile/desktop journey; correct output and stored revision". The journey
 * is made on an emulated phone and on a desktop-sized screen, each part of it recorded as a video
 * kept with the run, against the real API and a real database:
 *
 * 1. A visitor who is not signed in opens the home page the compiled web server renders, finds the
 *    invoice among the everyday tasks it offers, and follows "Send an invoice" to the sign-up page.
 * 2. The sign-up page hands the identity provider the address where the new account starts: the
 *    page where a document starts, with the invoice first.
 * 3. Signed in there, the visitor starts the invoice, answers its questions, sees the draft saved,
 *    makes its finished PDF and Word files, downloads both, and finds them in the business library.
 *
 * Then the files are read: each holds the answers and the totals worked out from them. And the
 * database is read: the saved version is the stored revision whose hash is its content's, and each
 * file was made from that revision, and is the file stored for it.
 *
 * What is stood in for, and nothing else: the identity provider, whose sign-up form and session are
 * its own and cannot load in a test (the sign-up page is drawn with the app's stand-in for it, and
 * the server is told which synthetic account asks), and the queue's worker (each file is made by the
 * function the worker calls). No provider is called and every record is synthetic.
 *
 * The recordings and files are kept where VALO_FREE_JOURNEY_FILES says, for a person to watch the
 * journey and open what it made; CI keeps them with the run. Otherwise they go with the test.
 */
const enabled =
  process.env.VALO_RUN_DB_TESTS === "synthetic-development-only" &&
  process.env.VALO_RUN_EXPORT_TESTS === "synthetic-development-only";

/** The two screens the journey is made on, as the browser checks emulate them. */
const SCREENS = {
  // A recording is at most the screen's size: Playwright draws a smaller screen in a corner of a
  // larger frame rather than scale it up.
  phone: { device: devices["Moto G4"], video: { width: 360, height: 640 } },
  desktop: { device: { viewport: { width: 1440, height: 900 } }, video: { width: 1280, height: 800 } },
} as const;

/** A downloaded file's text: a PDF's as laid out on the page, a Word file's paragraph by paragraph. */
const fileText = async (path: string, format: "pdf" | "docx") =>
  format === "pdf"
    ? (await promisify(execFile)("pdftotext", ["-layout", path, "-"])).stdout
    : strFromU8(unzipSync(new Uint8Array(await readFile(path)))["word/document.xml"]!)
        .replace(/<\/w:p>/g, "\n")
        .replace(/<w:tab\/>/g, "\t")
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, "&");

/** The answers the visitor gives, and what each file must hold because of them. */
const day = (after: number) => new Date(Date.now() + after * 86_400_000).toISOString().slice(0, 10);
const ANSWERS = [
  ["issuerName", "Example Tailoring"],
  ["issuerAddress", "12 Example Street, Ikeja, Lagos"],
  ["recipientName", "Example Schools"],
  ["documentNumber", "INV-0001"],
  ["issueDate", day(0)],
  ["dueDate", day(14)],
  ["billingBasis", "Ten school uniforms, made to order."],
] as const;
const IN_EVERY_FILE = [
  "Example Tailoring",
  "Example Schools",
  "INV-0001",
  "School uniform",
  "₦7,500.00",
  "₦75,000.00",
];

test(
  "the free journey, recorded on a phone and on a desktop: a visitor finds the invoice, signs up, saves it and downloads its files, made from its stored revision",
  { skip: !enabled, timeout: 600_000 },
  async (t) => {
    const accounts = {
      phone: `synthetic-free-journey-phone-${randomUUID()}`,
      desktop: `synthetic-free-journey-desktop-${randomUUID()}`,
    };
    const real = await startRealApi(t, Object.values(accounts));
    const { resolveWorkspace } = await import("../modules/workspaces");
    const { getDocument, serializeRevision } = await import("../modules/documents");
    const { getExport } = await import("../modules/exports");
    const { sha256 } = await import("@workspace/valo-core");
    const kept = process.env.VALO_FREE_JOURNEY_FILES || undefined;
    const folder = kept ?? (await mkdtemp(join(tmpdir(), "valo-free-journey-")));
    if (kept) await mkdir(kept, { recursive: true });

    // The compiled web server reads the API as the site does, from the server and from the browser;
    // both reach the real API, signed out. Only reads: a visitor who is not signed in sends nothing.
    const forwarded: string[] = [];
    const forward = async (method: string, url: URL): Promise<SyntheticAnswer | undefined> => {
      if (method !== "GET") return undefined;
      const reply = await fetch(`${real.api}${url.pathname}${url.search}`);
      forwarded.push(`${reply.status} ${method} ${url.pathname}`);
      const text = await reply.text();
      return { status: reply.status, body: text ? JSON.parse(text) : null };
    };
    const site = await startWebServer((method, url) => forward(method, url));
    const signedOut = await startApp("signed-out");
    const signedIn = await startApp("signed-in");
    const previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    /** What each screen's journey made, for journey.json beside the recordings. */
    const record: Record<string, unknown> = {};
    try {
      for (const [screen, { device, video }] of Object.entries(SCREENS) as [
        keyof typeof SCREENS,
        (typeof SCREENS)[keyof typeof SCREENS],
      ][]) {
        const account = accounts[screen];
        const recordings: string[] = [];
        const recordVideo = { dir: join(folder, ".recording"), size: video };
        const options: BrowserContextOptions = { ...device, recordVideo };
        /** Keeps a part of the journey's recording under its own name, once its page is closed. */
        const keep = async (page: Page, close: () => Promise<void>, name: string) => {
          const recording = page.video();
          await real.closePage(close);
          assert.ok(recording, "the part was recorded");
          const file = `${screen}-${recordings.length + 1}-${name}.webm`;
          await recording.saveAs(join(folder, file));
          await recording.delete();
          recordings.push(file);
        };
        /** A moment for whoever watches the recording to see the screen; nothing is waited for. */
        const beat = (page: Page) => page.waitForTimeout(800);

        // 1. "Visitor finds a free template": the home page, as the compiled server renders it to
        // someone who is not signed in, offers the invoice among its everyday tasks.
        {
          const { page, errors, unknown, close } = await site.open("/", options);
          try {
            await expect(page.getByTestId("text-headline")).toBeVisible();
            await beat(page);
            const invoice = page.getByTestId("link-task-invoice");
            await invoice.scrollIntoViewIfNeeded();
            await expect(invoice).toContainText("Send an invoice");
            await beat(page);
            await invoice.click();
            await expect(page).toHaveURL(`${site.origin}/sign-up?start=invoice`);
            await expect(page).toHaveTitle("Create account — Valo");
            await beat(page);
            assert.deepEqual(errors, [], "the public pages reported no error");
            assert.deepEqual(unknown, [], "every request the public pages made was answered");
          } finally {
            await keep(page, close, "finds-the-invoice");
          }
        }

        // 2. The sign-up page hands the identity provider where the new account starts, and the
        // sign-in form, for someone who has an account, keeps the choice too.
        {
          const { page, errors, unknown, close } = await signedOut.open(
            "/sign-up?start=invoice",
            real.through(null),
            options,
          );
          try {
            const card = page.getByTestId("identity-card");
            await expect(card.getByRole("heading", { name: "Create your account" })).toBeVisible();
            await expect(card).toHaveAttribute("data-after", "/workspace/documents/new?start=invoice");
            await expect(card).toHaveAttribute("data-other-form", "/sign-in?start=invoice");
            await beat(page);
            assert.deepEqual(errors, []);
            assert.deepEqual(unknown, []);
          } finally {
            await keep(page, close, "signs-up");
          }
        }

        // 3. "Saves a draft and exports it": signed in, where sign-up sent the new account.
        process.env.VALO_TRUSTED_ORIGIN = signedIn.origin;
        const { page, errors, unknown, close } = await signedIn.open(
          "/workspace/documents/new?start=invoice",
          real.through(account),
          options,
        );
        let documentId: string, version: number;
        /** What the business library says of each file, read against the stored document below. */
        const libraryLines: string[] = [];
        const files: { format: "pdf" | "docx"; id: string; path: string }[] = [];
        try {
          await ready(page);
          const chosen = page.getByTestId("chosen-task");
          await expect(chosen).toContainText("Send an invoice");
          await beat(page);
          await chosen.getByTestId("button-start-chosen-TPL-01").click();
          await page.waitForURL(/\/workspace\/documents\/[0-9a-f-]{36}$/);
          documentId = new URL(page.url()).pathname.split("/").pop()!;
          await page.getByTestId("guided-fields").waitFor();
          for (const [id, value] of ANSWERS) await page.locator(`#g-${id}`).fill(value);
          await page.locator("#g-taxMode").selectOption("none");
          await page.locator("#g-discountMode").selectOption("none");
          await page.locator("#gt-items-0-description").fill("School uniform");
          await page.locator("#gt-items-0-quantity").fill("10");
          await page.locator("#gt-items-0-unit").selectOption("each");
          await page.locator("#gt-items-0-unitPriceKobo").fill("7500");
          await expect(page.getByTestId("card-missing")).toContainText(
            "Nothing is missing from the details Valo checks.",
            { timeout: 30_000 },
          );
          const saved = page.getByTestId("status-save");
          await expect(saved).toHaveText(/^Saved · version \d+$/, { timeout: 30_000 });
          version = Number((await saved.innerText()).replace(/\D/g, ""));
          await beat(page);

          // The finished files, without the draft notice, since nothing is missing.
          const exports = page.getByTestId("private-exports");
          await exports.scrollIntoViewIfNeeded();
          await expect(exports.getByTestId("finished-file")).toContainText(
            `saved version ${version} can be made as a finished file`,
          );
          for (const format of ["pdf", "docx"] as const) {
            const name = format === "pdf" ? "PDF" : "Word";
            await exports.getByTestId(`button-finished-${format}`).click();
            const row = exports.locator("li", { hasText: `Finished ${name} · version ${version} · ready` });
            await expect(row).toBeVisible({ timeout: 90_000 });
            const link = row.getByRole("link", { name: `Download the ${name} file` });
            const id = /\/v1\/exports\/([0-9a-f-]{36})\/file$/.exec(
              (await link.getAttribute("href")) ?? "",
            )?.[1];
            assert.ok(id, `the ${name} file's link names its export`);
            const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
            const path = join(folder, `${screen}-invoice.${format}`);
            await download.saveAs(path);
            files.push({ format, id, path });
            await beat(page);
          }

          // The business library lists both files, with the saved version and what they were made
          // from (DOC-005). It is the workspace's Documents section: in the header on a desktop, in
          // the bar at the foot of the screen on a phone.
          await page
            .getByTestId(screen === "phone" ? "link-bar-documents" : "link-section-documents")
            .click();
          const library = page.getByTestId("library-exports");
          await expect(library).toContainText("2 ready");
          for (const { format, id } of files) {
            const row = library.getByTestId(`library-export-${id}`);
            await expect(row).toContainText(
              `Finished ${format === "pdf" ? "PDF" : "Word"} · version ${version}`,
            );
            await expect(row).not.toContainText("Not made from a template");
            libraryLines.push(await row.innerText());
          }
          // The recording ends on the files, where the phone's screen shows them below the documents.
          await library.getByTestId(`library-export-${files[0]!.id}`).scrollIntoViewIfNeeded();
          await beat(page);
          await beat(page);
          assert.deepEqual(errors, []);
          assert.deepEqual(unknown, []);
          assert.deepEqual(real.refused(), [], "the server refused no request the journey made");
        } catch (error) {
          // A step that fails says where the page was, what it showed and what the server refused.
          const shown = await page
            .locator("body")
            .innerText()
            .catch(() => "(the page could not be read)");
          console.error(
            `On the ${screen}, at ${page.url()}\nThe server refused: ${JSON.stringify(real.refused())}\nPage errors: ${JSON.stringify(errors)}\nThe page showed:\n${shown.slice(0, 3000)}`,
          );
          throw error;
        } finally {
          await keep(page, close, "saves-and-downloads");
        }

        // "Correct output": each file holds the answers and the totals worked out from them, and
        // the finished files carry no draft notice.
        for (const { format, path } of files) {
          const text = await fileText(path, format);
          for (const expected of IN_EVERY_FILE)
            assert.ok(text.includes(expected), `the ${format} file holds "${expected}":\n${text}`);
          assert.ok(!/INCOMPLETE DRAFT/i.test(text), `the finished ${format} file is not marked a draft`);
        }

        // "Stored revision": the saved version is the document's current revision, whose hash is
        // its own content's, and which holds the answers; each file was made from it, and is the
        // very file stored for it.
        const actor = await resolveWorkspace(account);
        const stored = await getDocument(actor, documentId);
        assert.equal(stored.revision, version, "the saved version is the stored revision");
        assert.equal(
          stored.contentHash,
          sha256(serializeRevision({ title: stored.title, content: stored.content } as never)),
          "the stored revision's hash is its content's",
        );
        const content = JSON.stringify(stored.content);
        for (const [, value] of ANSWERS)
          assert.ok(content.includes(value), `the stored revision holds "${value}"`);
        const made = [];
        for (const file of files) {
          const { job, asset } = await getExport(actor, file.id);
          const bytes = await readFile(file.path);
          assert.equal(job.documentId, documentId);
          assert.equal(job.revisionId, stored.revisionId, "the file was made from the stored revision");
          assert.equal(job.revision, version);
          assert.equal(job.sourceHash, stored.contentHash, "the file was made from the revision's content");
          assert.equal(job.format, file.format);
          assert.equal(job.finished, true);
          assert.equal(job.status, "ready");
          assert.ok(asset, "the file is stored");
          assert.equal(asset.checksum, createHash("sha256").update(bytes).digest("hex"));
          assert.equal(asset.size, bytes.length);
          made.push({
            format: file.format,
            file: file.path.split("/").pop(),
            export: file.id,
            checksum: asset.checksum,
          });
        }
        // The library names what the invoice was made from: Valo's own questions, or the released
        // form it was started from, if one was released when it started (forms v2).
        const madeFrom = stored.form
          ? /Made from the template “[^”]+”, version \d+/
          : /Made from Valo's “Invoice” questions/;
        for (const line of libraryLines) assert.match(line, madeFrom);
        record[screen] = {
          account,
          document: documentId,
          madeFrom: stored.form ? { form: stored.form } : { questions: "TPL-01" },
          savedVersion: version,
          revision: stored.revisionId,
          contentHash: stored.contentHash,
          files: made,
          recordings,
        };
      }

      assert.deepEqual(
        (await Promise.all(real.made)).filter((failure) => failure !== null),
        [],
        "each file was made",
      );
      assert.equal(real.made.length, 4, "two files were asked for on each screen");
      assert.ok(forwarded.length > 0, "the public pages read the real API");
      assert.deepEqual(
        forwarded.filter((each) => !each.startsWith("2")),
        [],
        "the real API answered every read the public pages made",
      );
      await writeFile(
        join(folder, "journey.json"),
        JSON.stringify(
          {
            journey: "UAT-01: a visitor finds a free template, saves a draft and exports it",
            standIns: [
              "the identity provider's sign-up form and session",
              "the queue's worker, whose own function makes each file",
            ],
            screens: record,
          },
          null,
          2,
        ) + "\n",
      );
    } finally {
      await rm(join(folder, ".recording"), { recursive: true, force: true });
      if (!kept) await rm(folder, { recursive: true, force: true });
      await signedIn.close();
      await signedOut.close();
      await site.close();
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await real.close();
    }
  },
);
