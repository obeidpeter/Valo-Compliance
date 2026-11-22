import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  digest,
  isPracticalGuideId,
  invoiceQuotationGuideIds,
  reminderInventoryGuideIds,
  sha256,
  type PublicationBundle,
} from "@workspace/valo-core";
import { guidanceReleaseDocument } from "./guidance-document";
import { operationalPolicy, publicationWorkspaceRoot } from "./operational-policy";
import type { OperationalProvenance } from "./operational-content";

export const practicalSourcePath = "docs/content-candidates/practical-guide-candidates.md";
export const practicalProvenancePath = "docs/content-candidates/chatgpt-content-provenance-rights.md";
const sourceHash = "229728d08404c45f1bd98318fb0960396a85e78b36ffb1dc22779f1457e9ed82";
const provenanceNoteHash = "57080e5d1a4105c3b3545b8e94f65662eb8e1d5ce08f2b88154fcfc345aca616";
const releaseScope = {
  path: "docs/valo/policies/practical-business-guides.md",
  hash: "217faa97d037e3114d6328f6b60e5875d696918bdcebbbb12e5d7aff7f3b7b44",
  quote: "This first release covers only the invoice article GUIDE-C01 and the quotation article GUIDE-C02.",
  ids: invoiceQuotationGuideIds,
  version: "practical-guides-dev-1",
};
const reminderInventoryScope = {
  path: "docs/valo/policies/practical-reminder-inventory-preparation.md",
  hash: "d204a025bf2dd7fcf390097fc191710601cef20622376e1e92878f526c65fd06",
  quote: "This review scope covers GUIDE-C03 on payment reminders and GUIDE-C04 on inventory registers.",
  ids: reminderInventoryGuideIds,
  version: "practical-reminder-inventory-preparation-1",
};
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
  "GUIDE-C03": {
    slug: "follow-up-an-unpaid-invoice",
    sectionHash: "01ee9930d7851216e7228f002d31aa956caa857668b8ad1f653aaad7c3d7c1d2",
    scope:
      "Checking an outstanding balance, writing a payment reminder and recording the customer's response.",
  },
  "GUIDE-C04": {
    slug: "keep-an-inventory-register",
    sectionHash: "a48f3a0ddbab48c817621e7337b80f50dbcb070e1f57c66d67eb7da1b87b3582",
    scope:
      "Recording stock movements in consistent units and checking a physical count against the register.",
  },
} as const;
export function practicalGuideSlug(id: string) {
  if (!isPracticalGuideId(id)) throw Error("PRACTICAL_GUIDE_OUTSIDE_SCOPE");
  return articles[id].slug;
}

async function scopedPracticalPolicy(scope: typeof releaseScope | typeof reminderInventoryScope) {
  const base = await operationalPolicy("practical_guide");
  const text = await readFile(resolve(publicationWorkspaceRoot(), scope.path), "utf8");
  const fileHash = sha256(text);
  const { hash: foundationHash, ...foundation } = base.policy;
  const ref = {
    path: scope.path,
    hash: fileHash,
    quote: scope.quote,
  };
  const body = {
    ...foundation,
    version: `${scope.version}:${fileHash.slice(0, 16)}:${foundationHash.slice(0, 16)}`,
    ownerApproved: foundation.ownerApproved && fileHash === scope.hash && text.includes(ref.quote),
    allowedClasses: foundation.allowedClasses.includes("practical_guide") ? ["practical_guide"] : [],
    jurisdictions: foundation.jurisdictions.filter((j) => j === "NG"),
    risks: ["general"],
    originalOperationalIds: [...scope.ids],
    authorityRefs: [...(foundation.authorityRefs ?? []), ref],
  };
  const policy: PublicationBundle["policy"] = { ...body, hash: digest(body) };
  return { policy, authority: [...base.authority, { ...ref, text }] };
}

/** The invoice and quotation policy is retained for their existing versions. */
export function practicalGuidePolicy() {
  return scopedPracticalPolicy(releaseScope);
}
export function practicalGuidePreparationPolicy(id: string) {
  if (!isPracticalGuideId(id)) throw Error("PRACTICAL_GUIDE_OUTSIDE_SCOPE");
  return reminderInventoryGuideIds.some((article) => article === id)
    ? scopedPracticalPolicy(reminderInventoryScope)
    : practicalGuidePolicy();
}

/** Release authority is checked separately so the reviewed bundle keeps its original policy hash. */
export async function practicalGuideReleasePolicy({
  id,
  version,
}: Pick<PublicationBundle["candidate"], "id" | "version">) {
  if (!isPracticalGuideId(id)) return null;
  if (invoiceQuotationGuideIds.some((article) => article === id)) return practicalGuidePolicy();
  if (version !== 1 || !reminderInventoryGuideIds.some((article) => article === id)) return null;
  const decision = resolve(
    publicationWorkspaceRoot(),
    "docs/valo/policies/practical-reminder-inventory-release.md",
  );
  try {
    if (
      sha256(await readFile(decision)) !== "1d2aff95c58f5bea7ae9ec2c3fd65935a9846982bda079111ecff0f4799a65f4"
    )
      return null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
  return scopedPracticalPolicy(reminderInventoryScope);
}

/** Extraction is limited to byte-pinned sections. Editorial suggestions never become
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
    id === "GUIDE-C04"
      ? "The fabric-shop example is fictional. Use your own item references, units and counts. A count alone does not establish ownership, quality or the reason for a difference."
      : id === "GUIDE-C03"
        ? "The amount and invoice reference are fictional. Verify the balance, due date and any dispute against your own records before contacting a customer."
        : "The example is fictional. Confirm the facts, prices and arrangements of your own transaction. Tax treatment and legal obligations require separate verification.";
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
