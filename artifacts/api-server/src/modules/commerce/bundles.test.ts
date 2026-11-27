import assert from "node:assert/strict";
import test from "node:test";
import { bundleTerms, bundleTermsId } from "./bundles";

// ADM-006 (docs/architecture/commercial-settings.md, slice 4b): a bundle's terms are checked before anything is
// read or written, and the checksum the owner confirms is of exactly those terms.
const licence = "Synthetic licence text for one business's own use.";
const first = "00000000-0000-4000-8000-00000000d001",
  second = "00000000-0000-4000-8000-00000000d002",
  third = "00000000-0000-4000-8000-00000000d003";
const base = {
  bundle: "synthetic-starter",
  title: "Synthetic starter bundle",
  items: [second, first] as string[],
  amount: "4000.00",
  licenceVersion: "bundle-1",
  licenceText: licence,
  taxTreatment: "Synthetic tax treatment",
  from: "now",
};

test("a bundle's terms are checked before anything is read or written", () => {
  // The templates are kept in one order, whatever order they were chosen in.
  assert.deepEqual(bundleTerms(base), {
    bundle: "synthetic-starter",
    title: "Synthetic starter bundle",
    items: [first, second],
    amountKobo: 400000,
    licenceVersion: "bundle-1",
    licenceText: licence,
    taxTreatment: "Synthetic tax treatment",
    from: "now",
  });
  assert.equal(bundleTerms({ ...base, from: undefined }).from, "now");
  assert.equal(
    bundleTerms({ ...base, title: "  Synthetic starter bundle " }).title,
    "Synthetic starter bundle",
  );
  assert.equal(bundleTerms({ ...base, licenceText: `\n${licence}\n` }).licenceText, licence);
  assert.equal(bundleTerms({ ...base, from: "2026-12-01T00:00:00+01:00" }).from, "2026-12-01T00:00:00+01:00");
  const ten = Array.from(
    { length: 10 },
    (_, n) => `00000000-0000-4000-8000-0000000${String(n).padStart(5, "0")}`,
  );
  assert.equal(bundleTerms({ ...base, items: ten }).items.length, 10);
  const refused: [Record<string, unknown>, RegExp][] = [
    [{ bundle: "Synthetic Starter" }, /lower-case letters/],
    [{ bundle: "-starter" }, /lower-case letters/],
    [{ bundle: "s" }, /lower-case letters/],
    [{ bundle: undefined }, /lower-case letters/],
    [{ title: "AB" }, /title on one line/],
    [{ title: "Synthetic\nbundle" }, /title on one line/],
    // A bundle holds two to ten templates, each once, each named by its library item.
    [{ items: [first] }, /2 to 10 templates/],
    [{ items: [...ten, third] }, /2 to 10 templates/],
    [{ items: undefined }, /2 to 10 templates/],
    [{ items: [first, first] }, /each template once/],
    [{ items: [first, "TPL-13"] }, /premium templates from the staff library/],
    [{ licenceVersion: "bundle 1" }, /licence version/],
    [{ licenceText: "Too short." }, /licence text/],
    [{ taxTreatment: "VAT\ninclusive" }, /tax treatment/],
    [{ from: "tomorrow" }, /start/],
    // A time without its offset could be read in two ways.
    [{ from: "2026-12-01T00:00:00" }, /start/],
    [{ amount: "4,000" }, /naira/],
    [{ amount: "0" }, /₦0/],
  ];
  for (const [change, message] of refused)
    assert.throws(
      () => bundleTerms({ ...base, ...change } as Parameters<typeof bundleTerms>[0]),
      message,
      JSON.stringify(change),
    );
});

test("the checksum the owner confirms changes with every figure, word and template of a bundle's terms", () => {
  const id = bundleTermsId(bundleTerms(base));
  assert.match(id, /^[0-9a-f]{64}$/);
  // The same templates chosen in another order are the same terms.
  assert.equal(bundleTermsId(bundleTerms({ ...base, items: [first, second] })), id);
  for (const change of [
    { bundle: "synthetic-other" },
    { title: "Synthetic other bundle" },
    { items: [first, third] },
    { items: [first, second, third] },
    { amount: "4000.01" },
    { licenceVersion: "bundle-2" },
    { licenceText: `${licence} More.` },
    { taxTreatment: "Other synthetic treatment" },
    { from: "2026-12-01T00:00:00+01:00" },
  ])
    assert.notEqual(bundleTermsId(bundleTerms({ ...base, ...change })), id, JSON.stringify(change));
});
