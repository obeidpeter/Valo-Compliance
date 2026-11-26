import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import type { Page } from "playwright";
import { ready, settled, startApp, type Api } from "../test-support/app-in-browser";
import { LONG_MARKUP, MARK, PROBE, SHORT_MARKUP, type Probe } from "../test-support/hostile-markup";

/**
 * SEC-003: "Accept: stored/reflected XSS, injection and cross-site mutation tests pass." Markup saved
 * through the real API is drawn by the real web app as the text the person typed, and none of it runs
 * (docs/architecture/hostile-input.md, part 2).
 *
 * A synthetic customer saves hostile markup wherever they type text the app shows back: the business
 * profile, a document's title, fields and paragraph, a form's title and answers, a task, a support
 * request and a privacy request. A member of staff answers the support request with markup too. Then
 * each screen that shows those texts is opened, the customer's and the staff's, and must show the
 * markup as text, with no element it tried to make and no script it carried run.
 *
 * The test page is served without the site's content security policy, so what this shows is that the
 * app's own handling of text stops the markup, not the policy behind it. The policy has its own tests
 * (content-security-policy.test.ts and frontend-security-browser.ts).
 *
 * What is stood in for, and nothing else: the identity provider, as in the tester tasks rehearsal. No
 * provider is called and every record is synthetic.
 */
const enabled = process.env.VALO_RUN_DB_TESTS === "synthetic-development-only";

test(
  "markup saved through the API is drawn as text on the customer's and staff's screens, and none of it runs",
  { skip: !enabled, timeout: 300_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const identityHeader = "x-synthetic-identity";
    const tag = randomUUID();
    const customer = `synthetic-markup-${tag}`;
    // Staff assignments name a sign-in account, which the provider writes as user_ followed by letters.
    const staff = `user_synthetic_markup_${tag.replaceAll("-", "")}`;
    t.mock.module("@clerk/express", {
      namedExports: {
        clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
        getAuth: (req: Request) => {
          const asked = req.header(identityHeader);
          const id = asked === customer || asked === staff ? asked : null;
          // The member of staff has just passed both sign-in factors, as staff screens need.
          const fresh = id === staff;
          return {
            userId: id,
            sessionId: id ? `sess_${id}` : null,
            sessionClaims: fresh ? { fva: [0, 0] } : null,
            has: () => fresh,
          };
        },
        clerkClient: {
          sessions: {
            getSession: async (id: string) => ({ status: "active", userId: id.slice("sess_".length) }),
          },
          users: {
            getUser: async (id: string) => ({
              id,
              banned: false,
              locked: false,
              twoFactorEnabled: id === staff,
              primaryEmailAddressId: "primary",
              emailAddresses: [
                {
                  id: "primary",
                  emailAddress: "synthetic@example.invalid",
                  verification: { status: "verified" },
                },
              ],
            }),
          },
        },
      },
    });
    const { default: app } = await import("../app");
    const { db, pool, valoStaffAssignments } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { syntheticDocument, syntheticProfile } = await import("../lib/valo-test-fixtures");
    const { compileGuidedContent, emptyGuidedData } = await import("@workspace/valo-core/guided-runtime");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const api = `http://127.0.0.1:${address.port}`;
    const previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    const signedIn = await startApp("signed-in");
    // The page's own address is the one the server trusts for a change, as the site's is.
    process.env.VALO_TRUSTED_ORIGIN = signedIn.origin;

    /** Saves through the real API as the account given, as the site's own page would send it. */
    const save = async (account: string, method: string, path: string, body?: unknown) => {
      const reply = await fetch(`${api}/api${path}`, {
        method,
        headers: {
          [identityHeader]: account,
          Origin: signedIn.origin,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await reply.text();
      assert.ok(reply.ok, `${method} ${path}: ${reply.status} ${text.slice(0, 400)}`);
      return (text ? JSON.parse(text) : null) as Record<string, unknown>;
    };
    /** Passes each request the page makes to the real API, as the account given. */
    const refused: string[] = [];
    const through =
      (account: string): Api =>
      async (route, method, path, query) => {
        const headers = await route.request().allHeaders();
        delete headers.host;
        headers[identityHeader] = account;
        const search = query.toString();
        const reply = await route.fetch({ url: `${api}/api${path}${search ? `?${search}` : ""}`, headers });
        if (reply.status() >= 400) refused.push(`${reply.status()} ${method} ${path}`);
        await route.fulfill({ response: reply });
      };
    /** Opens a screen as the account given, does what shows the texts, and checks what it drew. */
    const screen = async (account: string, path: string, show?: (page: Page) => Promise<void>) => {
      const { page, errors, unknown, close } = await signedIn.desktop(path, through(account));
      try {
        await ready(page);
        if (show) await show(page);
        await settled(page);
        const drawn = (await page.evaluate(PROBE)) as Probe;
        assert.equal(drawn.ran, null, `${path}: a payload ran`);
        assert.deepEqual(drawn.injected, [], `${path}: the markup made elements`);
        assert.ok(drawn.text.includes(MARK), `${path} does not show the markup as text`);
        assert.deepEqual(errors, [], `${path}: page errors`);
        assert.deepEqual(unknown, [], `${path}: requests with no answer`);
      } catch (error) {
        const shown = await page
          .locator("body")
          .innerText()
          .catch(() => "(the page could not be read)");
        console.error(`At ${page.url()}\nThe page showed:\n${shown.slice(0, 3000)}`);
        throw error;
      } finally {
        await close();
      }
    };

    try {
      await db.insert(valoStaffAssignments).values(
        (["content", "support", "privacy"] as const).map((role) => ({
          id: randomUUID(),
          identityId: staff,
          role,
          grantedBy: "synthetic-stored-markup",
          reason: "Synthetic member of staff for the stored markup test",
        })),
      );

      // What the customer types, saved through the API.
      await save(customer, "GET", "/workspace");
      await save(customer, "PUT", "/workspace/profile", {
        expectedRevision: 0,
        profile: { ...syntheticProfile, businessName: SHORT_MARKUP },
      });
      const document = await save(customer, "POST", "/workspace/documents", {
        ...syntheticDocument,
        title: SHORT_MARKUP,
        content: {
          ...syntheticDocument.content,
          fields: {
            ...syntheticDocument.content.fields,
            issuerName: SHORT_MARKUP,
            recipientName: SHORT_MARKUP,
            notes: LONG_MARKUP,
          },
          blocks: [{ id: "section-1", type: "paragraph", text: LONG_MARKUP, rows: [] }],
        },
      });
      // The invoice's questions-only form, started as the app's own button starts it, with its answers.
      const guided = emptyGuidedData("TPL-01");
      guided.values = {
        ...guided.values,
        issuerName: SHORT_MARKUP,
        recipientName: SHORT_MARKUP,
        billingBasis: LONG_MARKUP,
      };
      const form = await save(customer, "POST", "/workspace/documents", {
        title: SHORT_MARKUP,
        content: compileGuidedContent(guided),
      });
      await save(customer, "POST", "/workspace/tasks", {
        title: SHORT_MARKUP,
        notes: LONG_MARKUP,
        dueDate: null,
        dateConfirmed: false,
        assessmentId: null,
        ruleId: null,
      });
      await save(customer, "POST", "/workspace/support", {
        category: "support",
        scope: LONG_MARKUP,
        contactEmail: "synthetic@example.invalid",
        sharingConsent: true,
      });
      await save(customer, "POST", "/workspace/privacy-requests", {
        kind: "correction",
        message: LONG_MARKUP,
        acknowledgement: true,
        idempotencyKey: randomUUID(),
      });
      // A member of staff answers the support request with markup too.
      const cases = (await save(customer, "GET", "/workspace/support-cases")) as {
        cases: { id: string; reference: string }[];
      };
      const supportCase = cases.cases[0]!;
      await save(staff, "POST", `/admin/support-cases/${supportCase.id}/action`, {
        idempotencyKey: randomUUID(),
        expectedVersion: 1,
        action: "reply",
        body: LONG_MARKUP,
      });

      // Each screen that shows those texts.
      for (const path of [
        "/workspace",
        "/workspace/documents",
        `/workspace/documents/${String(document.id)}`,
        `/workspace/documents/${String(form.id)}`,
        "/workspace/profile",
        "/workspace/tasks",
        "/workspace/privacy",
      ])
        await t.test(`the customer's ${path} shows the markup as text`, () => screen(customer, path));
      await t.test("the customer's support request and the staff's answer show the markup as text", () =>
        screen(customer, "/workspace/support", async (page) => {
          await page
            .locator("li", { hasText: supportCase.reference })
            .getByRole("button", { name: "View conversation" })
            .click();
          await page.getByText("staff", { exact: false }).first().waitFor();
        }),
      );
      await t.test("the staff's support case shows the customer's markup as text", () =>
        screen(staff, "/staff", async (page) => {
          await page.getByTestId("tab-staff-support").click();
          await page
            .locator("li", { hasText: supportCase.reference })
            .getByRole("button", { name: "Open case operations" })
            .click();
          await page.getByText(MARK, { exact: false }).first().waitFor();
        }),
      );
      await t.test("the staff's privacy queue shows the customer's markup as text", () =>
        // The queue loads after the page's heading, so the check waits for the request to be listed.
        screen(staff, "/staff/privacy", (page) => page.getByText(MARK, { exact: false }).first().waitFor()),
      );
      assert.deepEqual(refused, [], "the server refused a request a screen made");

      // The check finds markup drawn as HTML: the same markup, put into a page as HTML on purpose,
      // runs and leaves its elements, and the check sees both.
      await t.test("the check finds markup that a page draws as HTML", async () => {
        const { page, close } = await signedIn.desktop("/workspace", through(customer));
        try {
          await ready(page);
          await page.evaluate(
            `document.querySelector("main").insertAdjacentHTML("beforeend", ${JSON.stringify(SHORT_MARKUP)})`,
          );
          await page.waitForFunction("window.__vh !== undefined", undefined, { timeout: 10_000 });
          const drawn = (await page.evaluate(PROBE)) as Probe;
          assert.notEqual(drawn.ran, null);
          assert.ok(drawn.injected.length >= 2, drawn.injected.join("\n"));
        } finally {
          await close();
        }
      });
    } finally {
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(eq(valoStaffAssignments.identityId, staff));
      await signedIn.close();
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
