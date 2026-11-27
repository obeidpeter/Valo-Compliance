import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { expect } from "@playwright/test";
import { ready } from "../test-support/app-in-browser";
import { serverAnswer } from "../test-support/public-answers";
import { startWebServer } from "../test-support/web-server";

/**
 * The web app's hand-written component classes (`btn`, `field`, `surface`, `pill`, `label`, `hint`
 * and the rest, in `artifacts/valo/src/index.css`) belong to Tailwind's components layer, so a
 * utility class on the same element wins over a component's default. Written outside a layer, as
 * they were, they beat every utility whatever its specificity: the phone menu button showed on a
 * desktop (`btn lg:hidden`), the library's search text ran under its icon (`field pl-11`), and an
 * error under a field kept a hint's grey (`hint text-destructive`). Checked in a browser against
 * the compiled web app. Build it first: pnpm --filter @workspace/valo run build.
 */
let web: Awaited<ReturnType<typeof startWebServer>>;
before(async () => {
  web = await startWebServer((method, url) => serverAnswer(method, url));
});
after(() => web.close());

/** Where each class rule of the page's stylesheets sits: its selectors outside any layer and in the
 * components layer, and the layers in their order. */
const STYLESHEET = `(() => {
  const unlayered = [], components = [], layers = [];
  const visit = (rules, layer) => {
    for (const rule of rules) {
      const kind = rule.constructor.name;
      if (kind === "CSSLayerStatementRule") layers.push(...rule.nameList);
      else if (kind === "CSSLayerBlockRule") { layers.push(rule.name); visit(rule.cssRules, rule.name); }
      else if (kind === "CSSStyleRule") {
        const selectors = rule.selectorText.split(",").map((s) => s.trim());
        if (layer === null) unlayered.push(...selectors);
        else if (layer === "components") components.push(...selectors);
      } else if (rule.cssRules) visit(rule.cssRules, layer);
    }
  };
  for (const sheet of document.styleSheets) visit(sheet.cssRules, null);
  return { unlayered, components, layers: [...new Set(layers)] };
})()`;

/** A rule that may stay outside the layers: the page's own, or an override of the identity provider's
 * card, which must beat that provider's styles. Every component class belongs in a layer. */
const OUTSIDE_A_LAYER = /^(:root|\.dark|html|body|body::?before|\.cl-\S+|\.valo-auth-panel \.cl-\S+)$/;

test("the stylesheet keeps the component classes in the components layer, before the utilities, and no class rule outside a layer", async () => {
  const { page, close } = await web.desktop("/");
  try {
    const sheet = (await page.evaluate(STYLESHEET)) as {
      unlayered: string[];
      components: string[];
      layers: string[];
    };
    assert.deepEqual(
      sheet.unlayered.filter((selector) => !OUTSIDE_A_LAYER.test(selector)),
      [],
      "a class written outside a layer beats every utility",
    );
    assert.ok(sheet.unlayered.includes("body"), "the check read the stylesheet's rules");
    for (const name of [".btn", ".btn-primary", ".field", ".surface", ".pill", ".label", ".hint", ".eyebrow"])
      assert.ok(sheet.components.includes(name), `${name} is in the components layer`);
    assert.ok(
      sheet.layers.includes("components") &&
        sheet.layers.indexOf("components") < sheet.layers.indexOf("utilities"),
      `the components layer comes before the utilities (${sheet.layers.join(", ")})`,
    );
  } finally {
    await close();
  }
});

test("on a desktop the header shows its links and no menu button; on a phone, the menu button and no links", async () => {
  const wide = await web.desktop("/");
  try {
    await ready(wide.page);
    await expect(wide.page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(wide.page.getByTestId("button-menu")).toBeHidden();
  } finally {
    await wide.close();
  }
  const narrow = await web.phone("/");
  try {
    await ready(narrow.page);
    await expect(narrow.page.getByTestId("button-menu")).toBeVisible();
    await expect(narrow.page.getByRole("navigation", { name: "Primary" })).toBeHidden();
  } finally {
    await narrow.close();
  }
});

test("the library's search text starts clear of the search icon, on a desktop and on a phone", async () => {
  for (const [kind, open] of [
    ["desktop", web.desktop],
    ["phone", web.phone],
  ] as const) {
    const { page, close } = await open("/library");
    try {
      await ready(page);
      // From the icon's right edge to where the field's text starts.
      const gap = (await page.evaluate(`(() => {
        const input = document.querySelector('[data-testid="input-search"]');
        const icon = input.parentElement.querySelector("svg").getBoundingClientRect();
        const style = getComputedStyle(input);
        return input.getBoundingClientRect().left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft) - icon.right;
      })()`)) as number;
      assert.ok(gap >= 8, `on a ${kind} the text starts ${gap} pixels after the icon`);
    } finally {
      await close();
    }
  }
});

test("an error under a field is shown in the error colour, not a hint's grey", async () => {
  const { page, close } = await web.phone("/account-access");
  try {
    await ready(page);
    const hint = page.locator("#as-email-hint");
    await expect(hint).toHaveText("Works even if you cannot sign in.");
    await page.getByTestId("button-access-submit").click();
    await expect(hint).toHaveText("Enter an email address we can reply to.");
    const colours = (await page.evaluate(`(() => {
      const probe = document.body.appendChild(document.createElement("span"));
      const shown = (colour) => ((probe.style.color = colour), getComputedStyle(probe).color);
      const seen = {
        hint: getComputedStyle(document.getElementById("as-email-hint")).color,
        error: shown("hsl(var(--destructive))"),
        grey: shown("hsl(var(--muted-foreground))"),
      };
      probe.remove();
      return seen;
    })()`)) as { hint: string; error: string; grey: string };
    assert.notEqual(colours.error, colours.grey, "the two colours differ, so the check can tell them apart");
    assert.equal(colours.hint, colours.error);
  } finally {
    await close();
  }
});
