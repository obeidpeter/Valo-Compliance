/**
 * Requirement and evidence bookkeeping: the formal requirements and their source text, how each
 * is traced to implementation and evidence, readiness, the partial evidence bindings, the
 * acceptance work items and the handover checkpoint. None of it accepts a requirement. Product
 * logic lives in @workspace/valo-core; the API reads this package only to report status.
 */
export * from "./traceability";
export * from "./acceptance-work-items";
export { handoverCheckpoint } from "./handover.generated";
