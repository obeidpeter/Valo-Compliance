import assert from "node:assert/strict";
import test from "node:test";
import { allSourceLeads, type PublicationBundle } from "@workspace/valo-core";
import { assembledGuide, passagesReadAt } from "../publication/guidance-release.fixtures";
import { inspectReleasedSources } from "./source-release-bindings";
import type { SourceReader } from "./valo-source-state";

// docs/architecture/reviewed-route.md, slice 2b: before the development owner checks a guide, each of its
// sources is inspected against the copy its candidate names, and every problem is reported. No database or
// storage is used: the captures are stand-ins made from the guide's own retained passages.
const now = new Date("2026-11-26T09:00:00Z");
const checkedAt = new Date(+now - 3_600_000);
const guide = async () =>
  (await assembledGuide("GUD-01", now, { passages: passagesReadAt(checkedAt) })).bundle as PublicationBundle;
const snapshotIdOf = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
/** A stored capture of a source's address, as the daily check keeps it, with `change` made to it. */
const capture = (url: string, id: string, change: Record<string, unknown> = {}) => ({
  id,
  source_id: allSourceLeads.find((lead) => lead.url === url)!.id,
  url,
  status: "retrieved_unreviewed",
  failure_code: null,
  raw_object_key: "synthetic-in-memory",
  text_object_key: "synthetic-in-memory",
  raw_checksum: "a".repeat(64),
  last_raw_hash: "a".repeat(64),
  stopped_at: null,
  checked_at: checkedAt,
  text_checksum: "b".repeat(64),
  ...change,
});

async function inspect(
  bundle: PublicationBundle,
  options: {
    named?: (index: number) => boolean;
    capture?: (index: number) => Record<string, unknown>;
    text?: (index: number, whole: string) => string | Error;
  } = {},
) {
  const named = options.named ?? (() => true);
  const snapshotIds = Object.fromEntries(
    bundle.sources.flatMap((source, index) => (named(index) ? [[source.id, snapshotIdOf(index)]] : [])),
  );
  const whole = bundle.sources.map((source) => source.text).join("\n\f\n");
  const reader = {
    execute: async (query: unknown) => {
      // The lookup names the capture and its address; answer with the stand-in for that capture.
      const values = JSON.stringify(query);
      const index = bundle.sources.findIndex((_, i) => values.includes(snapshotIdOf(i)));
      return {
        rows: [capture(bundle.sources[index]!.url, snapshotIdOf(index), options.capture?.(index) ?? {})],
      };
    },
  } as unknown as SourceReader;
  return inspectReleasedSources(reader, bundle, snapshotIds, now, async (snapshotId) => {
    const index = bundle.sources.findIndex((_, i) => snapshotIdOf(i) === snapshotId);
    const text = options.text ? options.text(index, whole) : whole;
    if (text instanceof Error) throw text;
    return text;
  });
}

test("each source whose current copy holds its passage and every quotation holds, with when it was checked", async () => {
  const bundle = await guide();
  assert.ok(bundle.sources.length >= 2, "the guide rests on more than one passage");
  const inspected = await inspect(bundle);
  assert.deepEqual(
    inspected.map((s) => [s.bundleSourceId, s.state, s.missingQuotes, s.checkedAt]),
    bundle.sources.map((source) => [source.id, "holds", [], checkedAt.toISOString()]),
  );
});

test("every source that does not hold is reported, each with its own reason, rather than only the first", async () => {
  const bundle = await guide();
  assert.ok(bundle.sources.length >= 3, `${bundle.sources.length} sources`);
  const last = bundle.sources.length - 1;
  const states = (
    await inspect(bundle, {
      // The first has no copy named; the second's address now serves another file; the last's copy was
      // last checked over a day ago.
      named: (index) => index !== 0,
      capture: (index) =>
        index === 1
          ? { last_raw_hash: "c".repeat(64) }
          : index === last
            ? { checked_at: new Date(+now - 86_460_000) }
            : {},
    })
  ).map((s) => s.state);
  assert.equal(states[0], "no_copy");
  assert.equal(states[1], "changed");
  assert.equal(states[last], "not_current");
  assert.ok(states.slice(2, last).every((state) => state === "holds"));
});

test("a copy that cannot be read, or that lacks a source's passage, holds that source", async () => {
  const bundle = await guide();
  const [first, second] = bundle.sources;
  const inspected = await inspect(bundle, {
    text: (index, whole) =>
      index === 0
        ? Error("SOURCE_STORAGE_CHECKSUM_FAILED")
        : index === 1
          ? whole.replace(second!.text, "")
          : whole,
  });
  assert.deepEqual(
    inspected.slice(0, 2).map((s) => [s.bundleSourceId, s.state]),
    [
      [first!.id, "unreadable"],
      [second!.id, "passage_missing"],
    ],
  );
});

test("a copy that holds a source's passage but not a sentence's quotation names that sentence", async () => {
  const bundle = await guide();
  const quoted = bundle.candidate.claims.findIndex((claim) => claim.sourceId === bundle.sources[0]!.id);
  assert.ok(quoted >= 0);
  const changed = {
    ...bundle,
    candidate: {
      ...bundle.candidate,
      claims: bundle.candidate.claims.map((claim, index) =>
        index === quoted ? { ...claim, quote: "synthetic words that no copy holds" } : claim,
      ),
    },
  };
  const [inspected] = await inspect(changed);
  assert.deepEqual([inspected!.state, inspected!.missingQuotes], ["quote_missing", [quoted]]);
});

test("a source whose address is not an official source Valo watches has no copy", async () => {
  const bundle = await guide();
  const changed = {
    ...bundle,
    sources: bundle.sources.map((source, index) =>
      index === 0 ? { ...source, url: "https://example.test/not-a-registered-source" } : source,
    ),
  };
  const [inspected] = await inspect(changed, { named: () => true });
  assert.equal(inspected!.state, "no_copy");
});
