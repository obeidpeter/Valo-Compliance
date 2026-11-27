import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { baselineTemplates } from "@workspace/valo-core";
import { RETAINED_ENTRY_DETAILS } from "./retained-entry-details";
import { entryDetails } from "./index";
import { practicalDraftPath, retainedContentSections } from "../../lib/retained-content-sections";
import { publicationWorkspaceRoot } from "../publication";

const root = publicationWorkspaceRoot();
const read = (path: string) => readFile(resolve(root, path), "utf8");

// docs/architecture/library-entries.md, section 3: the details filed with each retained template are
// proposals a Content editor releases or corrects. These checks keep them within what a release takes
// and within DOC-003's acceptance.
test("every retained template has proposed details that a template's release takes", () => {
  assert.deepEqual(
    Object.keys(RETAINED_ENTRY_DETAILS).sort(),
    baselineTemplates.map((template) => template.id),
  );
  for (const template of baselineTemplates) {
    const proposal = RETAINED_ENTRY_DETAILS[template.id]!;
    const kind = template.access === "premium" ? "premium_template" : "template";
    // The same check an editor's draft goes through; nothing is cut or refused.
    const details = entryDetails({
      kind,
      purpose: proposal.purpose,
      needs: proposal.needs.join("\n"),
      limits: proposal.limits,
      relatedItems: proposal.guides.map((_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`),
      aiDrafted: true,
    });
    assert.equal(details.purpose, proposal.purpose, template.id);
    assert.equal(details.limits, proposal.limits, template.id);
    assert.equal(details.needs, proposal.needs.join("\n"), template.id);
    assert.ok(proposal.needs.length > 0, template.id);
    assert.ok(proposal.guides.length <= 6, template.id);
    // Plain sentences: each item of the needs list is a phrase, and the others end as sentences do.
    assert.match(proposal.purpose, /\.$/, template.id);
    assert.match(proposal.limits, /\.$/, template.id);
    for (const need of proposal.needs) assert.doesNotMatch(need, /\.$|^\s|\s$/, `${template.id}: ${need}`);
  }
});

test("a higher-risk template's proposed limits say when independent advice may be useful, and no proposal promises a result", () => {
  // DOC-003: higher-risk templates "explain when independent advice may be useful and never promise
  // enforceability, suitability or official approval".
  const promises = [
    /\b(?:is|are|will be|becomes?)\s+(?:legally\s+)?(?:enforceable|binding|valid|compliant|approved|suitable)\b/i,
    /\bguarantee/i,
    /\bensures?\b/i,
    /\bcompliant\b/i,
    /\b(?:officially|lawyer[- ]|professionally)\s*(?:approved|verified|certified)\b/i,
    /\blegally (?:sound|safe)\b/i,
  ];
  for (const [id, proposal] of Object.entries(RETAINED_ENTRY_DETAILS)) {
    if (proposal.risk !== "general")
      assert.match(proposal.limits, /\bindependent\b[^.]*\badvice\b/i, `${id} (${proposal.risk})`);
    for (const text of [proposal.purpose, proposal.limits, ...proposal.needs])
      for (const promise of promises) assert.doesNotMatch(text, promise, `${id}: ${text}`);
  }
  // The proposals cover each class they claim: agreements, employment, privacy and the rest.
  const classes = new Set(Object.values(RETAINED_ENTRY_DETAILS).map((proposal) => proposal.risk));
  for (const risk of ["general", "contracts", "employment", "privacy", "governance", "regulated_sector"])
    assert.ok(classes.has(risk as never), risk);
});

test("each related guide proposed for a template names that template in its own retained text", async () => {
  // A practical guide names its related templates by title on its "Suggested related templates" line;
  // a regulatory guide names them by ID on its "Related templates" line.
  const practical = new Map(
    retainedContentSections(practicalDraftPath, await read(practicalDraftPath)).map(
      ({ section, sourceText }) => [section.heading.split(" — ")[0]!, sourceText],
    ),
  );
  const manifest = JSON.parse(await read("docs/content-candidates/r1-content-intake-manifest.json")) as {
    guidance: { id: string; sourcePath: string }[];
  };
  const regulatory = new Map<string, string>();
  for (const row of manifest.guidance) {
    const source = await read(row.sourcePath);
    const start = source.indexOf(`## ${row.id} — `);
    assert.ok(start >= 0, row.id);
    const next = source.slice(start + 1).search(/^## GUD-\d{2} — /m);
    regulatory.set(row.id, source.slice(start, next < 0 ? undefined : start + 1 + next));
  }
  let links = 0;
  for (const [id, proposal] of Object.entries(RETAINED_ENTRY_DETAILS)) {
    const title = baselineTemplates.find((template) => template.id === id)!.title.toLowerCase();
    for (const guide of proposal.guides) {
      links++;
      if (guide.startsWith("GUIDE-C")) {
        const line = practical
          .get(guide)
          ?.split("\n")
          .find((text) => /^Suggested related (?:templates?|documents?)\b/.test(text));
        assert.ok(line, `${guide} has no related-template line`);
        const names = line
          .replace(/^[^:]*:\s*/, "")
          .replace(/\.\s*Next step:.*$/, "")
          .split(",")
          .map((name) => name.trim().replace(/\.$/, "").toLowerCase());
        assert.ok(
          names.some((name) => name && title.includes(name)),
          `${guide} does not name ${id} (${title}): ${names.join("; ")}`,
        );
      } else {
        const lines = (regulatory.get(guide) ?? "")
          .split("\n")
          .filter((text) => /Related templates?\s*[:=]/.test(text));
        assert.ok(
          lines.some((text) => text.includes(id)),
          `${guide} does not name ${id} on a related-template line`,
        );
      }
    }
  }
  assert.ok(links >= 40, `only ${links} related guides are proposed`);
});
