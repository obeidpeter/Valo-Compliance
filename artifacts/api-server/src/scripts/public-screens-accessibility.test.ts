import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { menuProblems, phoneProblems, ready, settled, startApp } from "../test-support/app-in-browser";
import { answer } from "../test-support/public-answers";

/**
 * NFR-006: "WCAG 2.2 AA target across critical flows; keyboard, visible focus, screen-reader labels,
 * errors and reflow", checked by "Automated checks plus manual keyboard and assistive-technology
 * review".
 *
 * The public screens the primary-page checks (public-page-states.test.ts) leave out. Moving between
 * public pages, which can now be server-rendered (decision 0011), is checked against the compiled web
 * server in public-server-pages.test.ts. The app is bundled with a
 * stand-in for the identity library that reports a signed-out visitor (see app-in-browser.ts), on
 * an emulated phone, with the API answered in the page by synthetic data its contract accepts. The
 * automated check is axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules. It is not a manual or
 * assistive-technology review, and it does not check the identity provider's own sign-in widgets.
 */
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp("signed-out");
});
after(() => app.close());

/** The public screens the primary-page checks leave out, with the title each gives the page. */
const SCREENS: { path: string; title: string; ready?: string; minimumStops?: number }[] = [
  { path: "/checker", title: "Business requirements checker — Valo" },
  { path: "/account-access", title: "Account access help — Valo" },
  // The sign-in pages draw no site shell; the provider's card holds their heading and form. Their own
  // focusable elements are the wordmark and the access help link.
  {
    path: "/sign-in",
    title: "Sign in — Valo",
    ready: '[data-testid="link-auth-access-help"]',
    minimumStops: 2,
  },
  {
    path: "/sign-up",
    title: "Create account — Valo",
    ready: '[data-testid="link-auth-access-help"]',
    minimumStops: 2,
  },
];

test("on a phone, each public screen the primary-page checks leave out names itself in the page title, fits 360 and 320 pixels, moves keyboard focus only to visible outlined elements and has no automated WCAG 2.2 AA failure", async () => {
  const problems: string[] = [];
  for (const screen of SCREENS) {
    const { page, unknown, errors, close } = await app.phone(screen.path, answer);
    try {
      const shown = await (
        screen.ready
          ? page
              .locator(screen.ready)
              .first()
              .waitFor({ state: "visible", timeout: 30_000 })
              .then(() => settled(page))
          : ready(page)
      ).then(
        () => true,
        async (error: unknown) => {
          const text = (await page.evaluate("document.body.innerText")) as string;
          problems.push(
            `${screen.path}: not ready (${String(error).split("\n")[0]}); shows: ${text.slice(0, 300).replace(/\s+/g, " ")}`,
          );
          return false;
        },
      );
      if (shown) {
        const title = await page.title();
        if (title !== screen.title) problems.push(`${screen.path}: titled "${title}"`);
        problems.push(
          ...(await phoneProblems(
            page,
            screen.path,
            screen.minimumStops ? { minimumStops: screen.minimumStops } : {},
          )),
        );
      }
      problems.push(...unknown.map((call) => `${screen.path}: no test answer for ${call}`));
      problems.push(...errors.map((error) => `${screen.path}: page error ${error}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

test("signed out, the phone's opened menu fits a short screen and a phone on its side: every control in it comes to rest on screen and clear of the bottom bar", async () => {
  const { page, errors, close } = await app.phone("/checker", answer);
  try {
    await ready(page);
    // The site's five pages, sign in and create account.
    assert.deepEqual(await menuProblems(page, "/checker", { minimumStops: 7 }), []);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});
