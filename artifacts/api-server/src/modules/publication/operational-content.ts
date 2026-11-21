import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, sha256, disclosure } from "@workspace/valo-core";
import { documentInput } from "../../lib/valo-validation";
import { publicationWorkspaceRoot } from "./operational-policy";
import type { ArtifactRef } from "./publication-artifacts";
import { originalSections, operationalDocument } from "./original-content-adapter";
import { guidanceCandidate } from "./guidance-candidate";
export type OperationalProvenance = {
  path: string;
  hash: string;
  sourceText: string;
  note: string;
  noteHash: string;
  authoringRoute: string;
  transformation: string;
  templateId: string;
  version: number;
  generation?: ArtifactRef;
};
/** Canonical reconstruction for every exact R1 template ID. Risk/claims,
 * enhanced checks and eligibility are separate; extraction is not release.
 * A guidance ID is rebuilt as a guide, with no sources listed (guidance-candidate.ts). */
export async function templateCandidate(
  id: string,
  version: number,
  now = new Date(),
  recorded?: { original: string; provenance: OperationalProvenance },
) {
  if (id === "TPL-07") return inventoryCandidate(version, now, recorded);
  if (id.startsWith("GUD-")) return guidanceCandidate(id, version, now, recorded);
  const { readTemplateIntake } = await import("./operational-intake");
  const intake = await readTemplateIntake(id, version);
  const provenance = recorded?.provenance ?? intake.provenance,
    original = recorded?.original ?? intake.section.body;
  if (
    provenance.templateId !== id ||
    sha256(provenance.sourceText) !== provenance.hash ||
    sha256(provenance.note) !== provenance.noteHash ||
    original !== intake.section.body ||
    provenance.hash !== intake.sourceHash ||
    provenance.noteHash !== intake.provenance.noteHash
  )
    throw Error("TEMPLATE_PROVENANCE_OR_BODY_MISMATCH");
  const scope = `Original ${intake.catalogue.title.toLowerCase()} starting form for user-entered facts, subject to its stated use assumptions and separate evidence gates.`;
  const limitations =
    "A starting document, not a guarantee of legal validity, regulatory approval or professional review. Unresolved parties, terms, amounts and material clauses must be resolved before use. Development evaluation only; commercial licence acceptance and sales remain separate.";
  const reviewedAt = now.toISOString(),
    reviewBy = new Date(+now + 90 * 86400000).toISOString();
  const document = documentInput.parse({
    ...intake.document,
    content: {
      ...intake.document.content,
      blocks: [
        ...intake.document.content.blocks,
        { id: "release-scope", type: "paragraph", text: `Scope: ${scope}`, rows: [] },
        { id: "release-limitations", type: "paragraph", text: `Limitations: ${limitations}`, rows: [] },
        { id: "release-disclosure", type: "paragraph", text: disclosure, rows: [] },
        {
          id: "review-meaning",
          type: "paragraph",
          text: "Release requires two separate automated AI checks and all applicable source, enhanced and export checks. This is not legal or regulatory verification or professional certification.",
          rows: [],
        },
        {
          id: "release-source-date",
          type: "paragraph",
          text: `File-integrity and evidence check date: ${reviewedAt}.`,
          rows: [],
        },
      ],
    },
  });
  return {
    document,
    scope,
    limitations,
    reviewBy,
    reviewedAt,
    original,
    provenance,
    documentDigest: digest(document),
  };
}
export async function inventoryCandidate(
  version: number,
  now = new Date(),
  recorded?: { original: string; provenance: OperationalProvenance },
) {
  const path = "docs/content-candidates/operational-template-candidates.md";
  const workspaceRoot = publicationWorkspaceRoot();
  const full = recorded?.provenance.sourceText ?? (await readFile(resolve(workspaceRoot, path), "utf8"));
  const provenance =
    recorded?.provenance.note ??
    (await readFile(
      resolve(workspaceRoot, "docs/content-candidates/chatgpt-content-provenance-rights.md"),
      "utf8",
    ));
  if (
    recorded
      ? sha256(full) !== recorded.provenance.hash || sha256(provenance) !== recorded.provenance.noteHash
      : !provenance.includes(sha256(full))
  )
    throw Error("AUTHORING_PROVENANCE_HASH_MISMATCH");
  const original =
    recorded?.original ??
    full
      .split("## TPL-07 — Inventory register\n")[1]
      ?.split("\n## TPL-09")[0]
      ?.replace(/\n---\s*$/, "")
      .trim();
  if (!original || (!recorded && !provenance.includes("authored in this ChatGPT conversation")))
    throw Error("AUTHORING_PROVENANCE_MISSING");
  const scope =
    "Original stock-movement and physical-count record for user-entered business information. Optional operational practice; no legal applicability determination.";
  const limitations =
    "Blank Word/PDF operational aid, not a spreadsheet or accounting system. No ownership, product approval, valuation, statutory duty, tax-rate or legal-validity assurance. Release uses two separate automated AI checks, not human or professional review. Synthetic development evaluation only; commercial licence terms are not accepted and sales are disabled.";
  const reviewedAt = now.toISOString(),
    reviewBy = new Date(+now + 90 * 86400000).toISOString();
  const section = originalSections(`## TPL-07 — Inventory register\n${original}`)[0];
  if (!section) throw Error("OPERATIONAL_CONTENT_SECTION_MISSING");
  const blocks = operationalDocument(section).content.blocks;
  const document = documentInput.parse({
    title: "Inventory register",
    content: {
      fields: {
        issuerName: "",
        recipientName: "",
        documentNumber: "",
        issueDate: "",
        dueDate: "",
        notes: "",
      },
      blocks: [
        {
          id: "optional-instructions",
          type: "paragraph",
          text: "Optional internal working instructions: all suggestions below are stock-recording practices to adapt to your actual workflow, not legal duties or regulatory advice. Enter your own business facts and quantities; blank fields are not verified information.",
          rows: [],
        },
        ...blocks,
        { id: "release-scope", type: "paragraph", text: `Scope: ${scope}`, rows: [] },
        { id: "release-limitations", type: "paragraph", text: `Limitations: ${limitations}`, rows: [] },
        { id: "release-disclosure", type: "paragraph", text: disclosure, rows: [] },
        {
          id: "review-meaning",
          type: "paragraph",
          text: "Here, reviewed means two separate automated AI checks: one factual/source check and one challenge. It does not mean review by a human, lawyer, tax adviser or sector specialist. Release requires both checks to pass on this exact version; their results are not professional certification.",
          rows: [],
        },
        {
          id: "release-source-date",
          type: "paragraph",
          text: `File-integrity and provider-permission check date: ${reviewedAt}. ${recorded?.provenance.generation ? "The recorded server-authoring receipt is retained." : "The supplied authoring note describes the prose as ChatGPT-assisted. Valo has not independently verified that upstream drafting event or model; this attribution is not authorship certification."} This software check covers the retained file checksum and provider-permission passages, not legal or regulatory verification.`,
          rows: [],
        },
      ],
      selectedClauses: [],
      formatting: { font: "sans", accent: "forest" },
    },
  });
  return {
    document,
    scope,
    limitations,
    reviewBy,
    reviewedAt,
    original,
    provenance: recorded?.provenance ?? {
      path,
      hash: sha256(full),
      sourceText: full,
      note: provenance,
      noteHash: sha256(provenance),
      authoringRoute:
        "Original ChatGPT prose supplied by coordinator; upstream model and execution ID not established",
      transformation:
        "Deterministic Markdown-to-canonical-Word/PDF adaptation with original Valo optional-use framing and disclosures; upstream authorship attributed, not independently verified",
      templateId: "TPL-07",
      version,
    },
    documentDigest: digest(document),
  };
}
