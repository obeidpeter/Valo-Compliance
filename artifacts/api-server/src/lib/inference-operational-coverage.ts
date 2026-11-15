/** Runtime capability, separate from the frozen 108-item financial scope.
 * These original blank forms have current intake, permission and arithmetic
 * contracts. Every saved candidate still needs its own actual evidence gates.
 * TPL-12's formula and all wider content routes remain unsupported here. */
export const operationalInferenceTemplateIds = [
  "TPL-01", "TPL-02", "TPL-03", "TPL-04", "TPL-05", "TPL-06",
  "TPL-07", "TPL-08", "TPL-09", "TPL-10", "TPL-11",
] as const;
export function supportsOperationalInferenceTemplate(id:string):boolean {
  return (operationalInferenceTemplateIds as readonly string[]).includes(id);
}
