import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PRV-003: "Notification triggers/deadlines must have retrieved statutory evidence and AI checks; the
 * privacy owner owns incident decisions. Uncertainty prompts immediate assessment and authority contact,
 * not an invented deadline." Neither the evidence nor the checks exist yet, so the incident procedure,
 * its tabletop and their design (docs/architecture/incident-response.md, part 4) give no length of time
 * for telling the authority or the people affected.
 */
const root = resolve(import.meta.dirname, "../../..");
const files = [
  "docs/valo/incident-procedure.md",
  "docs/valo/incident-tabletop.md",
  "docs/architecture/incident-response.md",
];
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

const counts =
  "\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|forty-eight|fifty|sixty|seventy-two|ninety";
const length = new RegExp(
  `\\b(?:${counts})(?:\\s|-)+(?:working\\s+|business\\s+|calendar\\s+)?(?:minutes?|hours?|days?|weeks?|months?)\\b`,
  "i",
);
const telling =
  /\b(?:tell|tells|telling|told|notif\w*|report\w*|inform\w*|authority|commission|regulator|deadline)\b/i;

/** The sentences, table cells and list items of a Markdown file. */
function sentences(text: string) {
  return text
    .split(/\n\s*\n|\n\s*[-*|>]\s*|\|/)
    .flatMap((part) => part.split(/(?<=[.!?;:])\s+/))
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Each sentence that puts a length of time beside telling, notifying or reporting, or the authority. */
function inventedTimeLimits(text: string) {
  return sentences(text).filter((sentence) => length.test(sentence) && telling.test(sentence));
}

test("the incident procedure, its tabletop and their design give no length of time for telling the authority or the people affected", () => {
  // The check finds such a sentence when one is there.
  assert.deepEqual(
    inventedTimeLimits("Contain it first.\n\nTell the authority within 72 hours, and the people affected."),
    ["Tell the authority within 72 hours, and the people affected."],
  );
  assert.deepEqual(inventedTimeLimits("Notify the regulator in seventy-two hours."), [
    "Notify the regulator in seventy-two hours.",
  ]);
  assert.deepEqual(inventedTimeLimits("Backups hold every record for 35 days."), []);
  for (const file of files) assert.deepEqual(inventedTimeLimits(read(file)), [], file);
});

test("the incident procedure quotes PRV-003's rules for incidents word for word, as the specification gives them", () => {
  const specification = read("docs/specification/VALO-TRD-001-v1.1.txt")
    .split("\n")
    .find((line) => line.startsWith("PRV-003"));
  assert.ok(specification);
  const procedure = read("docs/valo/incident-procedure.md").replace(/\s+/g, " ");
  for (const words of [
    "the privacy owner owns incident decisions",
    "Uncertainty prompts immediate assessment and authority contact, not an invented deadline.",
  ]) {
    assert.ok(specification.includes(words), words);
    assert.ok(procedure.includes(words), words);
  }
});
