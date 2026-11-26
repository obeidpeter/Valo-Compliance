import assert from "node:assert/strict";
import test from "node:test";
import { ValoProblem } from "../../platform/valo-problem";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import {
  COMMERCIAL_SETTINGS,
  COMMERCIAL_SETTING_KEYS,
  commercialSettingChoice,
  commercialSettingTerms,
  commercialSettingTermsId,
} from "./settings";

const base = { key: "drafting_workspace_daily", value: "12", from: "now" };

test("each setting is listed with its kind, its default, the rule the code held, and its most", () => {
  assert.deepEqual(
    COMMERCIAL_SETTING_KEYS.map((key) => {
      const setting = COMMERCIAL_SETTINGS[key];
      return [key, setting.kind, setting.defaultValue, setting.kind === "count" ? setting.max : null];
    }),
    [
      ["drafting_workspace_daily", "count", 30, 300],
      ["drafting_daily_in_all", "count", 120, 1200],
      ["purchase_carries_to_later_editions", "yes-no", true, null],
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
  // The access rule is yes or no.
  const rule = { key: "purchase_carries_to_later_editions", from: "now" };
  assert.deepEqual(commercialSettingTerms({ ...rule, value: "no" }), {
    key: "purchase_carries_to_later_editions",
    value: false,
    from: "now",
  });
  assert.equal(commercialSettingTerms({ ...rule, value: " yes " }).value, true);
  for (const value of ["1", "true", "Yes", ""])
    assert.throws(
      () => commercialSettingTerms({ ...rule, value }),
      (error: unknown) =>
        error instanceof ValoProblem && error.status === 422 && /yes or no/.test(error.message),
      value,
    );
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
  const rule = { key: "purchase_carries_to_later_editions", from: "now" };
  assert.notEqual(
    commercialSettingTermsId(commercialSettingTerms({ ...rule, value: "yes" })),
    commercialSettingTermsId(commercialSettingTerms({ ...rule, value: "no" })),
  );
});

// The access rule (slice 3b): its answer in effect, its default when the owner has recorded none, and a
// refusal when what the database holds is not a yes or a no. Read for an order, it takes the setting's lock
// shared before it reads, so the owner's next value waits for the order.
test("a yes-or-no setting reads its answer, or its default, and a held read takes the setting's lock first", async () => {
  const dialect = new PgDialect();
  const reader = (value: unknown) => {
    const statements: string[] = [];
    return {
      statements,
      tx: {
        execute: async (query: SQL) => {
          statements.push(dialect.sqlToQuery(query).sql);
          return { rows: [{ value }] };
        },
      } as never,
    };
  };
  const key = "purchase_carries_to_later_editions";
  assert.equal(await commercialSettingChoice(reader(null).tx, key), true);
  assert.equal(await commercialSettingChoice(reader(false).tx, key), false);
  assert.equal(await commercialSettingChoice(reader(true).tx, key), true);
  for (const malformed of [1, "false", { value: false }])
    await assert.rejects(commercialSettingChoice(reader(malformed).tx, key), (error: unknown) => {
      assert.ok(error instanceof ValoProblem);
      assert.equal(error.status, 503);
      return true;
    });
  const plain = reader(false);
  await commercialSettingChoice(plain.tx, key);
  assert.equal(plain.statements.length, 1);
  assert.match(plain.statements[0]!, /valo_commercial_setting/);
  const held = reader(false);
  await commercialSettingChoice(held.tx, key, { hold: true });
  assert.equal(held.statements.length, 2);
  assert.match(held.statements[0]!, /pg_advisory_xact_lock_shared\(hashtextextended\(\$1, 0\)\)/);
  assert.match(held.statements[1]!, /valo_commercial_setting/);
});
