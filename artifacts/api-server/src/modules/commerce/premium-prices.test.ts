import assert from "node:assert/strict";
import test from "node:test";
import {
  PREMIUM_PRICE_LIMIT_KOBO,
  nairaToKobo,
  premiumPriceTerms,
  premiumPriceTermsId,
} from "./premium-prices";

const licence = "Synthetic licence text for one business's own use.";
const base = {
  edition: "00000000-0000-4000-8000-00000000b001",
  amount: "1500.00",
  licenceVersion: "premium-1",
  licenceText: licence,
  taxTreatment: "Synthetic tax treatment",
  from: "now",
};

test("an amount in naira is read exactly, in kobo, and anything else is refused", () => {
  assert.equal(nairaToKobo("1500"), 150000);
  assert.equal(nairaToKobo("1500.50"), 150050);
  assert.equal(nairaToKobo("0.01"), 1);
  assert.equal(nairaToKobo("10000000"), PREMIUM_PRICE_LIMIT_KOBO);
  for (const refused of [
    "",
    "0",
    "0.00",
    "1,500",
    "₦1500",
    "1500.5",
    "1500.505",
    "-1",
    "1e3",
    " 1500",
    "10000000.01",
    "100000000",
  ])
    assert.throws(() => nairaToKobo(refused), /naira|₦0/, refused);
});

test("a price's terms are checked before anything is read or written", () => {
  assert.deepEqual(premiumPriceTerms(base), {
    edition: base.edition,
    amountKobo: 150000,
    licenceVersion: "premium-1",
    licenceText: licence,
    taxTreatment: "Synthetic tax treatment",
    from: "now",
  });
  assert.equal(premiumPriceTerms({ ...base, from: undefined }).from, "now");
  assert.equal(premiumPriceTerms({ ...base, licenceText: `\n${licence}\n` }).licenceText, licence);
  assert.equal(
    premiumPriceTerms({ ...base, from: "2026-12-01T00:00:00+01:00" }).from,
    "2026-12-01T00:00:00+01:00",
  );
  const refused: [Partial<typeof base> | { [key: string]: undefined }, RegExp][] = [
    [{ edition: "TPL-13" }, /edition ID/],
    [{ edition: undefined }, /edition ID/],
    [{ licenceVersion: "premium 1" }, /licence version/],
    [{ licenceText: "Too short." }, /licence text/],
    [{ taxTreatment: "VAT\ninclusive" }, /tax treatment/],
    [{ taxTreatment: "" }, /tax treatment/],
    [{ from: "tomorrow" }, /start/],
    // A time without its offset could be read in two ways.
    [{ from: "2026-12-01T00:00:00" }, /start/],
    [{ amount: "1,500" }, /naira/],
  ];
  for (const [change, message] of refused)
    assert.throws(() => premiumPriceTerms({ ...base, ...change }), message, JSON.stringify(change));
});

test("the checksum the owner confirms changes with every figure and word of a price's terms", () => {
  const id = premiumPriceTermsId(premiumPriceTerms(base));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(premiumPriceTermsId(premiumPriceTerms(base)), id);
  for (const change of [
    { edition: "00000000-0000-4000-8000-00000000b002" },
    { amount: "1500.01" },
    { licenceVersion: "premium-2" },
    { licenceText: `${licence} More.` },
    { taxTreatment: "Other synthetic treatment" },
    { from: "2026-12-01T00:00:00+01:00" },
  ])
    assert.notEqual(
      premiumPriceTermsId(premiumPriceTerms({ ...base, ...change })),
      id,
      JSON.stringify(change),
    );
});
