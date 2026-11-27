import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  acceptanceCorpora,
  confirmationClaim,
  corpusCases,
  isAcceptanceCorpus,
  type AcceptanceCorpus,
} from "./acceptance-cases";

// EDP-010, RUL-008 and AI-008 (decision 0016, docs/architecture/reviewer-record.md, slice 1): a reviewer
// reads each frozen case as the suites bind it, so a decision names the hash a suite will check.
const root = new URL("../../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const packaged = JSON.parse(read("docs/valo/evidence/finite-allocation-package-disabled.json")) as {
  package: { corpora: { name: string; cases: { id: string; hash: string }[] }[] };
};
const packageName: Record<AcceptanceCorpus, string> = {
  editorial: "editorial",
  checker: "checker",
  customer_ai: "customer-ai",
};

test("each case carries the hash the disabled allocation package binds it by, in the corpus's order", () => {
  for (const corpus of acceptanceCorpora) {
    const listed = packaged.package.corpora.find((item) => item.name === packageName[corpus]);
    assert.ok(listed, `${corpus} is in the package`);
    assert.deepEqual(
      corpusCases(corpus, read).map(({ id, hash }) => ({ id, hash })),
      listed.cases,
      `${corpus}: the same cases, ids and hashes`,
    );
  }
  assert.deepEqual(
    acceptanceCorpora.map((corpus) => corpusCases(corpus, read).length),
    [60, 80, 60],
  );
});

test("a case shows its expected outcome, its critical failure conditions and its sources", () => {
  for (const corpus of acceptanceCorpora)
    for (const item of corpusCases(corpus, read)) {
      assert.match(item.id, /^[A-Z0-9][A-Z0-9-]{2,63}$/, `${item.id} fits the record's case names`);
      assert.ok(item.title.trim().length > 0, `${item.id} has a title`);
      assert.ok(item.expected.length > 0, `${item.id} has an expected outcome`);
      assert.ok(item.critical.length > 0, `${item.id} has critical failure conditions`);
      assert.ok(item.sources.length > 0, `${item.id} names its sources`);
      for (const line of [...item.expected, ...item.critical, ...item.sources])
        assert.ok(line.trim().length > 0 && !line.includes("[object Object]"), `${item.id}: ${line}`);
    }
  const editorial = corpusCases("editorial", read)[0]!;
  assert.match(editorial.expected[0]!, /^decision: /, "an editorial case starts with its decision");
});

test("a case whose row changes gets another hash, and the other cases keep theirs", () => {
  const original = corpusCases("checker", read);
  const changed = corpusCases("checker", (path) => {
    const file = JSON.parse(read(path)) as { cases: Record<string, unknown>[] };
    file.cases[0] = { ...file.cases[0], title: `${String(file.cases[0]!.title)} (changed)` };
    return JSON.stringify(file);
  });
  assert.notEqual(changed[0]!.hash, original[0]!.hash);
  assert.deepEqual(
    changed.slice(1).map((item) => item.hash),
    original.slice(1).map((item) => item.hash),
  );
  // Keys in another order are the same row: the hash is of key-sorted JSON.
  const reordered = corpusCases("checker", (path) => {
    const file = JSON.parse(read(path)) as { cases: Record<string, unknown>[] };
    file.cases = file.cases.map((row) => Object.fromEntries(Object.entries(row).reverse()));
    return JSON.stringify(file);
  });
  assert.deepEqual(
    reordered.map((item) => item.hash),
    original.map((item) => item.hash),
  );
});

test("only the three corpora are named, and a confirmation says what it claims", () => {
  assert.deepEqual([...acceptanceCorpora], ["editorial", "checker", "customer_ai"]);
  for (const name of ["editorial", "checker", "customer_ai"]) assert.equal(isAcceptanceCorpus(name), true);
  for (const name of ["customer-ai", "Editorial", "", null, 1]) assert.equal(isAcceptanceCorpus(name), false);
  assert.equal(
    confirmationClaim,
    "This confirms that the case's expected outcome follows from its cited sources. It is not legal, tax or regulatory advice unless the reviewer is engaged to give that.",
  );
});
