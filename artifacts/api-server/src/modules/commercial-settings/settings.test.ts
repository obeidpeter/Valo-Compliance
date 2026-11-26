import assert from "node:assert/strict";
import test from "node:test";
import { ValoProblem } from "../../platform/valo-problem";
import {
  COMMERCIAL_SETTINGS,
  COMMERCIAL_SETTING_KEYS,
  commercialSettingTerms,
  commercialSettingTermsId,
} from "./settings";

const base = { key: "drafting_workspace_daily", value: "12", from: "now" };

test("each setting is listed with its default, the constant the drafting assistant held, and its most", () => {
  assert.deepEqual(
    COMMERCIAL_SETTING_KEYS.map((key) => [
      key,
      COMMERCIAL_SETTINGS[key].defaultValue,
      COMMERCIAL_SETTINGS[key].max,
    ]),
    [
      ["drafting_workspace_daily", 30, 300],
      ["drafting_daily_in_all", 120, 1200],
    ],
  );
});

test("a value's terms are a listed setting, a whole number up to the setting's most, and a start", () => {
  assert.deepEqual(commercialSettingTerms({ ...base, value: " 12 ", from: undefined }), {
    key: "drafting_workspace_daily",
    value: 12,
    from: "now",
  });
  assert.deepEqual(
    commercialSettingTerms({ key: "drafting_daily_in_all", value: "0", from: "2026-12-01T00:00:00+01:00" }),
    { key: "drafting_daily_in_all", value: 0, from: "2026-12-01T00:00:00+01:00" },
  );
  assert.equal(commercialSettingTerms({ ...base, value: "300" }).value, 300);
  for (const [change, message] of [
    [{ key: "synthetic_unknown_setting" }, /Choose one of the settings listed/],
    [{ key: undefined }, /Choose one of the settings listed/],
    [{ value: "12.5" }, /drafts a day as a whole number, such as 30/],
    [{ value: "-1" }, /as a whole number/],
    [{ value: "1e3" }, /as a whole number/],
    [{ value: "" }, /as a whole number/],
    [{ value: "301" }, /is at most 300 drafts a day/],
    [{ key: "drafting_daily_in_all", value: "1201" }, /is at most 1200 drafts a day/],
    [{ from: "tomorrow" }, /Give the start as now/],
    [{ from: "2026-12-01T00:00:00" }, /Give the start as now/],
  ] as const)
    assert.throws(
      () => commercialSettingTerms({ ...base, ...change }),
      (error: unknown) => error instanceof ValoProblem && error.status === 422 && message.test(error.message),
      JSON.stringify(change),
    );
});

test("the checksum changes with each term, and with nothing else", () => {
  const id = commercialSettingTermsId(commercialSettingTerms(base));
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(commercialSettingTermsId(commercialSettingTerms({ ...base, value: " 12" })), id);
  for (const change of [
    { key: "drafting_daily_in_all" },
    { value: "13" },
    { from: "2026-12-01T00:00:00+01:00" },
  ])
    assert.notEqual(commercialSettingTermsId(commercialSettingTerms({ ...base, ...change })), id);
});
