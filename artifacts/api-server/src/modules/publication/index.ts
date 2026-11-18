/**
 * The publication module's public entry: the operational publication policy and its restrictions,
 * release artifacts, intake and content of original operational templates, their mechanical, export,
 * rights and final checks, and the publisher that releases a reviewed version. Code outside
 * artifacts/api-server/src/modules/publication imports only this file (repository rule `module-boundary`);
 * tests may import the module's files directly.
 *
 * Used only inside the module, and not re-exported: claim-locator.ts, operational-restrictions.ts, publication-final-check.ts.
 */
export * from "./candidate-arithmetic";
export * from "./operational-authoring-contract";
export * from "./operational-content";
export * from "./operational-export-inspection";
export * from "./operational-intake";
export * from "./operational-mechanical";
export * from "./operational-policy";
export * from "./operational-read-permission";
export * from "./operational-review-contract";
export * from "./original-content-adapter";
export * from "./publication-artifacts";
export * from "./publication-publisher";
export * from "./rights-applicability";
