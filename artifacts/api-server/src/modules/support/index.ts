/**
 * The support module's public entry: support tickets, the intake that opens a support case from a
 * ticket or an access or privacy request, support cases, their messages, staff assignment,
 * escalations and their lifecycle. Code outside artifacts/api-server/src/modules/support imports
 * only this file (repository rule `module-boundary`); tests may import the module's files directly.
 */
export * from "./valo-support-lifecycle";
export * from "./valo-support-tickets";
export * from "./valo-support-intake";
export { ownerRuleReferrals } from "./valo-support-triage";
