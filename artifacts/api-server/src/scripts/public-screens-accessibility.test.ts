import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import * as api from "@workspace/api-zod";
import {
  menuProblems,
  phoneProblems,
  ready,
  settled,
  startApp,
  wcagFailures,
  type Api,
} from "../test-support/app-in-browser";
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
  { path: "/checker", title: "Check your requirements — Valo" },
  { path: "/account-access", title: "Trouble signing in — Valo" },
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

/** A synthetic result with no rule in it, as the contract writes one, and no optional documents. */
const noResult = api.PreviewAssessmentResponse.parse({
  schemaVersion: "checker-result-v1",
  asOfDate: "2026-11-18",
  rulesetVersion: "synthetic-ruleset",
  items: [],
  unanswered: [],
  gaps: ["Synthetic coverage gap."],
  recommendedTemplateIds: [],
  officialRoutes: [],
  notice: "Synthetic test fixture; not legal advice.",
  sourceBackedRecommendations: 0,
  resultHash: "c".repeat(64),
});
const noAids = api.ListOperationalRecommendationsResponse.parse({
  items: [],
  total: 0,
  page: 1,
  heldTemplates: 0,
});

/** Answers the requirements check with the synthetic result, keeping what the page sent to be checked. */
function checking() {
  const sent: { facts: Record<string, unknown> }[] = [];
  const respond: Api = async (route, method, path, query) => {
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "POST" && path === "/checker/preview") {
      sent.push(route.request().postDataJSON() as { facts: Record<string, unknown> });
      return json(noResult);
    }
    if (method === "GET" && path === "/public/recommendations") return json(noAids);
    return answer(route, method, path, query);
  };
  return { sent, respond };
}

/** Chooses an answer as a visitor does, by its label: the radio button itself is not drawn. */
const choose = (page: Page, id: string) => page.getByTestId(id).locator("xpath=..").click();
/** The answers that show as chosen on the step in view. */
const chosen = (page: Page) =>
  page
    .locator('#checker-step input[type="radio"]:checked')
    .evaluateAll((radios) => radios.map((radio) => radio.getAttribute("data-testid")));
/** The steps the list marks as answered. */
async function ticked(page: Page) {
  const done: number[] = [];
  for (let index = 0; index < 6; index++)
    if ((await page.getByTestId(`button-step-${index}`).textContent())?.includes("(answered)"))
      done.push(index);
  return done;
}

// RUL-002: "Represent unknown, unanswered and not-applicable separately from false/zero."
// RUL-001: "irrelevant questions are skipped, progress is clear, and the user can return to previous answers."
test("the requirements check chooses no answer for a visitor: every question starts with nothing chosen, 'I do not know', 'Skip for now' and 'Not applicable' show only once chosen, an emptied box is untouched again, a step is ticked only when its questions are dealt with, and what is sent keeps each apart from 'No' and zero", async () => {
  const { sent, respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", respond);
  try {
    await ready(page);
    const step = page.locator("#checker-step");
    await expect(page.getByTestId("button-reset")).toBeDisabled();

    // On every step nothing is chosen and every answer box is empty; no step is ticked.
    const boxes = [
      '[data-testid="input-activities-0"]',
      '[data-testid="select-state"]',
      '[data-testid="input-lga"]',
      '[data-testid="input-employees"]',
      '[data-testid="input-amount"]',
      '[data-testid="input-turnover-year"]',
      "#turnoverPeriodStart",
      "#turnoverPeriodEnd",
    ];
    const seen: string[] = [];
    for (let index = 0; index < 5; index++) {
      await page.getByTestId(`button-step-${index}`).click();
      assert.deepEqual(await chosen(page), [], `step ${index + 1} chooses nothing`);
      for (const box of boxes)
        if (await step.locator(box).count()) {
          assert.equal(await step.locator(box).inputValue(), "", `${box} starts empty`);
          seen.push(box);
        }
    }
    assert.deepEqual(seen, boxes, "every answer box was looked at");
    assert.deepEqual(await ticked(page), []);

    // "I do not know" and "Skip for now" are separate choices, and neither is made for the visitor.
    await page.getByTestId("button-step-0").click();
    await choose(page, "radio-legalForm-unknown");
    assert.deepEqual(await chosen(page), ["radio-legalForm-unknown"]);
    assert.deepEqual(await ticked(page), [], "the other question is still untouched");
    await choose(page, "radio-registrationStatus-unanswered");
    assert.deepEqual(await chosen(page), ["radio-legalForm-unknown", "radio-registrationStatus-unanswered"]);
    assert.deepEqual(await ticked(page), [0]);

    // Zero is an answer. Emptying the box chooses nothing. Typing takes the place of "Not applicable".
    await page.getByTestId("button-step-3").click();
    const people = page.getByTestId("input-employees");
    await people.fill("0");
    assert.deepEqual(await chosen(page), []);
    await people.fill("");
    assert.deepEqual(await chosen(page), [], "an emptied box is not a chosen skip");
    await choose(page, "radio-employees-not_applicable");
    assert.deepEqual(await chosen(page), ["radio-employees-not_applicable"]);
    assert.equal(await people.inputValue(), "");
    await people.fill("12");
    assert.deepEqual(await chosen(page), []);

    // When turnover does not apply, the questions about the figure are not asked, and the step is done.
    await choose(page, "radio-turnoverBand-not_applicable");
    await expect(page.getByTestId("input-turnover-year")).toHaveCount(0);
    await expect(page.getByTestId("input-amount")).toHaveCount(0);
    await expect(step).toContainText("skipped because turnover does not apply");
    assert.deepEqual(await ticked(page), [0, 3]);
    // Not knowing the turnover is different: the questions come back, and the step is open again.
    await choose(page, "radio-turnoverBand-unknown");
    await expect(page.getByTestId("input-turnover-year")).toHaveCount(1);
    assert.deepEqual(await ticked(page), [0]);

    // The review reads the answers back in the visitor's words, and an answer can be gone back to.
    await page.getByTestId("button-step-5").click();
    const read = (label: string) =>
      page
        .getByTestId("list-review")
        .locator(`xpath=.//dt[normalize-space()="${label}"]/following-sibling::dd[1]`)
        .innerText();
    assert.equal(await read("Legal form"), "I do not know");
    assert.equal(await read("Registration status"), "Not answered");
    assert.equal(await read("Operates from premises"), "Not answered");
    assert.equal(await read("Employees"), "12");
    assert.equal(await read("Turnover band"), "I do not know");
    await page.getByRole("button", { name: "Edit Employees", exact: true }).click();
    await expect(step).toBeFocused();
    await expect(page.getByTestId("input-employees")).toHaveValue("12");

    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    assert.equal(sent.length, 1);
    const facts = sent[0]!.facts;
    assert.equal(facts["legalForm"], "unknown");
    assert.equal(facts["registrationStatus"], "unanswered", "a chosen skip");
    assert.equal(facts["premises"], "unanswered", "an untouched question");
    assert.equal(facts["employees"], "12");
    assert.equal(facts["turnoverBand"], "unknown");
    assert.equal(facts["turnoverYear"], "unanswered");
    assert.equal(facts["turnoverAmountKobo"], null);
    assert.equal(facts["activities"], "unanswered");
    for (const [question, value] of Object.entries(facts))
      assert.ok(
        value !== "no" && value !== "0" && value !== false,
        `${question} was sent as ${String(value)}`,
      );
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("'Start over' has nothing to clear on a fresh page, asks before it clears a visitor's answers, keeps them on 'Keep my answers' or Escape, and on 'Clear my answers' empties the page, removes the results and moves to the first step", async () => {
  const { respond } = checking();
  for (const kind of ["phone", "desktop"] as const) {
    const { page, errors, close } = await app[kind]("/checker", respond);
    try {
      await ready(page);
      const reset = page.getByTestId("button-reset");
      const dialog = page.locator("dialog[open]");
      const activity = page.getByTestId("input-activities-0");
      await expect(reset).toBeDisabled();

      await choose(page, "radio-legalForm-partnership");
      await page.getByTestId("button-step-5").click();
      await page.getByTestId("button-run").click();
      await page.getByTestId("assessment-result").waitFor();
      await page.getByTestId("button-step-1").click();
      await activity.fill("Selling fabric wholesale");

      await reset.click();
      await expect(dialog).toContainText("Start over?");
      await expect(dialog).toContainText("This clears every answer on this page and the results below it.");
      // The dialog sits in the middle of the screen and clear of its sides, with the button that
      // keeps the answers focused.
      const box = (await dialog.boundingBox())!,
        view = page.viewportSize()!;
      assert.ok(
        Math.abs(box.x + box.width / 2 - view.width / 2) <= 1 &&
          Math.abs(box.y + box.height / 2 - view.height / 2) <= 1,
        `${kind}: the dialog is not in the middle: ${JSON.stringify(box)} of ${JSON.stringify(view)}`,
      );
      assert.ok(
        box.x >= 8 && box.y >= 8 && box.x + box.width <= view.width - 8,
        `${kind}: the dialog touches the screen's edge: ${JSON.stringify(box)}`,
      );
      await expect(dialog.getByTestId("button-keep")).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(reset).toBeFocused();
      await expect(activity).toHaveValue("Selling fabric wholesale");
      await reset.click();
      await dialog.getByTestId("button-keep").click();
      await expect(dialog).toHaveCount(0);
      await expect(activity).toHaveValue("Selling fabric wholesale");
      await expect(page.getByTestId("assessment-result")).toHaveCount(1);

      await reset.click();
      await dialog.getByTestId("button-confirm").click();
      await expect(dialog).toHaveCount(0);
      const step = page.locator("#checker-step");
      await expect(step).toHaveAttribute("aria-label", "Your business");
      await expect(step).toBeFocused();
      assert.deepEqual(await chosen(page), []);
      await expect(page.getByTestId("assessment-result")).toHaveCount(0);
      assert.deepEqual(await ticked(page), []);
      await expect(reset).toBeDisabled();
      await page.getByTestId("button-step-1").click();
      await expect(activity).toHaveValue("");
      assert.deepEqual(errors, [], kind);
    } finally {
      await close();
    }
  }
});

test("on a phone, every step of the requirements check, its review, its results and its 'Start over' dialog fit 360 and 320 pixels, move keyboard focus only to visible outlined elements and have no automated WCAG 2.2 AA failure", async () => {
  const { respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", respond);
  const problems: string[] = [];
  /** Checks what is in view at the phone's width, then at 320 pixels, and goes back to the phone's. */
  const look = async (name: string) => {
    await settled(page);
    problems.push(...(await phoneProblems(page, name)));
    await page.setViewportSize({ width: 360, height: 640 });
  };
  try {
    await ready(page);
    // An answer that brings out the question asked only of importers. The others are all in view:
    // the local government area, and the questions about the turnover figure.
    await page.getByTestId("button-step-1").click();
    await choose(page, "radio-importing-yes");
    await expect(page.getByTestId("input-productTypes-0")).toHaveCount(1);
    // And one that ticks a step whose place in the list of steps is past the screen's edge, where
    // the tick's hidden words must not widen the page.
    await page.getByTestId("button-step-4").click();
    await choose(page, "radio-personalData-yes");
    assert.deepEqual(await ticked(page), [4]);
    for (let index = 0; index < 6; index++) {
      await page.getByTestId(`button-step-${index}`).click();
      await look(`step ${index + 1}`);
    }
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    await look("the results");

    await page.getByTestId("button-reset").click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog).toContainText("Start over?");
    const { failures } = await wcagFailures(page);
    problems.push(...failures.map((failure) => `the dialog: ${failure}`));
    // The keyboard reaches the dialog's two buttons and nothing on the page behind it. Between
    // rounds the focus may leave the page for the browser's own controls.
    const stops = new Set<string>();
    for (let press = 0; press < 6; press++) {
      await page.keyboard.press("Tab");
      stops.add(
        await page.evaluate<string>(`(() => {
          const at = document.activeElement;
          if (!at || at === document.body || at === document.documentElement) return "the browser";
          return at.closest("dialog[open]") ? at.getAttribute("data-testid") : "behind: " + at.outerHTML.slice(0, 80);
        })()`),
      );
    }
    stops.delete("the browser");
    if ([...stops].sort().join() !== "button-confirm,button-keep")
      problems.push(`the dialog: Tab reached ${[...stops].join(", ")}`);
    problems.push(...unknown.map((call) => `no test answer for ${call}`));
    problems.push(...errors.map((error) => `page error ${error}`));
  } finally {
    await close();
  }
  assert.deepEqual(problems, []);
});
