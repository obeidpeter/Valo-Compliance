/** Runtime capability, separate from the frozen 108-item financial scope.
 * These original blank forms have current intake, permission and arithmetic
 * contracts. Every saved candidate still needs its own actual evidence gates.
 * Numeric forms have exact-expression validators. This is preparation
 * capability, not publication, a paid-call approval or an entitlement. */
export const operationalInferenceTemplateIds = [
  "TPL-01",
  "TPL-02",
  "TPL-03",
  "TPL-04",
  "TPL-05",
  "TPL-06",
  "TPL-07",
  "TPL-08",
  "TPL-09",
  "TPL-10",
  "TPL-11",
  "TPL-12",
  "TPL-22",
  "TPL-24",
  "TPL-34",
  "TPL-35",
  "TPL-38",
] as const;
export function supportsOperationalInferenceTemplate(id: string): boolean {
  return (operationalInferenceTemplateIds as readonly string[]).includes(id);
}
