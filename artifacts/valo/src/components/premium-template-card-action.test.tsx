import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PremiumTemplateCardAction } from "./premium-template-card-action";

test("a premium card uses exact edition ownership independently of its current checkout offer", () => {
  const edition = "00000000-0000-4000-8000-000000000001";
  const otherEdition = "00000000-0000-4000-8000-000000000002";
  const priceId = "00000000-0000-4000-8000-000000000003";
  const file = "/api/workspace/manual-premium-templates/" + edition + "/download";
  const card = { id: edition, title: "Synthetic agreement", premiumDownloadPath: file };
  const action = (editions: string[], forSale: boolean) =>
    renderToStaticMarkup(
      <PremiumTemplateCardAction item={forSale ? { ...card, priceId } : card} owned={new Set(editions)} />,
    );
  for (const forSale of [true, false]) {
    const owned = action([edition], forSale);
    assert.ok(owned.includes('href="' + file + '"'));
    assert.ok(!owned.includes("card-checkout"));
  }
  for (const editions of [[], [otherEdition], [priceId]]) {
    const unowned = action(editions, true);
    assert.ok(unowned.includes('href="/workspace/purchases?offer=' + priceId + '"'));
    assert.ok(!unowned.includes("card-download"));
    assert.equal(action(editions, false), "");
  }
});
