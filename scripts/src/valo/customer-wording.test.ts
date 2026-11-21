import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { repositoryRoot } from "./architecture-check";

/** What R1 tells customers, checked in the source text itself. */
const read = (path: string) => readFileSync(join(repositoryRoot, path), "utf8");

function sourceFiles(directory: string, extensions: RegExp): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (["node_modules", "dist", ".next", "generated-artifacts"].includes(entry.name)) continue;
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (extensions.test(entry.name) && !/\.test\.tsx?$/.test(entry.name))
        found.push(relative(repositoryRoot, path));
    }
  };
  walk(join(repositoryRoot, directory));
  return found.sort();
}

// The web app and the API code whose words reach customers (not its scripts or editorial tools).
const customerText = () => [
  ...sourceFiles("artifacts/valo/src", /\.tsx?$/),
  ...sourceFiles("artifacts/valo/app", /\.tsx?$/),
  ...sourceFiles("artifacts/api-server/src/lib", /\.ts$/),
  ...sourceFiles("artifacts/api-server/src/modules", /\.ts$/),
  ...sourceFiles("artifacts/api-server/src/routes", /\.ts$/),
];

const denial =
  /\b(not|no|never|nor|without|isn't|aren't|doesn't|don't|cannot|stay|stays|remain|remains|keep|keeps)\b/i;

/** Every sentence of the files that matches all the patterns, with whether it denies them. */
function sentences(files: string[], ...patterns: RegExp[]) {
  const found: { file: string; sentence: string; denied: boolean }[] = [];
  for (const file of files)
    for (const part of read(file).split(/(?<=[.!?])\s+|["`]|\n\s*\n/)) {
      const sentence = part.replace(/\s+/g, " ").trim();
      if (patterns.every((pattern) => pattern.test(sentence)))
        found.push({ file, sentence, denied: denial.test(sentence) });
    }
  return found;
}

// EDT-010: "Saved drafts remain the customer's work even when an entitlement is refunded or a master
// is retired; future reuse/export policy must be disclosed", accepted when "revoking platform
// access is never described as retracting a previously downloaded local file".
test("losing access is never described as taking back a downloaded copy, and saved work is said to stay", () => {
  const files = customerText();
  assert.ok(files.length > 150, "the customer-facing source was read");
  const downloaded =
    /\b(already |previously )?downloaded (files?|cop(y|ies)|documents?)\b|\blocal (files?|cop(y|ies))\b|\bcop(y|ies) (on|saved to) your (device|computer)\b/i;
  const takenBack = /\b(retract|recall|delet|remov|wip|eras|revok|disabl|disappear|lock|expir)\w*/i;
  const mentions = sentences(files, downloaded, takenBack);
  assert.ok(mentions.length >= 4, "the sentences about downloaded copies were found");
  assert.deepEqual(
    mentions.filter((m) => !m.denied).map((m) => `${m.file}: ${m.sentence}`),
    [],
  );
  // What customers are told stays theirs, and the reuse policy a refund applies.
  const says = (file: string, text: RegExp) => assert.match(read(file).replace(/\s+/g, " "), text, file);
  says(
    "artifacts/api-server/src/modules/commerce/valo-refund-provider.ts",
    /a confirmed full refund suspends future template reuse\. Saved drafts, revisions and already downloaded files are never deleted\./,
  );
  says(
    "artifacts/valo/src/screens/purchase-history.tsx",
    /Saved drafts and previously downloaded files are not deleted\./,
  );
  says(
    "artifacts/valo/src/public-screens/template-detail.tsx",
    /Drafts you already created stay in your workspace\./,
  );
  says("artifacts/valo/src/components/workspace-export-jobs.tsx", /downloaded copies are not removed\./);
});

// DOC-008: "Identify official forms by authority and official URL; do not rebrand preparation
// checklists as official filing forms", accepted when "any downloadable government form has
// checked reuse rights, provenance and a current-link warning". R1 offers none; a release that adds
// one must add those checks here.
test("R1 offers no government form to download and never presents a template or checklist as an official form", () => {
  const officialForm =
    /\b(official|government|statutory|regulator'?s?|prescribed)\b[^.\n"]{0,30}\bforms?\b|\b(CAC|FIRS|NRS|LIRS|PENCOM|NSITF|ITF|NAFDAC|SON|NDPC|CBN|SEC)\b[^.\n"]{0,25}\bforms?\b|\bforms?\s+(CAC|FIRS|NRS|LIRS)\b|\bfiling forms?\b/i;
  // Every template and guidance title Valo has prepared.
  const titles = new Set<string>();
  for (const file of sourceFiles("docs/content-candidates", /\.(json|md)$/))
    for (const match of read(file).matchAll(/"title":\s*"([^"]+)"/g)) titles.add(match[1]!);
  assert.ok(titles.size > 60, "the prepared titles were read");
  assert.deepEqual(
    [...titles].filter((title) => officialForm.test(title)),
    [],
  );
  // What customers read.
  assert.deepEqual(
    sentences(customerText(), officialForm)
      .filter((m) => !m.denied)
      .map((m) => `${m.file}: ${m.sentence}`),
    [],
  );
  // What the API serves: no operation offers an official or government form.
  const contract = read("lib/api-spec/openapi.yaml");
  assert.doesNotMatch(contract, officialForm);
  assert.doesNotMatch(contract, /\/(government|official)[-_]?forms?\b/i);
});
