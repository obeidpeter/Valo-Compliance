import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { expect, type Page } from "@playwright/test";
import * as api from "@workspace/api-zod";
import { assess, checkerFactsSchema } from "@workspace/valo-core";
import {
  menuProblems,
  phoneProblems,
  ready,
  settled,
  startApp,
  wcagFailures,
  type Api,
} from "../test-support/app-in-browser";
import { oldWordsIn } from "../test-support/old-words";
import { answer, rulesInUse } from "../test-support/public-answers";

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
  // Where a reminder email's unsubscribe link leads. The link's token here is the test's own.
  { path: "/unsubscribe?t=synthetic.unsubscribe.token", title: "Stop reminder emails — Valo" },
  // An address the site does not have.
  { path: "/synthetic-missing-page", title: "Page not found — Valo" },
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

/** No rule in use: the check asks only its own questions. */
const noRules = api.ListCheckerRulesInUseResponse.parse({ asOfDate: "2026-11-18", rules: [] });

/** Answers the requirements check with the synthetic result, keeping what the page sent to be checked.
 * By default one synthetic rule of each kind is in use. */
function checking(rules: unknown = rulesInUse) {
  const sent: { facts: Record<string, unknown> }[] = [];
  const respond: Api = async (route, method, path, query) => {
    const json = (body: unknown) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "GET" && path === "/checker/questions") return json(rules);
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
  // The check's own questions alone: the rules' questions are checked on their own below.
  const { sent, respond } = checking(noRules);
  const { page, unknown, errors, close } = await app.phone("/checker", respond);
  try {
    await ready(page);
    const step = page.locator("#checker-step");
    await expect(page.getByTestId("button-reset")).toBeDisabled();

    // On every step nothing is chosen and every answer box is empty; no step is ticked.
    const boxes = [
      '[data-testid="input-activities-0"]',
      '[data-testid="select-state"]',
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

    // The local government area is asked once a state is chosen, and its box starts empty too.
    await page.getByTestId("button-step-2").click();
    await expect(step.getByTestId("input-lga")).toHaveCount(0);
    await expect(step).toContainText("The local government area is asked once you choose a state.");
    await page.getByTestId("select-state").selectOption("Lagos");
    assert.equal(await step.getByTestId("input-lga").inputValue(), "");
    await page.getByTestId("select-state").selectOption("");
    await expect(step.getByTestId("input-lga")).toHaveCount(0);
    assert.deepEqual(await chosen(page), []);
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
    await page.getByRole("button", { name: "Change Employees", exact: true }).click();
    await expect(page.getByTestId("input-employees")).toBeFocused();
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

// RUL-001: "irrelevant questions are skipped, progress is clear, and the user can return to previous answers."
test("each rule's questions are asked in their step under the requirement's name, only while they can matter: an earlier answer that settles one shows it answered, with where it came from and a way back to it, an answer a changed choice hides is kept but not sent, and a visitor who is not signed in is offered the sign-in links in place of the business-name questions", async () => {
  const { sent, respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", respond);
  try {
    await ready(page);
    const step = page.locator("#checker-step");

    // In place of the business-name questions: the requirement, and the links that keep the answers.
    const signIn = page.getByTestId("rule-questions-businessName-sign-in");
    await expect(signIn.locator("h3")).toHaveText("Synthetic business-name requirement");
    await expect(signIn).toContainText("We never ask for your business name here.");
    await expect(signIn.getByTestId("link-signin-business-name")).toHaveAttribute(
      "href",
      /^\/sign-in\?start=/,
    );
    await expect(step.locator('[id^="rich-businessName-"]')).toHaveCount(0);

    // The company-return questions, under their requirement's name, before any answer settles them.
    const tax = page.getByTestId("rule-questions-tax");
    await expect(tax.locator("h3")).toHaveText("Synthetic company-return requirement");
    await expect(tax.getByTestId("radio-rich-tax-legalForm-company")).toHaveCount(1);
    await expect(tax.getByTestId("radio-rich-tax-incorporatedAsCompany-true")).toHaveCount(1);
    await expect(tax.getByTestId("radio-rich-tax-incorporatedInNigeria-true")).toHaveCount(0);

    // A limited company settles what its records describe, which is shown answered and not asked.
    await choose(page, "radio-legalForm-limited_company");
    const records = page.getByTestId("filled-rich-tax-legalForm");
    await expect(records).toContainText("What do the entity’s formation records describe?");
    await expect(records).toContainText("Company. From your answer to ‘How is the business set up?’.");
    await expect(tax.getByTestId("radio-rich-tax-legalForm-company")).toHaveCount(0);
    // Records that describe a company settle whether it was incorporated as one: neither asked nor shown.
    await expect(tax.getByTestId("radio-rich-tax-incorporatedAsCompany-true")).toHaveCount(0);
    await expect(page.getByTestId("filled-rich-tax-incorporatedAsCompany")).toHaveCount(0);
    // Registered with the CAC, it was incorporated in Nigeria, and its status is asked.
    await choose(page, "radio-registrationStatus-registered");
    await expect(page.getByTestId("filled-rich-tax-incorporatedInNigeria")).toContainText(
      "Yes. From your answers to ‘How is the business set up?’ and ‘Is it registered with the Corporate Affairs Commission (CAC)?’.",
    );
    await choose(page, "radio-rich-tax-companyStatus-active");

    // A partnership's records are the visitor's to describe: the status question goes, and its
    // answer is kept for when it comes back.
    await choose(page, "radio-legalForm-partnership");
    await expect(tax.getByTestId("radio-rich-tax-companyStatus-active")).toHaveCount(0);
    await expect(tax.getByTestId("radio-rich-tax-legalForm-company")).toHaveCount(1);
    await expect(page.getByTestId("filled-rich-tax-incorporatedAsCompany")).toContainText("No.");
    // The way back to the answer that filled it.
    await page.getByTestId("button-change-rich-tax-incorporatedAsCompany").click();
    await expect(page.locator("#legalForm")).toBeFocused();
    await choose(page, "radio-legalForm-limited_company");
    await expect(tax.getByTestId("radio-rich-tax-companyStatus-active")).toBeChecked();

    // Products: with neither regulated supply nor manufacture in Nigeria, the rest is not asked.
    await page.getByTestId("button-step-1").click();
    const product = page.getByTestId("rule-questions-product");
    await expect(product.locator("h3")).toHaveText("Synthetic product requirement");
    await choose(page, "radio-rich-product-commercialSupplyOfRegulatedProducts-false");
    await expect(product.getByTestId("radio-rich-product-activity-manufacture")).toHaveCount(1);
    await choose(page, "radio-rich-product-manufacturesInNigeria-false");
    await expect(product.getByTestId("radio-rich-product-activity-manufacture")).toHaveCount(0);

    // Personal data: a business that says it uses no information about identifiable people is
    // asked which kinds it keeps, ticked as boxes.
    await page.getByTestId("button-step-2").click();
    await page.getByTestId("select-state").selectOption("Lagos");
    await page.getByTestId("button-step-4").click();
    const privacy = page.getByTestId("rule-questions-privacy");
    await expect(privacy.locator("h3")).toHaveText("Synthetic personal-data requirement");
    await choose(page, "radio-rich-privacy-processesPersonalData-false");
    const phones = privacy.getByTestId("check-rich-privacy-dataCategories-phone");
    await phones.locator("xpath=..").click();
    await expect(phones).toBeChecked();
    const { failures } = await wcagFailures(page);
    assert.deepEqual(failures, [], "the rule's questions have no automated WCAG 2.2 AA failure");
    assert.deepEqual(await phoneProblems(page, "the personal-data questions"), []);
    // Keeping customers' or staff's personal data settles that it does, and where the business is
    // settles that it operates in Nigeria.
    await page.setViewportSize({ width: 360, height: 640 });
    await choose(page, "radio-personalData-yes");
    await expect(page.getByTestId("filled-rich-privacy-processesPersonalData")).toContainText(
      "Yes. From your answer to ‘Do you collect or keep customer or staff personal data?’.",
    );
    await expect(page.getByTestId("filled-rich-privacy-operatesInNigeria")).toContainText(
      "Yes. From your answer to ‘Which state is the business in?’.",
    );
    await expect(phones).toHaveCount(0);
    await expect(privacy.getByTestId("radio-rich-privacy-controllerRole-controller")).toHaveCount(1);

    // What is sent: the answers asked, the filled ones in place, and none that a changed choice hid.
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0]!.facts["rich"], {
      tax: { legalForm: "company", incorporatedInNigeria: true, companyStatus: "active" },
      product: { commercialSupplyOfRegulatedProducts: false, manufacturesInNigeria: false },
      privacy: { processesPersonalData: true, operatesInNigeria: true },
    });
    assert.equal(sent[0]!.facts["factsVersion"], "checker-facts-v2");
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// RUL-001: "irrelevant questions are skipped, progress is clear, and the user can return to previous answers."
test("what the business does and its kinds of product are chosen from fixed lists, with the visitor's own words beside them, up to ten in all, and one kind of product alone answers the product rule's question about the particular product", async () => {
  const { sent, respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", respond);
  try {
    await ready(page);
    await page.getByTestId("button-step-1").click();
    // The specification's twenty industries, named as the site names them, and the visitor's own words.
    const industries = page.locator('[data-testid^="check-activities-"]');
    await expect(industries).toHaveCount(20);
    await expect(page.getByTestId("check-activities-retail/wholesale").locator("xpath=..")).toHaveText(
      "Retail/wholesale",
    );
    await choose(page, "check-activities-retail/wholesale");
    await page.getByTestId("input-activities-0").fill("Selling fabric wholesale");
    await expect(page.getByTestId("check-activities-retail/wholesale")).toBeChecked();
    // Ten entries in all: then the other industries and an empty box take no more.
    for (const industry of [
      "agriculture",
      "construction",
      "real estate",
      "e-commerce",
      "education",
      "energy",
      "healthcare",
      "import/export",
    ])
      await choose(page, `check-activities-${industry}`);
    await expect(page.getByTestId("check-activities-other")).toBeDisabled();
    await expect(page.getByRole("button", { name: "Add another" })).toHaveCount(0);
    for (const industry of [
      "construction",
      "real estate",
      "e-commerce",
      "education",
      "energy",
      "healthcare",
      "import/export",
    ])
      await choose(page, `check-activities-${industry}`);
    await expect(page.getByTestId("check-activities-other")).toBeEnabled();

    // The Act's six kinds of product, once the business makes or imports goods.
    await choose(page, "radio-importing-yes");
    await expect(page.locator('[data-testid^="check-productTypes-"]')).toHaveCount(6);
    await choose(page, "check-productTypes-cosmetic");
    const particular = page.getByTestId("filled-rich-product-productCategory");
    await expect(particular).toContainText("Cosmetic. From your answer to ‘Which kinds of product?’.");
    // A second kind is not the particular product, so the rule's own question is asked again.
    await choose(page, "check-productTypes-water");
    await expect(particular).toHaveCount(0);
    await expect(page.getByTestId("radio-rich-product-productCategory-drug_product")).toHaveCount(1);
    await choose(page, "check-productTypes-water");
    await expect(particular).toHaveCount(1);

    // The review names them as the site does, and what is sent holds each as its source writes it.
    await page.getByTestId("button-step-5").click();
    await expect(
      page
        .getByTestId("list-review")
        .locator('xpath=.//dt[normalize-space()="Activities"]/following-sibling::dd[1]'),
    ).toHaveText("Retail/wholesale; Agriculture; Selling fabric wholesale");
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    assert.equal(sent.length, 1);
    const facts = sent[0]!.facts;
    assert.deepEqual(facts["activities"], ["retail/wholesale", "agriculture", "Selling fabric wholesale"]);
    assert.deepEqual(facts["productTypes"], ["cosmetic"]);
    assert.deepEqual((facts["rich"] as { product?: unknown } | undefined)?.product, {
      productCategory: "cosmetic",
    });
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// RUL-001: "irrelevant questions are skipped, progress is clear, and the user can return to previous answers."
test("progress counts the questions asked now, the rules' among them, and a step is ticked once every question it asks is dealt with; the review lists every question asked, a filled answer saying where it came from, each with a link back to it; and a result's still-unanswered questions link back too", async () => {
  const { respond } = checking();
  const unansweredResult = api.PreviewAssessmentResponse.parse({ ...noResult, unanswered: ["employees"] });
  const withUnanswered: Api = async (route, method, path, query) =>
    method === "POST" && path === "/checker/preview"
      ? route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(unansweredResult),
        })
      : respond(route, method, path, query);
  const { page, unknown, errors, close } = await app.phone("/checker", withUnanswered);
  try {
    await ready(page);
    const count = async () => {
      const text = ((await page.getByTestId("status-checker-progress").textContent()) ?? "").trim();
      const found = /^(\d+) of (\d+) questions answered$/.exec(text);
      assert.ok(found, text);
      return [Number(found[1]), Number(found[2])] as const;
    };
    const [none, total] = await count();
    assert.equal(none, 0);
    // A limited company fills what the company return's records describe, which counts as answered.
    await choose(page, "radio-legalForm-limited_company");
    assert.equal((await count())[0], 2, "the answer and the records it fills");
    // Registered with the CAC, it was incorporated in Nigeria: that is filled too, and opens the
    // company's status and accounting period, so more questions are asked.
    await choose(page, "radio-registrationStatus-registered");
    assert.deepEqual(await count(), [4, total + 3]);
    // The step is ticked only once the rule's questions in it are dealt with too.
    assert.deepEqual(await ticked(page), []);
    await choose(page, "radio-rich-tax-companyStatus-active");
    await choose(page, "radio-rich-tax-accountingPeriodStart-unknown");
    await choose(page, "radio-rich-tax-accountingPeriodEnd-unanswered");
    assert.deepEqual(await ticked(page), [0]);

    // The review lists the questions asked, a filled one with where it came from, and none skipped.
    await page.getByTestId("button-step-5").click();
    const review = page.getByTestId("list-review");
    const row = (label: string) =>
      review.locator(`xpath=.//dt[normalize-space()="${label}"]/following-sibling::dd[1]`);
    await expect(row("What do the entity’s formation records describe?")).toContainText("Company");
    await expect(row("What do the entity’s formation records describe?")).toContainText(
      "From your answer to ‘How is the business set up?’.",
    );
    await expect(row("What is the entity’s current operating status?")).toHaveText("Operating");
    await expect(row("Was the entity incorporated as a company?")).toHaveCount(0);
    await expect(row("Local government area")).toHaveCount(0);
    // Its link moves to the question's place.
    await review
      .getByRole("button", { name: "Change What do the entity’s formation records describe?", exact: true })
      .click();
    await expect(page.locator("#rich-tax-legalForm-state")).toBeFocused();

    // A result's still-unanswered question links back to it.
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    await page.getByRole("button", { name: "Answer Employees", exact: true }).click();
    await expect(page.locator("#checker-step")).toHaveAttribute("aria-label", "Size and turnover");
    await expect(page.getByTestId("input-employees")).toBeFocused();
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("when the rules the check uses cannot be loaded, the steps that would ask their questions say so, and the check still runs on its own questions", async () => {
  const { sent, respond } = checking();
  const failing: Api = async (route, method, path, query) =>
    method === "GET" && path === "/checker/questions"
      ? route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic outage." }),
        })
      : respond(route, method, path, query);
  const { page, errors, close } = await app.phone("/checker", failing);
  try {
    await ready(page);
    const notice = page.getByText("Some questions could not be loaded", { exact: true });
    await expect(notice).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("rule-questions-tax")).toHaveCount(0);
    await page.getByTestId("button-step-2").click();
    await expect(notice).toHaveCount(0);
    await page.getByTestId("button-step-4").click();
    await expect(notice).toBeVisible();
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    assert.equal(sent.length, 1);
    assert.equal(Object.hasOwn(sent[0]!.facts, "rich"), false);
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
    // An answer that brings out the question asked only of importers, and a state, which brings
    // out the local government area. The questions about the turnover figure are in view already.
    await page.getByTestId("button-step-1").click();
    await choose(page, "radio-importing-yes");
    await expect(page.getByTestId("input-productTypes-0")).toHaveCount(1);
    await page.getByTestId("button-step-2").click();
    await page.getByTestId("select-state").selectOption("Lagos");
    await expect(page.getByTestId("input-lga")).toHaveCount(1);
    // And one that ticks a step whose place in the list of steps is past the screen's edge, where
    // the tick's hidden words must not widen the page. The step asks the personal-data rule's
    // questions too, so "I do not know" deals with those the answers open.
    await page.getByTestId("button-step-4").click();
    await choose(page, "radio-personalData-yes");
    for (const question of ["section3Exception", "processingPurpose", "controllerRole"])
      await choose(page, `radio-rich-privacy-${question}-unknown`);
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

// The identity provider cannot load in a test, so its forms are stand-ins that show what the app
// hands them. This checks the app's side: the provider's own redirect is not exercised here.
// PRV-001: the privacy notice is linked where an account is created (docs/architecture/processing-inventory.md,
// slice 3b).
test("before an account is created or a message is saved, the sign-up page and the trouble-signing-in form link what Valo does with your data", async () => {
  for (const [path, id] of [
    ["/sign-up", "link-auth-privacy"],
    ["/account-access", "link-access-privacy"],
  ] as const) {
    const { page, errors, close } = await app.desktop(path, answer);
    try {
      const link = page.getByTestId(id);
      await link.waitFor({ state: "visible", timeout: 30_000 });
      assert.equal(await link.getAttribute("href"), "/privacy", path);
      assert.equal((await link.innerText()).trim(), "what Valo does with your data", path);
      assert.deepEqual(errors, [], path);
    } finally {
      await close();
    }
  }
});

test("what a visitor chose on the landing page is handed to sign-up and sign-in: the page to start on afterwards, and the other form's address with the choice kept; a choice the site does not offer is handed nowhere", async () => {
  const cases: [address: string, after: string, otherForm: string][] = [
    ["/sign-up?start=invoice", "/workspace/documents/new?start=invoice", "/sign-in?start=invoice"],
    ["/sign-up?start=agreement", "/workspace/documents/new?start=agreement", "/sign-in?start=agreement"],
    ["/sign-up?start=document", "/workspace/documents/new", "/sign-in?start=document"],
    ["/sign-in?start=hire", "/workspace/documents/new?start=hire", "/sign-up?start=hire"],
    // Nothing chosen: the provider goes where it would by itself.
    ["/sign-up", "", "/sign-in"],
    ["/sign-in", "", "/sign-up"],
    // Made up: never passed on.
    ["/sign-up?start=nothing", "", "/sign-in"],
    ["/sign-up?start=%2Fstaff", "", "/sign-in"],
    ["/sign-up?start=https%3A%2F%2Fexample.test%2F", "", "/sign-in"],
    ["/sign-in?start=%2F%2Fexample.test", "", "/sign-up"],
  ];
  for (const [address, after, otherForm] of cases) {
    const { page, errors, close } = await app.desktop(address, answer);
    try {
      const card = page.getByTestId("identity-card");
      await card.waitFor({ state: "visible", timeout: 30_000 });
      assert.equal(await card.getAttribute("data-after"), after, `${address}: where to go afterwards`);
      assert.equal(await card.getAttribute("data-other-form"), otherForm, `${address}: the other form`);
      assert.deepEqual(errors, [], address);
    } finally {
      await close();
    }
  }
  // The sign-up card opens with the words for creating an account.
  const { page, close } = await app.desktop("/sign-up", answer);
  try {
    await expect(page.getByTestId("identity-card").locator("h1")).toHaveText("Create your account");
  } finally {
    await close();
  }
});

/** The project's words for a result, none of which a result shows now. */
const OLD_RESULT_WORDS =
  /\bruleset\b|\bas of\b|\bhash\b|coverage unavailable|source-backed|\breleased\b|known coverage gaps|official routes|question assessed/i;

// CMP-002's acceptance: "no output states that the business is legally exempt or fully compliant
// merely because a questionnaire did not trigger a rule."
// RUL-006's acceptance: "coverage gaps and excluded high-risk sectors are visible".
test("a check that no published rule covers says so in plain words, says it is not an exemption, and shows what Valo does not cover", async () => {
  const { respond } = checking();
  const { page, errors, close } = await app.desktop("/checker", respond);
  try {
    await ready(page);
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    const result = page.getByTestId("assessment-result");
    await result.waitFor();
    // What the result was worked out from, in words.
    await expect(page.getByTestId("result-basis").locator("span")).toHaveText([
      "Rules as at 18 Nov 2026",
      "Rules version synthetic-ruleset",
      "0 results with a source",
      "Reference cccccccccccc",
    ]);
    // Nothing matched: said plainly, and never as a finding that nothing applies.
    const nothing = page.getByTestId("status-coverage-unavailable");
    await expect(nothing).toContainText("No published rule covers these answers yet.");
    await expect(nothing).toContainText("This does not mean that you are exempt from anything.");
    // What is not covered is still shown.
    await expect(result).toContainText("What Valo does not cover yet");
    await expect(result).toContainText("Synthetic coverage gap.");
    // The fixture's own name for its rules is left out: it happens to hold one of the old words.
    const shown = (await result.innerText()).replace(/\s+/g, " ").replace(noResult.rulesetVersion, "");
    assert.doesNotMatch(shown, OLD_RESULT_WORDS);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The other checks of the result answer the check with a result of their own making, so the rules
// engine's own sentences were never on the screen for them. This one answers with what the engine
// itself works out from the answers the page sent, with no rule published: what a visitor gets today.
test("a result worked out by the rules engine itself, with no rule published, says its notice and what it does not cover in the site's words", async () => {
  const worked: ReturnType<typeof assess>[] = [];
  const { page, errors, close } = await app.phone("/checker", async (route, method, path, query) => {
    if (method === "POST" && path === "/checker/preview") {
      const { facts } = route.request().postDataJSON() as { facts: unknown };
      const result = assess(
        checkerFactsSchema.parse(facts),
        [],
        "2026-11-18",
        new Date("2026-11-18T09:00:00Z"),
      );
      worked.push(result);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(api.PreviewAssessmentResponse.parse(result)),
      });
    }
    if (method === "GET" && path === "/public/recommendations")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(noAids) });
    return answer(route, method, path, query);
  });
  try {
    await ready(page);
    // One answer, so that the result can name a place.
    await page.getByTestId("button-step-2").click();
    await page.getByTestId("select-state").selectOption("Lagos");
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    const result = page.getByTestId("assessment-result");
    await result.waitFor();
    assert.equal(worked.length, 1);
    // What the engine said, in its own words.
    assert.match(worked[0]!.notice, /source-governed/);
    assert.equal(worked[0]!.gaps.length, 3);
    // What the visitor reads. The rules' version is quoted by its first twelve characters, as the
    // result's reference is: the engine names a set of rules by a code of 64.
    await expect(page.getByTestId("result-basis").locator("span")).toHaveText([
      "Rules as at 18 Nov 2026",
      /^Rules version [0-9a-f]{12}$/,
      "0 results with a source",
      /^Reference [0-9a-f]{12}$/,
    ]);
    await expect(page.getByTestId("result-basis").locator("span").nth(1)).toHaveAttribute(
      "title",
      worked[0]!.rulesetVersion,
    );
    await expect(result).toContainText("Read this first");
    await expect(result).toContainText(
      "This is guidance that depends on your answers. It is not a legal certificate. A missing or unknown answer never means that you are exempt.",
    );
    const nothing = page.getByTestId("status-coverage-unavailable");
    await expect(nothing).toContainText("No published rule covers these answers yet.");
    await expect(nothing).toContainText("This does not mean that you are exempt from anything.");
    // The list does not say again that nothing was found.
    await expect(result.locator("li.border-l-2")).toHaveText([
      "Valo does not cover every state, the FCT and every local government area. Check what applies in Lagos with the authorities there.",
      "Healthcare, financial services and energy are covered only where a published rule is about that activity.",
    ]);
    const shown = (await result.innerText()).replace(/\s+/g, " ");
    assert.doesNotMatch(
      shown,
      /source-governed|released|eligible|not comprehensive|high-impact|establish exemption|\bLGA\b/i,
    );
    assert.deepEqual(oldWordsIn(shown), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "a result the engine worked out"), []);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// docs/architecture/results.md, slice 3. CMP-003: an unknown area "never receives invented local
// obligations". RUL-006: "coverage gaps and excluded high-risk sectors are visible".
test("a result the engine works out from answers that name a local government area and industries says Valo has not checked them, in the site's words, and still names the excluded sectors", async () => {
  const worked: ReturnType<typeof assess>[] = [];
  const { page, errors, close } = await app.phone("/checker", async (route, method, path, query) => {
    if (method === "POST" && path === "/checker/preview") {
      const { facts } = route.request().postDataJSON() as { facts: unknown };
      const result = assess(
        checkerFactsSchema.parse(facts),
        [],
        "2026-11-18",
        new Date("2026-11-18T09:00:00Z"),
      );
      worked.push(result);
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(api.PreviewAssessmentResponse.parse(result)),
      });
    }
    if (method === "GET" && path === "/public/recommendations")
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(noAids) });
    return answer(route, method, path, query);
  });
  try {
    await ready(page);
    await page.getByTestId("button-step-1").click();
    await choose(page, "check-activities-retail/wholesale");
    await choose(page, "check-activities-healthcare");
    await page.getByTestId("button-step-2").click();
    await page.getByTestId("select-state").selectOption("Lagos");
    await page.getByTestId("input-lga").fill("Ikeja");
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    const result = page.getByTestId("assessment-result");
    await result.waitFor();
    assert.equal(worked.length, 1);
    await expect(result.locator("li.border-l-2")).toHaveText([
      "Valo does not cover every state, the FCT and every local government area. Check what applies in Lagos with the authorities there.",
      "Valo has not checked the local government's own requirements for Ikeja.",
      "Valo has not checked requirements specific to retail/wholesale.",
      "Valo has not checked requirements specific to healthcare.",
      "Healthcare, financial services and energy are covered only where a published rule is about that activity.",
    ]);
    const shown = (await result.innerText()).replace(/\s+/g, " ");
    assert.doesNotMatch(
      shown,
      /source-governed|released|eligible|not comprehensive|high-impact|establish exemption|\bLGA\b/i,
    );
    assert.deepEqual(oldWordsIn(shown), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "what a result has not checked"), []);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The list under a result is the same for everyone. The checks of the result answer it with nothing,
// so neither the list nor its failure was ever on the screen for them.
test("under a result, business documents are offered as optional, in words that say they are not advice and not chosen from the answers; when the list cannot be loaded the visitor is told the results are not affected and can try again", async () => {
  const offered = api.ListOperationalRecommendationsResponse.parse({
    items: [
      {
        id: "synthetic-document-1",
        slug: "synthetic-invoice",
        title: "Synthetic invoice",
        type: "template",
        summary: "Synthetic test fixture: what the document is for.",
        industry: "retail-wholesale",
      },
    ],
    total: 1,
    page: 1,
    heldTemplates: 0,
  });
  let failing = true;
  const { respond } = checking();
  const { page, errors, close } = await app.phone("/checker", async (route, method, path, query) => {
    if (method === "GET" && path === "/public/recommendations")
      return route.fulfill(
        failing
          ? { status: 500, contentType: "application/json", body: '{"error":"Synthetic failure"}' }
          : { status: 200, contentType: "application/json", body: JSON.stringify(offered) },
      );
    return respond(route, method, path, query);
  });
  try {
    await ready(page);
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    // The list could not be loaded: what happened, what it does not change, and a way on.
    const failed = page.getByTestId("status-operational-aids-error");
    await expect(failed.locator("p")).toHaveText(
      "A list of optional business documents could not be loaded. Your results above are not affected.",
    );
    await expect(failed).toHaveAttribute("role", "status");
    const again = page.getByTestId("button-retry-operational-aids");
    await expect(again).toHaveText("Try again");
    assert.deepEqual(oldWordsIn(await failed.innerText()), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "the list that could not be loaded"), []);
    await page.setViewportSize({ width: 360, height: 640 });

    failing = false;
    await again.click();
    const list = page.getByTestId("section-operational-aids");
    await list.waitFor();
    await expect(failed).toHaveCount(0);
    await expect(list.locator(".eyebrow")).toHaveText("Optional");
    await expect(list.getByRole("heading", { name: "Business documents you may find useful" })).toBeVisible();
    await expect(list).toContainText(
      "These are general business templates, shown the same way to everyone. They are not legal advice, are not chosen from your answers, and do not mean any duty applies to you.",
    );
    const link = page.getByTestId("link-aid-synthetic-invoice");
    await expect(link).toContainText("Synthetic invoice");
    await expect(link).toHaveAttribute("href", "/library/synthetic-invoice");
    assert.deepEqual(oldWordsIn(await list.innerText()), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "the optional documents"), []);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// RUL-006 (docs/architecture/results.md): a requirement lists the released documents its rule relates, and
// the likely relevant requirements' documents are listed together. A related document that is not
// released is never named.
test("under each requirement are the released documents its rule relates, and the likely relevant requirements' documents are listed together as recommended documents; a document that is not released is not named, and when the documents cannot be loaded the visitor is told the results are not affected and can try again", async () => {
  const privacyNotice = {
    id: "synthetic-privacy-notice",
    slug: "synthetic-privacy-notice",
    title: "Synthetic privacy notice",
    type: "template",
    summary: "Synthetic test fixture: what the privacy notice is for.",
    industry: "All industries",
    templateId: "synthetic-privacy-notice",
    templateNumber: "TPL-29",
    access: "premium",
  };
  // TPL-30 is related too, but it is held, so the released list does not have it.
  const relating = api.PreviewAssessmentResponse.parse({
    ...noResult,
    items: [
      {
        ruleId: "SYN-PRIVACY",
        ruleVersion: 1,
        requirementVersionId: "SYN-PRIVACY@1",
        title: "Synthetic rule about personal data",
        label: "Likely relevant",
        reason: "Synthetic test fixture: why this may apply.",
        missingFacts: [],
        matchedFacts: [],
        nextStep: "Synthetic test fixture: what to do next.",
        jurisdiction: { level: "federal" },
        sources: [
          {
            id: "synthetic-source",
            url: "https://example.test/source",
            title: "Synthetic source",
            locator: "section 1",
            quote: "Synthetic quoted passage.",
            snapshotHash: "a".repeat(64),
          },
        ],
        relatedTemplateIds: ["TPL-29", "TPL-30"],
      },
    ],
    recommendedTemplateIds: ["TPL-29", "TPL-30"],
    sourceBackedRecommendations: 1,
  });
  const releasedList = api.ListPublicCatalogueResponse.parse({
    items: [privacyNotice],
    total: 1,
    page: 1,
    heldTemplates: 0,
  });
  let failing = true;
  const asked: string[] = [];
  const { respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", async (route, method, path, query) => {
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "POST" && path === "/checker/preview") return json(200, relating);
    if (method === "GET" && path === "/public/catalogue" && query.has("templateIds")) {
      asked.push(query.get("templateIds")!);
      return failing ? json(500, { error: "Synthetic failure" }) : json(200, releasedList);
    }
    return respond(route, method, path, query);
  });
  try {
    await ready(page);
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    // The documents could not be loaded: what happened, what it does not change, and a way on. The
    // requirement itself is still shown.
    const failed = page.getByTestId("status-result-documents-error");
    await expect(failed.locator("p")).toHaveText(
      "The documents for these requirements could not be loaded. Your results above are not affected.",
    );
    await expect(failed).toHaveAttribute("role", "status");
    await expect(page.getByTestId("card-item-SYN-PRIVACY")).toBeVisible();
    await expect(page.getByTestId("section-recommended-documents")).toHaveCount(0);
    assert.deepEqual(oldWordsIn(await failed.innerText()), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "the documents that could not be loaded"), []);
    await page.setViewportSize({ width: 360, height: 640 });

    failing = false;
    await page.getByTestId("button-retry-result-documents").click();
    const documents = page.getByTestId("documents-SYN-PRIVACY");
    await documents.waitFor();
    await expect(failed).toHaveCount(0);
    await expect(documents.locator("p")).toHaveText("Documents for this requirement");
    const link = page.getByTestId("link-document-SYN-PRIVACY-synthetic-privacy-notice");
    await expect(link).toHaveText("Synthetic privacy notice");
    await expect(link).toHaveAttribute("href", "/library/synthetic-privacy-notice");
    await expect(documents.locator("li")).toHaveText("Synthetic privacy notice · Premium");
    const recommended = page.getByTestId("section-recommended-documents");
    await expect(recommended.getByRole("heading", { name: "Recommended documents" })).toBeVisible();
    await expect(recommended).toContainText(
      "These are the documents for the requirements above that are likely relevant. Using one does not by itself meet a requirement.",
    );
    await expect(page.getByTestId("link-recommended-synthetic-privacy-notice")).toHaveAttribute(
      "href",
      "/library/synthetic-privacy-notice",
    );
    // The page asked the released list for the result's documents by their numbers alone, and names no
    // held one.
    assert.ok(asked.length >= 2, JSON.stringify(asked));
    assert.deepEqual([...new Set(asked)], ["TPL-29,TPL-30"]);
    await expect(page.getByTestId("assessment-result")).not.toContainText("TPL-30");
    assert.deepEqual(oldWordsIn(await recommended.innerText()), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "the documents for the requirements"), []);
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// docs/architecture/results.md, slice 2. CMP-006: a figure is shown only from its rule's source, and
// "Confirm with the authority" otherwise. CMP-007: each requirement names its authority's official page.
test("a requirement names its authority's official page and shows each figure its rule records with the passage it rests on, says 'Confirm with the authority' for the rest, and the result's official sources are those pages", async () => {
  const source = {
    id: "synthetic-source",
    url: "https://example.test/source",
    title: "Synthetic Act",
    locator: "section 5",
    quote: "Synthetic fee of one naira for each synthetic filing.",
    snapshotHash: "a".repeat(64),
  };
  const requirement = (ruleId: string, label: string, extra: object) => ({
    ruleId,
    ruleVersion: 1,
    requirementVersionId: `${ruleId}@1`,
    title: `Synthetic requirement ${ruleId}`,
    label,
    reason: "Synthetic test fixture: why this may apply.",
    missingFacts: [],
    matchedFacts: [],
    nextStep: "Synthetic test fixture: what to do next.",
    jurisdiction: { level: "federal" },
    sources: [source],
    relatedTemplateIds: [],
    ...extra,
  });
  const route = { authority: "Synthetic authority", url: "https://example.test/authority" };
  const routed = api.PreviewAssessmentResponse.parse({
    ...noResult,
    items: [
      requirement("SYN-ROUTED", "Likely relevant", {
        officialRoute: route,
        figures: [{ kind: "fee", words: "Synthetic fee of one naira", sourceId: "synthetic-source" }],
      }),
      requirement("SYN-PLAIN", "May apply", {}),
    ],
    officialRoutes: [{ title: route.authority, url: route.url }],
    sourceBackedRecommendations: 1,
  });
  const { respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", async (route_, method, path, query) =>
    method === "POST" && path === "/checker/preview"
      ? route_.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(routed) })
      : respond(route_, method, path, query),
  );
  try {
    await ready(page);
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    const link = page.getByTestId("route-SYN-ROUTED").getByRole("link", { name: "Synthetic authority" });
    await expect(page.getByTestId("route-SYN-ROUTED")).toHaveText("Official page: Synthetic authority");
    await expect(link).toHaveAttribute("href", route.url);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(page.getByTestId("figures-SYN-ROUTED").locator("li")).toHaveText([
      "Government fee: Synthetic fee of one naira (Synthetic Act, section 5)",
      "Deadlines: Confirm with the authority.",
    ]);
    await expect(page.getByTestId("route-SYN-PLAIN")).toHaveCount(0);
    await expect(page.getByTestId("figures-SYN-PLAIN").locator("li")).toHaveText([
      "Fees and deadlines: Confirm with the authority.",
    ]);
    // The result's official sources are the pages it was given.
    await expect(
      page.getByTestId("assessment-result").getByRole("link", { name: "Synthetic authority" }),
    ).toHaveCount(2);
    assert.deepEqual(oldWordsIn(await page.getByTestId("assessment-result").innerText()), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "a requirement's official page and figures"), []);
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// docs/architecture/results.md, slice 4. CMP-004: labels say "AI reviewed" or "Source checked";
// "professionally reviewed" appears only if that review occurred and was recorded.
test("each requirement's dates are shown under its rule, each with its own label, and no professional review is claimed", async () => {
  const requirement = (ruleId: string, publication: object) => ({
    ruleId,
    ruleVersion: 1,
    requirementVersionId: `${ruleId}@1`,
    title: `Synthetic requirement ${ruleId}`,
    label: "Likely relevant",
    reason: "Synthetic test fixture: why this may apply.",
    missingFacts: [],
    matchedFacts: [],
    nextStep: "Synthetic test fixture: what to do next.",
    jurisdiction: { level: "federal" },
    sources: [
      {
        id: "synthetic-source",
        url: "https://example.test/source",
        title: "Synthetic Act",
        locator: "section 5",
        quote: "Synthetic quoted passage.",
        snapshotHash: "a".repeat(64),
      },
    ],
    relatedTemplateIds: [],
    sourceCheckedAt: "2026-11-01T09:00:00.000Z",
    publication,
  });
  const dated = api.PreviewAssessmentResponse.parse({
    ...noResult,
    items: [
      requirement("SYN-SIGNED", { route: "owner_signoff", publishedAt: "2026-11-12T10:00:00.000Z" }),
      requirement("SYN-REVIEWED", { route: "editorial_release", publishedAt: "2026-11-13T10:00:00.000Z" }),
    ],
    sourceBackedRecommendations: 2,
  });
  const { respond } = checking();
  const { page, unknown, errors, close } = await app.phone("/checker", async (route, method, path, query) =>
    method === "POST" && path === "/checker/preview"
      ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(dated) })
      : respond(route, method, path, query),
  );
  try {
    await ready(page);
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    const result = page.getByTestId("assessment-result");
    await result.waitFor();
    await expect(page.getByTestId("dates-SYN-SIGNED")).toHaveText(
      "Source checked on 1 Nov 2026 · Signed off by the Valo development owner and published on 12 Nov 2026",
    );
    await expect(page.getByTestId("dates-SYN-REVIEWED")).toHaveText(
      "Source checked on 1 Nov 2026 · AI reviewed, and published on 13 Nov 2026",
    );
    assert.doesNotMatch(await result.innerText(), /professional/i);
    assert.deepEqual(oldWordsIn(await result.innerText()), []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "a requirement's dates"), []);
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// The banner is on every page. The sign-in pages draw no site frame and have a line of their own.
test("a visitor is told to use made-up details, on a page's banner and on the sign-in pages, and the sign-in service is named in the words the contact page uses", async () => {
  {
    const { page, errors, close } = await app.desktop("/checker", answer);
    try {
      await ready(page);
      const banner = page.getByTestId("text-dev-banner");
      await expect(banner).toContainText(
        "Not launched. Use made-up details only — no real customer or confidential data.",
      );
      await expect(banner.getByRole("link", { name: "Developer notes" })).toBeVisible();
      assert.doesNotMatch(await banner.innerText(), /synthetic/i);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  }
  for (const path of ["/sign-in", "/sign-up"]) {
    const { page, errors, close } = await app.desktop(path, answer);
    try {
      await page.getByTestId("link-auth-access-help").waitFor();
      const panel = page.locator("aside");
      await expect(panel).toContainText(
        "Signing in, confirming your email address and recovering your account are handled by our sign-in provider. Valo never sees your password.",
      );
      await expect(panel).toContainText("Development build. Use made-up details only.");
      assert.doesNotMatch(await panel.innerText(), /authentication provider|synthetic/i, path);
      assert.deepEqual(errors, [], path);
    } finally {
      await close();
    }
  }
});

// The redesign's word list (docs/architecture/frontend-redesign.md, "Words").
test("no signed-out screen shows one of the project's own words that the word list replaced", async () => {
  const problems: string[] = [];
  for (const screen of SCREENS) {
    const { page, close } = await app.desktop(screen.path, answer);
    try {
      await page
        .locator(screen.ready ?? "main h1")
        .first()
        .waitFor();
      for (const found of oldWordsIn((await page.evaluate("document.body.innerText")) as string))
        problems.push(`${screen.path}: ${found}`);
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

test("someone who cannot sign in is told before writing that no reply is emailed yet, and the saved message says what has not happened", async () => {
  const sent: unknown[] = [];
  const { page, errors, unknown, close } = await app.desktop(
    "/account-access",
    async (route, method, path, query) => {
      if (method === "POST" && path === "/public/access-support") {
        sent.push(route.request().postDataJSON());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(
            api.RequestAccessSupportResponse.parse({
              reference: "VALO-ACCESS-SYNTHETIC-1",
              message: "Synthetic test fixture: a note in the server's own words.",
              delivery: "not_dispatched",
            }),
          ),
        });
      } else await answer(route, method, path, query);
    },
  );
  try {
    await ready(page);
    // Before anything is written.
    await expect(page.getByTestId("text-access-limits")).toHaveText(
      "A member of Valo's staff reads your message. Valo does not send replies by email yet, and no time for a reply is promised.",
    );
    await page.getByTestId("input-access-email").fill("synthetic-visitor@example.test");
    await page.getByTestId("input-access-message").fill("Synthetic message: I cannot sign in to my account.");
    await page.getByTestId("button-access-submit").click();
    const saved = page.getByTestId("access-support-ack");
    await expect(saved).toContainText("Saved. Not emailed.");
    await expect(saved).toContainText(
      "Your message is saved for a member of Valo's staff to read. Nothing about your account has been checked or confirmed.",
    );
    await expect(saved).toContainText(
      "No email has been sent to you or to anyone else. Valo does not send replies by email yet, and no time for a reply is promised. Keep the reference if you write again.",
    );
    await expect(page.getByTestId("text-access-reference")).toHaveText("VALO-ACCESS-SYNTHETIC-1");
    await expect(saved).toContainText("None sent");
    assert.doesNotMatch(
      (await saved.innerText()).replace(/\s+/g, " "),
      /dispatch|development build|server's own words/i,
    );
    assert.equal(sent.length, 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// WRK-004: "Separate necessary account/purchase messages from optional reminders and marketing. Accept:
// unsubscribe and preference changes are enforced before dispatch, not just when the job was created."
// The page a reminder's unsubscribe link opens. What the API then does is its own tests' to show.
test("the unsubscribe page stops nothing when it is opened, asks once when its button is pressed and says what was stopped; a link that does not work is said to in the server's words, and a link with no token offers no button", async () => {
  const token = "synthetic.unsubscribe.token";
  const asked: unknown[] = [];
  const answering =
    (reply: { status: number; body: unknown }): Api =>
    async (route, method, path, query) => {
      if (method === "POST" && path === "/public/unsubscribe") {
        asked.push(route.request().postDataJSON());
        await route.fulfill({
          status: reply.status,
          contentType: "application/json",
          body: JSON.stringify(reply.body),
        });
      } else await answer(route, method, path, query);
    };
  const reminders = (page: Page) => page.getByTestId("link-unsubscribe-reminders");
  {
    const { page, errors, unknown, close } = await app.phone(
      "/unsubscribe?t=" + token,
      answering({ status: 200, body: api.UnsubscribeResponse.parse({ consent: "reminders", state: "off" }) }),
    );
    try {
      await ready(page);
      await expect(page.locator("main h1")).toHaveText("Stop reminder emails");
      await expect(page.locator("main")).toContainText(
        "Press the button to stop Valo's reminder emails for the workspace this link came from. Nothing changes until you do.",
      );
      await expect(page.getByTestId("text-unsubscribe-effect")).toHaveText(
        "Reminders that are waiting will be cancelled. Your tasks and their due dates stay as they are, and you do not need to sign in.",
      );
      await expect(reminders(page)).toHaveAttribute("href", "/workspace/reminders");
      // Opening the page asked the API nothing: a mail program that follows the link stops no reminder.
      assert.deepEqual(asked, []);
      await page.getByTestId("button-unsubscribe").click();
      const done = page.getByTestId("unsubscribe-done");
      await expect(done).toContainText("Reminder emails are off");
      await expect(done).toContainText(
        "Valo will send no more reminder emails for the workspace this link came from. Any reminder that was waiting has been cancelled. Your tasks and their due dates are as they were.",
      );
      await expect(done).toContainText(
        "You can turn reminder emails off or on in Valo: sign in and open Reminders.",
      );
      // Asked once, with the token as the link gave it and nothing else.
      assert.deepEqual(asked, [{ token }]);
      await expect(page.getByTestId("button-unsubscribe")).toHaveCount(0);
      assert.doesNotMatch(
        (await page.locator("main").innerText()).replace(/\s+/g, " "),
        /unsubscrib|token|consent|opt.?out/i,
      );
      assert.deepEqual((await wcagFailures(page)).failures, []);
      assert.deepEqual(await phoneProblems(page, "reminder emails stopped"), []);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }
  // A link Valo does not honour: the page says so in the server's words, and nothing is called stopped.
  asked.length = 0;
  const refused =
    "This link does not work. It may be incomplete, or older than Valo still accepts. Nothing was changed.";
  {
    const { page, unknown, close } = await app.phone(
      "/unsubscribe?t=" + token,
      answering({ status: 400, body: { error: refused } }),
    );
    try {
      await ready(page);
      await page.getByTestId("button-unsubscribe").click();
      await expect(page.getByTestId("text-unsubscribe-error")).toHaveText(refused);
      await expect(page.getByTestId("unsubscribe-done")).toHaveCount(0);
      // The way to do it in Valo is still offered, and the button is still there.
      await expect(reminders(page)).toHaveAttribute("href", "/workspace/reminders");
      await expect(page.getByTestId("button-unsubscribe")).toBeEnabled();
      assert.deepEqual(asked, [{ token }]);
      assert.deepEqual((await wcagFailures(page)).failures, []);
      assert.deepEqual(await phoneProblems(page, "a link that does not work"), []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }
  // No token in the address: nothing to press, and nothing asked.
  asked.length = 0;
  {
    const { page, errors, unknown, close } = await app.phone(
      "/unsubscribe",
      answering({ status: 500, body: { error: "Synthetic test fixture: never asked." } }),
    );
    try {
      await ready(page);
      await expect(page.locator("main")).toContainText(
        "This link is incomplete, so there is nothing here to stop.",
      );
      await expect(page.getByTestId("text-unsubscribe-incomplete")).toContainText(
        "Open the link from the reminder email again, in full.",
      );
      await expect(page.getByTestId("button-unsubscribe")).toHaveCount(0);
      await expect(reminders(page)).toHaveAttribute("href", "/workspace/reminders");
      assert.deepEqual(asked, []);
      assert.deepEqual((await wcagFailures(page)).failures, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }
});
