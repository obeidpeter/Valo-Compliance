import { resolve } from "node:path";
/** Root is supplied by the operator script, never an HTTP request. */
export function versionedEvidencePath(root: string, version: unknown) {
  const numeric = Number(version);
  if (typeof version !== "number" || !Number.isSafeInteger(numeric) || numeric < 1 || numeric > 1000000)
    throw Error("INVALID_EVIDENCE_VERSION");
  return resolve(root, `docs/valo/evidence/operational-publication-v${numeric}.json`);
}
