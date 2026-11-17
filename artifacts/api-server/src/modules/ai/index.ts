/**
 * The AI module's public entry: the finite inference budget, its ledger and history, approved
 * manifests and allocation packages, and the dispatcher. Code outside
 * artifacts/api-server/src/modules/ai imports only this file (repository rule `module-boundary`).
 *
 * Every file re-exported here loads only Node built-ins when imported. The provider transport
 * (managed-sdk-transport.ts) is deliberately not re-exported: managed-inference.ts loads it, with
 * the database and the SDK, only when approved work runs, so disabled inference never resolves
 * it (inference-no-database.test.ts). The customer AI and operational review lanes, which call
 * the dispatcher, live outside the module, and so do the work-binding checks, which the
 * operator commands hand to the dispatcher (provideFiniteWorkBindings).
 */
export * from "./inference-allocation-package";
export * from "./inference-batch-dispatch";
export * from "./inference-budget";
export * from "./inference-budget-inspection";
export * from "./inference-budget-store";
export * from "./inference-decision-packet";
export * from "./inference-history-classification";
export * from "./inference-history-reconciliation";
export * from "./inference-manifest";
export * from "./inference-price-evidence";
export * from "./inference-types";
export * from "./inference-work-shape";
export * from "./managed-inference";
export * from "./provider-output-budget";
