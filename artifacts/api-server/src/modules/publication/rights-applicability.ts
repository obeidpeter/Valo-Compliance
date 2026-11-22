import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { isPracticalGuideId, sha256 } from "@workspace/valo-core";
import { publicationWorkspaceRoot } from "./operational-policy";
import { readGuidanceIntake, readOperationalIntake } from "./operational-intake";
import { supportsOperationalInferenceTemplate } from "./inference-operational-coverage";
/** The scope a guide's own wording is recorded under; a blank form keeps the scope it always had. */
import { practicalProvenancePath, practicalSourcePath, readPracticalGuideIntake } from "./practical-guide";
const practicalScope = "chatgpt_original_practical_article_provider_permission_only";
const guidanceScope = "chatgpt_original_guidance_prose_provider_permission_only";
const guideId = /^GUD-(0[1-9]|[12]\d|30)$/;
const schema = z
  .object({
    version: z.string().min(1),
    status: z.enum(["verified", "unverified"]),
    accountPlan: z.string().min(1),
    accountTerms: z.string().min(1).nullable(),
    integration: z.enum(["replit_managed_openai", "chatgpt"]),
    provider: z.literal("openai"),
    commercialUseScope: z
      .enum([
        "blank_operational_forms_internal_business_licence",
        "chatgpt_original_operational_provider_permission_only",
        guidanceScope,
        practicalScope,
      ])
      .nullable(),
    authoringRoute: z.literal("coordinator_chatgpt").optional(),
    sourceBinding: z
      .object({
        path: z.string(),
        hash: z.string().regex(/^[a-f0-9]{64}$/),
        notePath: z.string(),
        noteHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict()
      .optional(),
    checkedAt: z.string().datetime().nullable(),
    limitations: z.array(z.string()),
    evidence: z.array(
      z
        .object({
          kind: z.enum(["account", "integration", "provider"]),
          url: z.string().url(),
          hash: z.string().regex(/^[a-f0-9]{64}$/),
          locator: z.string().min(1),
          quote: z.string().min(1),
          applicabilityEvidence: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();
export function verifiedRightsApplicability(input: unknown, now = new Date()) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return false;
  const record = parsed.data;
  const age = record.checkedAt ? +now - Date.parse(record.checkedAt) : Infinity;
  if (record.integration === "chatgpt")
    return (
      record.status === "verified" &&
      age >= 0 &&
      age <= 90 * 86400_000 &&
      record.authoringRoute === "coordinator_chatgpt" &&
      Boolean(record.sourceBinding) &&
      (record.commercialUseScope === "chatgpt_original_operational_provider_permission_only" ||
        record.commercialUseScope === guidanceScope ||
        record.commercialUseScope === practicalScope) &&
      record.evidence.some((e) => e.url === chatGPTFAQ && e.quote === commercialQuote) &&
      [rowTerms, euTerms].every((url) =>
        record.evidence.some((e) => e.url === url && e.quote === ownershipQuote),
      ) &&
      contextTerms.every((ref) => record.evidence.some((e) => e.url === ref.url && e.quote === ref.quote))
    );
  return (
    record.status === "verified" &&
    record.accountPlan !== "unverified" &&
    Boolean(record.accountTerms) &&
    record.commercialUseScope !== null &&
    ["account", "integration", "provider"].every((k) => record.evidence.some((e) => e.kind === k)) &&
    age >= 0 &&
    age <= 90 * 86400_000
  );
}
export const chatGPTFAQ = "https://help.openai.com/en/articles/6783457-what-is-chatgpt";
const rowTerms = "https://openai.com/policies/terms-of-use/",
  euTerms = "https://openai.com/policies/eu-terms-of-use/";
const commercialQuote = "regardless of whether output was generated through a free or paid plan";
const ownershipQuote =
  "We hereby assign to you all our right, title, and interest, if any, in and to Output.";
const contextTerms = [
  {
    url: "https://openai.com/policies/service-terms/",
    quote: "ChatGPT Enterprise, Edu, Healthcare and Business",
    locator: "Service-specific terms; scope must not be inferred as an account-plan assertion",
  },
  {
    url: "https://openai.com/policies/sharing-publication-policy/",
    quote: "Content co-authored with the OpenAI API",
    locator: "Scoped publication contexts; ChatGPT prose must not be misclassified as API-authored prose",
  },
];
/** Each provider page the permission record reads, with the sentence it must hold. */
export const providerPermissionSentences: readonly { url: string; quote: string }[] = [
  { url: rowTerms, quote: ownershipQuote },
  { url: euTerms, quote: ownershipQuote },
  { url: chatGPTFAQ, quote: commercialQuote },
  ...contextTerms.map(({ url, quote }) => ({ url, quote })),
];
export const chatGPTSourcePath = "docs/content-candidates/operational-template-candidates.md";
const notePath = "docs/content-candidates/chatgpt-content-provenance-rights.md";
const termsSnapshotSchema = z
  .object({
    kind: z.literal("official_provider_terms_snapshot"),
    retrievedAt: z.string().datetime(),
    pages: z
      .array(
        z.object({ url: z.string().url(), text: z.string().min(1), truncated: z.literal(false) }).strict(),
      )
      .min(3),
  })
  .strict();
export function chatGPTPermissionRecord(
  raw: unknown,
  source: string,
  note: string,
  now = new Date(),
  binding = { path: chatGPTSourcePath, notePath, templateId: "" },
) {
  const snapshot = termsSnapshotSchema.parse(raw),
    sourceHash = sha256(source);
  // A guide's wording is bound through the manifest's guidance rows, a form's through its templates.
  const guide = guideId.test(binding.templateId);
  const practical = isPracticalGuideId(binding.templateId);
  if (practical) {
    if (
      binding.path !== practicalSourcePath ||
      binding.notePath !== practicalProvenancePath ||
      !note.split("\n").some((line) => line.includes(practicalSourcePath) && line.includes(sourceHash))
    )
      throw Error("CHATGPT_SOURCE_HASH_NOT_BOUND");
  } else if (binding.templateId) {
    const manifest = JSON.parse(note);
    const rows: { id: string; sourcePath: string; sourceSHA256: string }[] | undefined = guide
      ? manifest.guidance
      : manifest.templates;
    if (
      (!guide && !supportsOperationalInferenceTemplate(binding.templateId)) ||
      !manifest.authoring?.context?.includes("ChatGPT") ||
      manifest.authoring.upstreamProviderExecutionReceiptsRecorded !== false ||
      !rows?.some(
        (r) => r.id === binding.templateId && r.sourcePath === binding.path && r.sourceSHA256 === sourceHash,
      )
    )
      throw Error("CHATGPT_SOURCE_HASH_NOT_BOUND");
  } else {
    const boundLine = note.split("\n").find((line) => line.includes(`\`${chatGPTSourcePath}\``));
    if (!boundLine?.includes(`\`${sourceHash}\``)) throw Error("CHATGPT_SOURCE_HASH_NOT_BOUND");
  }
  const evidence = [
    { url: rowTerms, quote: ownershipQuote, locator: "Content → Ownership of content" },
    { url: euTerms, quote: ownershipQuote, locator: "Content → Ownership of content" },
    {
      url: chatGPTFAQ,
      quote: commercialQuote,
      locator: "Can I use output from ChatGPT for commercial uses?",
    },
    ...contextTerms,
  ].map((ref) => {
    const page = snapshot.pages.find((p) => p.url === ref.url);
    if (!page || !page.text.includes(ref.quote)) throw Error("CHATGPT_PROVIDER_PERMISSION_TEXT_MISSING");
    return {
      ...ref,
      kind: "provider" as const,
      hash: sha256(page.text),
      applicabilityEvidence:
        ref.url === chatGPTFAQ
          ? "Direct ChatGPT commercial-output permission, explicitly free or paid; subject to policies/terms. No copyright, exclusivity or third-party clearance guarantee."
          : ref.url === rowTerms || ref.url === euTerms
            ? "Retained regional ownership-allocation comparison, including 'if any'; NOT an assertion of user residence, governing region, negotiated account contract or business-plan indemnity."
            : ref.url.includes("service-terms")
              ? "Context and exclusions only: NOT evidence of API/Enterprise indemnity or that any named business plan governs these ChatGPT drafts."
              : "Context-specific publication requirements retained. Original attributed ChatGPT prose is NOT represented as API-authored content or human-reviewed content.",
    };
  });
  const record = schema.parse({
    version: practical
      ? "chatgpt-original-practical-article-permission-1"
      : guide
        ? "chatgpt-original-guidance-provider-permission-1"
        : "chatgpt-original-operational-provider-permission-1",
    status: "verified",
    accountPlan: "not_classified_or_required_for_documented_free_paid_output_permission",
    accountTerms: null,
    integration: "chatgpt",
    provider: "openai",
    authoringRoute: "coordinator_chatgpt",
    commercialUseScope: practical
      ? practicalScope
      : guide
        ? guidanceScope
        : "chatgpt_original_operational_provider_permission_only",
    checkedAt: snapshot.retrievedAt,
    sourceBinding: {
      path: binding.path,
      hash: sourceHash,
      notePath: binding.notePath,
      noteHash: sha256(note),
    },
    evidence,
    limitations: [
      "Provider permission is not copyright eligibility, uniqueness, exclusivity, non-infringement or third-party clearance.",
      "Regional variants are retained without claiming residence or account-contract classification.",
      "Original ChatGPT prose only; no Replit/API authoring receipt or application-code rights are inferred.",
      "Independent final-candidate checks remain mandatory. Customer licence acceptance and sales approval remain false.",
      // A guide cites official texts. The provider's terms say nothing about those.
      ...(guide
        ? [
            "This record covers Valo's own wording only. It gives no right in any official text a guide cites.",
          ]
        : []),
    ],
  });
  return { record, hash: sha256(JSON.stringify(record)), verified: verifiedRightsApplicability(record, now) };
}
export async function loadChatGPTPermission(
  snapshot: unknown,
  provenance?: {
    path: string;
    templateId: string;
    version: number;
    hash: string;
    sourceText: string;
    note: string;
    noteHash: string;
  },
) {
  const root = publicationWorkspaceRoot();
  // A guide's wording is bound to its own draft file through the intake manifest.
  if (provenance && (guideId.test(provenance.templateId) || isPracticalGuideId(provenance.templateId))) {
    const practical = isPracticalGuideId(provenance.templateId);
    const intake = practical
      ? await readPracticalGuideIntake(provenance.templateId, provenance.version)
      : await readGuidanceIntake(provenance.templateId, provenance.version);
    if (
      provenance.path !== intake.provenance.path ||
      provenance.hash !== intake.sourceHash ||
      provenance.sourceText !== intake.provenance.sourceText ||
      provenance.note !== intake.provenance.note ||
      provenance.noteHash !== intake.provenance.noteHash
    )
      throw Error("INTAKE_AUTHORING_LINEAGE_MISMATCH");
    return chatGPTPermissionRecord(snapshot, provenance.sourceText, provenance.note, new Date(), {
      path: provenance.path,
      notePath: practical
        ? practicalProvenancePath
        : "docs/content-candidates/r1-content-intake-manifest.json",
      templateId: provenance.templateId,
    });
  }
  // TPL-09 shares the legacy source file but uses the exact intake-manifest
  // lineage. Select that route by the retained note, never by source path alone.
  if (provenance && (provenance.path !== chatGPTSourcePath || provenance.note.trimStart().startsWith("{"))) {
    const intake = await readOperationalIntake(provenance.templateId, provenance.version);
    if (
      provenance.path !== intake.sourcePath ||
      provenance.hash !== intake.sourceHash ||
      provenance.sourceText !== intake.provenance.sourceText ||
      provenance.note !== intake.provenance.note ||
      provenance.noteHash !== intake.manifestHash
    )
      throw Error("INTAKE_AUTHORING_LINEAGE_MISMATCH");
    return chatGPTPermissionRecord(snapshot, provenance.sourceText, provenance.note, new Date(), {
      path: provenance.path,
      notePath: "docs/content-candidates/r1-content-intake-manifest.json",
      templateId: provenance.templateId,
    });
  }
  const source = await readFile(resolve(root, chatGPTSourcePath), "utf8"),
    note = await readFile(resolve(root, notePath), "utf8");
  if (
    provenance &&
    (provenance.hash !== sha256(source) ||
      provenance.sourceText !== source ||
      provenance.note !== note ||
      provenance.noteHash !== sha256(note))
  )
    throw Error("INTAKE_AUTHORING_LINEAGE_MISMATCH");
  return chatGPTPermissionRecord(snapshot, source, note);
}
export function assertPermissionRoute(record: { integration: string }, recordedAuthoring: boolean) {
  if (record.integration !== (recordedAuthoring ? "replit_managed_openai" : "chatgpt"))
    throw Error("AUTHORING_RIGHTS_ROUTE_MISMATCH");
}
export async function loadRightsApplicability() {
  const bytes = await readFile(
    resolve(publicationWorkspaceRoot(), "docs/valo/policies/provider-rights-applicability.json"),
  );
  const record = schema.parse(JSON.parse(bytes.toString()));
  return { record, hash: sha256(bytes), verified: verifiedRightsApplicability(record) };
}
