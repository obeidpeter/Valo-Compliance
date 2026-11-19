import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot } from "./operational-policy";
import { operationalDocument, type OriginalSection } from "./original-content-adapter";
import { supportsOperationalInferenceTemplate } from "./inference-operational-coverage";
/** Extract ID boundaries, not arbitrary ## headings: customer forms contain
 * legitimate ## subsections. Field specifications/examples are never masters. */
export function extractOperationalBody(
  id: string,
  title: string,
  source: string,
  expectedHash: string,
): OriginalSection {
  if (!supportsOperationalInferenceTemplate(id)) throw Error("OPERATIONAL_INTAKE_ID_NOT_SUPPORTED");
  return extractTemplateBody(id, title, source, expectedHash);
}
/** No risk classification, rights clearance, clause selection or publication
 * is inferred from successfully reading a source body. */
export function extractTemplateBody(
  id: string,
  title: string,
  source: string,
  expectedHash: string,
): OriginalSection {
  if (!/^TPL-(0[1-9]|[12][0-9]|3[0-9]|40)$/.test(id)) throw Error("R1_INTAKE_ID_NOT_SUPPORTED");
  if (sha256(source) !== expectedHash) throw Error("INTAKE_SOURCE_HASH_MISMATCH");
  const headers = [...source.matchAll(/^## (TPL-\d{2}) — ([^\n]+)$/gm)];
  const selected = headers.filter((h) => h[1] === id);
  if (selected.length !== 1) throw Error("EXACTLY_ONE_TEMPLATE_SECTION_REQUIRED");
  const heading = selected[0]!,
    index = headers.indexOf(heading);
  if (heading[2]!.toLowerCase() !== title.toLowerCase()) throw Error("INTAKE_TITLE_MISMATCH");
  let body = source.slice(heading.index! + heading[0].length, headers[index + 1]?.index ?? source.length);
  body = body.split(
    /^## (?:Publication handoff|Integration and publication checklist|Internal handoff|Authoring handoff|Rights and provenance|Source evidence|Internal claim)\b/m,
  )[0]!;
  body = body.split(/^## [^\n]* — internal\b/im)[0]!;
  const form = body.match(/^### Customer (?:form|document|body starts|body start)\s*$/im);
  if (form) body = body.slice(form.index! + form[0].length);
  body = body.split(/^### Customer (?:body ends|body end)\s*$/im)[0]!;
  body = body.split(/^### (?:Synthetic filled example|Fictional example|Guided field specification)\b/m)[0]!;
  body = body.split(/^\*\*(?:Fictional example|Synthetic example)[^:\n]*:/m)[0]!;
  body = body
    .split("\n")
    .filter(
      (line) =>
        !/^Status:|^R[123]\s*·|^(?:Prepared|Created|Draft version|Provenance):/i.test(line.trim()) &&
        !/^(?:\*\*)?(?:Related templates?|Template links|Recommended template IDs|Template IDs|Internal metadata)(?:\*\*)?:/i.test(
          line.trim(),
        ),
    )
    .join("\n")
    .replace(/^\s*---\s*|\s*---\s*$/g, "")
    .trim();
  if (
    body.length < 100 ||
    /DRAFT — HELD|EDP-\d|Synthetic filled example|Fictional example|Demo (?:Business|Staff|Shop|Studio)|DEMO-(?:INV|QUO)|Guided field specification|Publication handoff|upstreamProvider/i.test(
      body,
    )
  )
    throw Error("CUSTOMER_BODY_BOUNDARY_UNVERIFIED");
  return { id, title, body, sourceHash: expectedHash, relatedTemplateIds: [] };
}
export async function readOperationalIntake(id: string, version = 1) {
  if (!supportsOperationalInferenceTemplate(id)) throw Error("OPERATIONAL_INTAKE_ID_NOT_SUPPORTED");
  return readTemplateIntake(id, version);
}
export async function readTemplateIntake(id: string, version = 1) {
  if (!Number.isSafeInteger(version) || version < 1) throw Error("INTAKE_VERSION_INVALID");
  const root = publicationWorkspaceRoot(),
    manifestPath = "docs/content-candidates/r1-content-intake-manifest.json";
  const manifestText = await readFile(resolve(root, manifestPath), "utf8"),
    manifest = JSON.parse(manifestText);
  const row = manifest.templates.find((r: { id: string }) => r.id === id);
  if (!row || !/^docs\/content-candidates\/[a-z0-9-]+\.md$/.test(row.sourcePath))
    throw Error("INTAKE_SOURCE_NOT_ALLOWLISTED");
  const source = await readFile(resolve(root, row.sourcePath), "utf8");
  const section = extractTemplateBody(id, row.title, source, row.sourceSHA256);
  return {
    section,
    document: operationalDocument(section),
    catalogue: row,
    sourcePath: row.sourcePath,
    sourceHash: section.sourceHash,
    bodyHash: sha256(section.body),
    manifestHash: sha256(manifestText),
    authoringAttribution: manifest.authoring,
    provenance: {
      path: row.sourcePath,
      hash: section.sourceHash,
      sourceText: source,
      note: manifestText,
      noteHash: sha256(manifestText),
      authoringRoute:
        "Original ChatGPT prose attributed by the retained intake manifest; upstream model/execution receipts unrecorded",
      transformation:
        "Exact-ID source extraction; internal metadata, field specifications and filled examples excluded; canonical blank form adaptation",
      templateId: id,
      version,
    },
    rightsState: "not_evaluated_for_new_bytes",
    reviewState: "not_run",
    publicationStatus: "unpublished_candidate",
  };
}
export async function readGuidanceIntake(id: string, version = 1) {
  if (!/^GUD-(0[1-9]|[12]\d|30)$/.test(id) || !Number.isSafeInteger(version) || version < 1)
    throw Error("R1_GUIDANCE_ID_NOT_SUPPORTED");
  const root = publicationWorkspaceRoot(),
    path = "docs/content-candidates/r1-content-intake-manifest.json";
  const note = await readFile(resolve(root, path), "utf8"),
    manifest = JSON.parse(note);
  const row = manifest.guidance.find((r: { id: string }) => r.id === id);
  if (!row || !/^docs\/content-candidates\/[a-z0-9-]+\.md$/.test(row.sourcePath))
    throw Error("GUIDANCE_SOURCE_NOT_ALLOWLISTED");
  const source = await readFile(resolve(root, row.sourcePath), "utf8");
  if (sha256(source) !== row.sourceSHA256) throw Error("GUIDANCE_SOURCE_HASH_MISMATCH");
  const marker = `## ${id} — ${row.title}`;
  if (source.split(marker).length !== 2) throw Error("GUIDANCE_HEADING_NOT_UNIQUE");
  const section = source.split(marker)[1]!.split(/^## GUD-\d{2} — /m)[0]!;
  const pieces = section.split(/^### (?:Customer body(?: starts?)?|Customer article)\s*$/im);
  if (pieces.length !== 2) throw Error("GUIDANCE_CUSTOMER_BOUNDARY_MISSING");
  const body = pieces[1]!
    .split(/^### (?:Customer body ends?|Editorial metadata|Internal|Claim map|Source metadata)/im)[0]!
    .trim();
  if (body.length < 100 || /EDP-\d|publicationStatus|aiReviewedAt|sourceSHA256/.test(body))
    throw Error("GUIDANCE_INTERNAL_METADATA_IN_BODY");
  const original: OriginalSection = {
    id,
    title: row.title,
    body,
    sourceHash: row.sourceSHA256,
    relatedTemplateIds: [],
  };
  return {
    section: original,
    document: operationalDocument(original),
    catalogue: row,
    sourceHash: row.sourceSHA256,
    provenance: {
      path: row.sourcePath,
      hash: sha256(source),
      sourceText: source,
      note,
      noteHash: sha256(note),
      templateId: id,
      version,
      authoringRoute: "Original supplied ChatGPT guidance; source and independent review still required",
      transformation:
        "Exact customer-body boundary extraction; editorial claim maps and internal status excluded",
    },
  };
}
