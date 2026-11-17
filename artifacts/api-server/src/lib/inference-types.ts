/**
 * Types shared by the finite inference modules: requests, completions, work items and
 * manifests. Types only, with no runtime code, so the dispatcher, transport, manifests
 * and lane modules can share them without importing one another.
 */
import type { BudgetLane, additionalInferenceAllocation } from "./inference-budget";

export type ManagedRequest = {
  model: string;
  max_completion_tokens?: number;
  messages: readonly unknown[];
  response_format?: unknown;
  stream?: boolean;
  tools?: unknown[];
  n?: number;
  tool_choice?: unknown;
};
export type ManagedCompletionResult = {
  id: string;
  model: string;
  created: number;
  _request_id?: string | null;
  choices: { finish_reason: string | null; message: { content: string | null } }[];
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | undefined;
};
export type FiniteWork = {
  key: string;
  lane: BudgetLane;
  role: "factual" | "challenge" | "customer";
  pair: string | null;
  retryOf?: string;
  candidateHash: string;
  sourceHashes: string[];
  caseHash: string;
  request: ManagedRequest;
  bindings: {
    candidateVersionId: string | null;
    corpus: "editorial" | "checker" | "customer-ai" | null;
    caseId: string | null;
    sourceFiles: { path: string; sha256: string }[];
    historicalCutoff?: string;
    operationalPlan?: { id: string; hash: string; extension: "json" };
    customerPlan?: { id: string; hash: string; extension: "json" };
  };
};
export type FiniteManifest = {
  version: 2;
  policyVersion: string;
  preparedAt: string;
  allocation: typeof additionalInferenceAllocation;
  packageId?: string | undefined;
  works: FiniteWork[];
};
export type CompletionTransport = (
  request: ManagedRequest,
  options: {
    timeout: number;
    maxRetries: 0;
    beforeOutbound?: (() => Promise<void>) | undefined;
    onOutbound?: (() => void) | undefined;
  },
) => Promise<ManagedCompletionResult>;
