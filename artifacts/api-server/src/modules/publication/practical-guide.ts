import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  digest,
  isPracticalGuideId,
  practicalGuideIds,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import { guidanceReleaseDocument } from "./guidance-document";
import { operationalPolicy, publicationWorkspaceRoot } from "./operational-policy";
import type { OperationalProvenance } from "./operational-content";

export const practicalSourcePath = "docs/content-candidates/practical-guide-candidates.md";
export const practicalProvenancePath = "docs/content-candidates/chatgpt-content-provenance-rights.md";
const policyPath = "docs/valo/policies/practical-business-guides.md";
const sourceHash = "229728d08404c45f1bd98318fb0960396a85e78b36ffb1dc22779f1457e9ed82";
const provenanceNoteHash = "57080e5d1a4105c3b3545b8e94f65662eb8e1d5ce08f2b88154fcfc345aca616";
const policyScopeHash = "217faa97d037e3114d6328f6b60e5875d696918bdcebbbb12e5d7aff7f3b7b44";
const articles = {
  "GUIDE-C01": {
    slug: "prepare-an-invoice",
    sectionHash: "6f71be868dd33665668789a5e7610af9eebb1da1a06ab5959357171f3c622758",
    scope: "Preparing an itemised invoice from an agreed sale and checking its figures before sending.",
  },
  "GUIDE-C02": {
    slug: "write-a-quotation",
    sectionHash: "2f4f28b6b15ab1e0a3a9de502fe663f689627ec15101f07d5fdd32c87608cbdb",
    scope: "Describing a proposed order, explaining what the price includes and keeping track of revisions.",
  },
} as const;
export function practicalGuideSlug(id: string) {
  if (!isPracticalGuideId(id)) throw Error("PRACTICAL_GUIDE_OUTSIDE_SCOPE");
  return articles[id].slug;
}

export async function practicalGuidePolicy() {
  const base = await operationalPolicy("practical_guide");
  const text = await readFile(resolve(publicationWorkspaceRoot(), policyPath), "utf8");
  const fileHash = sha256(text);
  const { hash: foundationHash, ...foundation } = base.policy;
  const ref = {
    path: policyPath,
    hash: fileHash,
    quote:
      "This first release covers only the invoice article GUIDE-C01 and the quotation article GUIDE-C02.",
  };
  const body = {
    ...foundation,
    version: `practical-guides-dev-1:${fileHash.slice(0, 16)}:${foundationHash.slice(0, 16)}`,
    ownerApproved: foundation.ownerApproved && fileHash === policyScopeHash && text.includes(ref.quote),
    allowedClasses: foundation.allowedClasses.includes("practical_guide") ? ["practical_guide"] : [],
    jurisdictions: foundation.jurisdictions.filter((j) => j === "NG"),
    risks: ["general"],
    originalOperationalIds: [...practicalGuideIds],
    authorityRefs: [...(foundation.authorityRefs ?? []), ref],
  };
  const policy: PublicationBundle["policy"] = { ...body, hash: digest(body) };
  return { policy, authority: [...base.authority, { ...ref, text }] };
}

/** Extraction is limited to the two byte-pinned sections. Editorial suggestions never become
 * links to held templates. The invoice's final next step is part of its reader-facing text. */
export async function readPracticalGuideIntake(id: string, version = 1) {
  if (!isPracticalGuideId(id) || !Number.isSafeInteger(version) || version < 1)
    throw Error("PRACTICAL_GUIDE_OUTSIDE_SCOPE");
  const root = publicationWorkspaceRoot();
  const [source, note] = await Promise.all([
    readFile(resolve(root, practicalSourcePath), "utf8"),
    readFile(resolve(root, practicalProvenancePath), "utf8"),
  ]);
  if (
    sha256(source) !== sourceHash ||
    sha256(note) !== provenanceNoteHash ||
    !note.split("\n").some((line) => line.includes(practicalSourcePath) && line.includes(sourceHash))
  )
    throw Error("PRACTICAL_GUIDE_PROVENANCE_CHANGED");
  const headings = [...source.matchAll(/^## (GUIDE-C\d{2}) — (.+)$/gm)];
  const index = headings.findIndex((h) => h[1] === id);
  const heading = headings[index];
  if (!heading || headings.filter((h) => h[1] === id).length !== 1)
    throw Error("PRACTICAL_GUIDE_SECTION_MISSING");
  const raw = source.slice(heading.index, headings[index + 1]?.index ?? source.length);
  if (sha256(raw) !== articles[id].sectionHash) throw Error("PRACTICAL_GUIDE_SECTION_CHANGED");
  const body = raw
    .slice(heading[0].length)
    .split("\n")
    .filter((line) => !line.startsWith("Status:"))
    .map((line) =>
      line.startsWith("Suggested related template")
        ? line.includes("Next step: ")
          ? line.slice(line.indexOf("Next step: "))
          : ""
        : line,
    )
    .join("\n")
    .trim();
  const section = { id, title: heading[2]!, body, sourceHash, relatedTemplateIds: [] };
  const authoringAttribution =
    "Original ChatGPT prose attributed by the retained authoring note. Upstream model and execution IDs were not recorded.";
  const provenance: OperationalProvenance = {
    path: practicalSourcePath,
    hash: sourceHash,
    sourceText: source,
    note,
    noteHash: sha256(note),
    authoringRoute: authoringAttribution,
    transformation:
      "Selected the pinned article, removed editorial metadata, preserved its examples and checklist.",
    templateId: id,
    version,
  };
  return {
    section,
    sourcePath: practicalSourcePath,
    sourceHash,
    manifestHash: provenance.noteHash,
    authoringAttribution,
    provenance,
  };
}

export async function practicalGuideCandidate(
  id: string,
  version: number,
  now: Date,
  recorded?: { original: string; provenance: OperationalProvenance },
) {
  if (!isPracticalGuideId(id)) throw Error("PRACTICAL_GUIDE_OUTSIDE_SCOPE");
  const intake = await readPracticalGuideIntake(id, version);
  if (
    recorded &&
    (recorded.original !== intake.section.body || digest(recorded.provenance) !== digest(intake.provenance))
  )
    throw Error("PRACTICAL_GUIDE_PROVENANCE_CHANGED");
  const scope = articles[id].scope;
  const limitations =
    "The example is fictional. Confirm the facts, prices and arrangements of your own transaction. Tax treatment and legal obligations require separate verification.";
  const reviewedAt = now.toISOString(),
    reviewBy = new Date(+now + 30 * 86400000).toISOString();
  const document = guidanceReleaseDocument({
    section: intake.section,
    scope,
    limitations,
    sourcesCheckedAt: reviewedAt,
    references: [],
  });
  return {
    document,
    scope,
    limitations,
    reviewedAt,
    reviewBy,
    original: intake.section.body,
    provenance: intake.provenance,
  };
}
