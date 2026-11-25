/**
 * The rules module's public entry: the released-rule registry the checker uses, saved assessments,
 * their comparison and the admission check for a rule release. Code outside
 * artifacts/api-server/src/modules/rules imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 *
 * The rule release command lives in the editorial module (modules/editorial/valo-rule-release.ts),
 * because it binds sources through the sources module's storage; loading that here would load it
 * into every reader of assessments.
 */
export * from "./valo-assessments";
export { listRuleNotices, markRuleNoticeRead } from "./rule-notices";
