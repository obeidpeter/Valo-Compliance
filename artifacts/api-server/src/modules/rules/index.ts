/**
 * The rules module's public entry: the released-rule registry the checker uses, saved assessments,
 * their comparison and the admission check for a rule release. Code outside
 * artifacts/api-server/src/modules/rules imports only this file (repository rule
 * `module-boundary`); tests may import the module's files directly.
 *
 * The rule release command lives with the editorial code (src/editorial/valo-rule-release.ts),
 * because it binds sources through the editorial source storage; loading that here would load it
 * into every reader of assessments.
 */
export * from "./valo-assessments";
