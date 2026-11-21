import { test } from "node:test";
import assert from "node:assert/strict";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { guidedFieldIssue } from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import { NOT_AN_AMOUNT, askedAs, saidAs, shownAmount, storedAmount } from "./guided-money";

const money = {
  id: "synthetic",
  label: "Synthetic amount in whole kobo",
  type: "money_kobo",
  required: true,
} as const;

// AI-003: "Preserve supplied names and amounts … using decimal-safe arithmetic."
test("an amount typed in naira is stored as the same amount in whole kobo, from its digits alone", () => {
  const typed: [string, string][] = [
    ["1500", "150000"],
    ["1500.5", "150050"],
    ["1500.50", "150050"],
    ["1,500.50", "150050"],
    [" 1 500 ", "150000"],
    ["0.05", "5"],
    ["0", "0"],
    ["00012", "1200"],
    ["12.", "1200"],
    // Larger than a number holds exactly: every digit is kept.
    ["9007199254740993.01", "900719925474099301"],
    ["9999999999999999999999.99", "999999999999999999999999"],
  ];
  for (const [text, kobo] of typed) {
    assert.equal(storedAmount(text), kobo, text);
    assert.equal(guidedFieldIssue(money, storedAmount(text)), null, text);
  }
  assert.equal(storedAmount(""), "");
  assert.equal(storedAmount("   "), "");
});

test("what is not an amount in naira is stored as typed and refused, never as some other amount", () => {
  for (const text of ["abc", "12.5x", "12.345", "-5", "1e3", "₦1500", "1.2.3", ".", "12,5.0.1"]) {
    assert.equal(storedAmount(text), text, text);
    assert.equal(saidAs(guidedFieldIssue(money, storedAmount(text))!), NOT_AN_AMOUNT, text);
  }
  // Digits too long for an amount in naira would read as kobo, a hundredth of what was typed.
  for (const text of ["12345678901234567890123", "123456789012345678901234"]) {
    const stored = storedAmount(text);
    assert.equal(stored, text + ".00");
    assert.equal(saidAs(guidedFieldIssue(money, stored)!), NOT_AN_AMOUNT, text);
    // Shown again and left alone, it is stored the same way: the box and the answer agree.
    assert.equal(storedAmount(shownAmount(stored)), stored);
  }
});

test("a stored amount is shown in naira and stores back to itself, and a stored answer that is not an amount is shown as it is", () => {
  for (const [kobo, naira] of [
    ["150000", "1500"],
    ["150050", "1500.50"],
    ["5", "0.05"],
    ["0", "0"],
    ["100", "1"],
    ["999999999999999999999999", "9999999999999999999999.99"],
  ] as const) {
    assert.equal(shownAmount(kobo), naira, kobo);
    assert.equal(storedAmount(shownAmount(kobo)), kobo, kobo);
  }
  for (const stored of ["", "abc", "12.5x", "007"]) assert.equal(shownAmount(stored), stored, stored);
});

test("every money question in the twelve kinds of document is asked in naira, and no other question's name changes", () => {
  let asked = 0;
  for (const id of GUIDED_TEMPLATE_IDS) {
    const spec = GUIDED_SPECS_V1[id];
    for (const field of [...spec.fields, ...spec.tables.flatMap((t) => t.columns)]) {
      const name = askedAs(field);
      if (field.type !== "money_kobo") {
        assert.equal(name, field.label, `${id} ${field.id}`);
        continue;
      }
      asked += 1;
      assert.doesNotMatch(name, /kobo/i, `${id} ${field.id}`);
      assert.match(name, /\bnaira\b/, `${id} ${field.id}`);
      assert.equal(name, field.label.replace("whole kobo", "naira"), `${id} ${field.id}`);
    }
  }
  assert.ok(asked >= 8, `${asked} money questions`);
  // Any other message of the questions' check is passed on as it is.
  assert.equal(saidAs("This answer is required."), "This answer is required.");
  assert.equal(
    saidAs("This acknowledged amount must be positive."),
    "This acknowledged amount must be positive.",
  );
});
