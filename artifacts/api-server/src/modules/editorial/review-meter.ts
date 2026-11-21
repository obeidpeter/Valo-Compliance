import { digest } from "@workspace/valo-core";
/** Text-only request bound: UTF-8 bytes plus explicit protocol allowance.
 * This is conservative preflight accounting, NOT provider tokenisation,
 * a managed-gateway tariff, a credit balance or a hard monetary ceiling. */
export function meterReviewRequest(request: unknown) {
  const serialized = JSON.stringify(request);
  const wireBytes = Buffer.byteLength(serialized, "utf8"),
    protocolAllowance = 1024;
  const conservativeInputTokenBound = wireBytes + protocolAllowance;
  return {
    requestHash: digest(request),
    wireBytes,
    protocolAllowance,
    conservativeInputTokenBound,
    inputCeiling: 32000,
    maximumCompletionTokens: 8192,
    withinInputCeiling: conservativeInputTokenBound <= 32000,
    method: "UTF8_bytes_plus_protocol_allowance_not_actual_provider_usage",
    actualInputTokens: null,
    actualOutputTokens: null,
    actualBilling: null,
  };
}
export function providerUsage(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined) {
  const count = (v: unknown) => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
  return {
    inputTokens: count(usage?.prompt_tokens),
    outputTokens: count(usage?.completion_tokens),
    actualBilling: null,
  };
}
