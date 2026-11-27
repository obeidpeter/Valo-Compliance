import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { expect, type Locator, type Page } from "@playwright/test";
import { serverAnswer } from "../test-support/public-answers";
import { startWebServer } from "../test-support/web-server";

/**
 * WEB-001: "The homepage and primary navigation must give documents and compliance guidance
 * comparable visibility", accepted with "both journeys are reachable within one deliberate action
 * from the hero and mobile menu."
 *
 * The home page as the compiled web server renders it (decision 0011), on an emulated phone, for a
 * signed-out visitor, the person the hero is for: the identity provider cannot load in a test, so
 * the page keeps the signed-out links it was rendered with. The API is answered by synthetic data
 * the contract's schema accepts.
 */
let web: Awaited<ReturnType<typeof startWebServer>>;
before(async () => {
  web = await startWebServer(serverAnswer);
});
after(() => web.close());

/** The title of each page a journey opens. */
const TITLES: Record<string, string> = {
  "/sign-up": "Create account — Valo",
  "/checker": "Check your requirements — Valo",
  "/library": "Documents and guidance — Valo",
};

/** Opens the home page on a fresh emulated phone and runs the checks, then fails on any page error. */
async function onPhoneHome(checks: (page: Page) => Promise<void>) {
  const { page, errors, unknown, close } = await web.phone("/");
  try {
    await expect(page.getByTestId("text-headline")).toBeVisible();
    await checks(page);
  } finally {
    await close();
  }
  assert.deepEqual(errors, [], "the page reported no error");
  assert.deepEqual(unknown, [], "every API call the page made has a test answer");
}

/** One tap on the link opens the page at this address, which is titled for its path. */
async function tapOpens(page: Page, link: Locator, address: string) {
  await link.tap();
  await expect(page).toHaveURL(web.origin + address);
  await expect(page).toHaveTitle(TITLES[address.split("?")[0]!]!);
}

test("on a phone, the home page's hero links to both journeys, and one tap on either opens it", () =>
  onPhoneHome(async (page) => {
    const documents = page.getByTestId("link-hero-documents");
    const compliance = page.getByTestId("link-hero-compliance");
    await expect(documents).toHaveText("Create a document");
    await expect(documents).toHaveAttribute("href", "/sign-up?start=document");
    await expect(compliance).toHaveText("Check my requirements");
    await expect(compliance).toHaveAttribute("href", "/checker");
    // The two buttons are the same size, one under the other with documents first, and nothing but
    // the headline and its opening sentence comes before them.
    const first = await documents.boundingBox(),
      second = await compliance.boundingBox();
    assert.ok(first && second, "both buttons are laid out");
    assert.deepEqual([second.width, second.height, second.x], [first.width, first.height, first.x]);
    assert.ok(first.y < second.y, "documents comes first");
    assert.equal(
      await page.evaluate(
        `[...document.querySelectorAll("main a")].slice(0, 2).map((a) => a.getAttribute("data-testid")).join()`,
      ),
      "link-hero-documents,link-hero-compliance",
      "the hero's two buttons are the page's first links",
    );
    // The page fits a 360-pixel-wide screen without scrolling sideways.
    assert.equal(await page.evaluate("document.documentElement.scrollWidth"), 360);

    await tapOpens(page, documents, "/sign-up?start=document");
    await page.goBack();
    await tapOpens(page, compliance, "/checker");
  }));

test("on a phone, the opened mobile menu and the bottom dock each link to both journeys, and one tap on any of them opens it", () =>
  onPhoneHome(async (page) => {
    // At phone width the header's own links are hidden, so the menu carries the navigation.
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
    const menu = page.getByRole("navigation", { name: "Mobile" });
    const openMenu = async () => {
      await page.getByRole("button", { name: "Open menu" }).tap();
      await expect(menu).toBeVisible();
    };
    await openMenu();
    // The menu's panel: its navigation, then the sign-in and account buttons.
    const panel = menu.locator("..");
    const menuLinks = [
      [panel.getByRole("link", { name: "Documents", exact: true }), "/library"],
      [panel.getByRole("link", { name: "Check requirements", exact: true }), "/checker"],
      [panel.getByRole("link", { name: "Create account", exact: true }), "/sign-up"],
    ] as const;
    for (const [link, path] of menuLinks) await expect(link).toHaveAttribute("href", path);
    for (const [link, path] of menuLinks) {
      await tapOpens(page, link, path);
      // Opening a page closes the menu, so the next journey starts from a closed menu.
      await expect(menu).toBeHidden();
      await page.goBack();
      await expect(page.getByTestId("text-headline")).toBeVisible();
      await openMenu();
    }

    // The dock stays on screen on every page, with one button for each journey.
    const documents = page.getByTestId("link-dock-documents");
    const compliance = page.getByTestId("link-dock-compliance");
    await expect(documents).toHaveText("Create a document");
    await expect(documents).toHaveAttribute("href", "/sign-up?start=document");
    await expect(compliance).toHaveText("Check requirements");
    await expect(compliance).toHaveAttribute("href", "/checker");
    await page.evaluate("window.scrollTo(0, document.body.scrollHeight)");
    await expect(documents).toBeInViewport();
    await expect(compliance).toBeInViewport();
    await tapOpens(page, compliance, "/checker");
    await page.goBack();
    await tapOpens(page, documents, "/sign-up?start=document");
  }));
