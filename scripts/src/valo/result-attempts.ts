import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Each CI job uploads its test results as `test-results-<job>-attempt-<n>`, n being the run
 * attempt. When failed jobs are re-run, the evidence job downloads every attempt's upload into a
 * folder of its own, and a job's latest attempt is the one that counts: an earlier attempt that
 * was cancelled, or failed and was re-run, neither hides the new results nor adds to them. A job
 * that was not re-run keeps the upload of the attempt it ran in.
 */
export const RESULT_ARTIFACT = /^test-results-(.+)-attempt-(\d+)$/;

/** The artifact name a job's upload step uses, as the workflow writes it. */
export const resultArtifactName = (job: string) => `test-results-${job}-attempt-\${{ github.run_attempt }}`;

/**
 * Every file under `directory` whose name `accept` takes, leaving out each job's superseded
 * attempts. Folders that are not attempt uploads, such as a job's own results folder, are read
 * whole.
 */
export function currentResultFiles(directory: string, accept: (name: string) => boolean): string[] {
  if (!existsSync(directory)) return [];
  const entries = readdirSync(directory, { withFileTypes: true });
  const attempt = (name: string, isDirectory: boolean) => (isDirectory ? RESULT_ARTIFACT.exec(name) : null);
  const latest = new Map<string, number>();
  for (const entry of entries) {
    const match = attempt(entry.name, entry.isDirectory());
    if (match) latest.set(match[1]!, Math.max(latest.get(match[1]!) ?? 0, Number(match[2])));
  }
  const files: string[] = [];
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (accept(entry.name)) files.push(path);
    }
  };
  for (const entry of entries) {
    const path = join(directory, entry.name);
    const match = attempt(entry.name, entry.isDirectory());
    if (match && Number(match[2]) !== latest.get(match[1]!)) continue;
    if (entry.isDirectory()) walk(path);
    else if (accept(entry.name)) files.push(path);
  }
  return files.sort();
}
