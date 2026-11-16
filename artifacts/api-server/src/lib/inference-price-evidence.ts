import { createHash } from "node:crypto";
/** Policy basis checked against retained official documentation on 2026-11-15.
 * This is text-inference pricing for the named managed route, not an invoice,
 * credits guarantee, arbitrary model tariff, tax or whole-project spend cap. */
export const managedPriceEvidence = {
  version: "official-model-and-managed-docs-2026-11-15",
  model: "gpt-5.4-mini",
  route: "replit-managed-openai-chat-completions",
  inputNanoUsdPerToken: 750,
  outputNanoUsdPerToken: 4500,
  upliftBps: 1000,
  contextTokens: 400000,
  completionTokens: 8192,
  completions: 1,
  tools: false,
  automaticRetries: 0,
  sources: [
    {
      url: "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
      path: "docs/valo/evidence/inference-price-model-source.md",
      sha256: "4d5b9f2abdcaee7af69ac8dae12182ff6d4e791493d4f787b83a5120e7c0ca8f",
      locators: [
        "400,000 context window",
        "$0.75",
        "$4.50",
        "Regional processing (data residency) endpoints are charged a 10% uplift",
      ],
    },
    {
      url: "https://docs.replit.com/features/integrations/replit-ai-integrations",
      path: "docs/valo/evidence/inference-price-managed-source.md",
      sha256: "2db09350c0f2539de97bd221539569c7a04b12acfded2845fb9b5b21098f39f5",
      locators: ["bills you at the public API price"],
      snapshot: "excerpt from retrieved markdown; irrelevant page serialization omitted",
    },
  ],
} as const;
export const managedPriceEvidenceDigest = createHash("sha256")
  .update(JSON.stringify(managedPriceEvidence))
  .digest("hex");
export function assertManagedRatePolicy(policy: {
  model: string;
  priceEvidenceVersion: string;
  priceEvidenceDigest: string;
  inputNanoUsdPerToken: number;
  outputNanoUsdPerToken: number;
  upliftBps: number;
  fallback: { inputTokens: number; outputTokens: number };
}) {
  const e = managedPriceEvidence;
  if (
    policy.model !== e.model ||
    policy.priceEvidenceVersion !== e.version ||
    policy.priceEvidenceDigest !== managedPriceEvidenceDigest ||
    policy.inputNanoUsdPerToken !== e.inputNanoUsdPerToken ||
    policy.outputNanoUsdPerToken !== e.outputNanoUsdPerToken ||
    policy.upliftBps !== e.upliftBps ||
    policy.fallback.inputTokens !== e.contextTokens ||
    policy.fallback.outputTokens !== e.completionTokens
  )
    throw Error("INFERENCE_PRICE_POLICY_UNSUPPORTED");
}
