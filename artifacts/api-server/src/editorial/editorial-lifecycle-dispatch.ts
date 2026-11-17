import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createLifecycleSandbox, lifecycleSeedUrl } from "./editorial-lifecycle-sandbox";
import { environment, setting } from "../platform/settings";
const execute = promisify(execFile);
export const lifecycleCaseIds = [46, 47, 48, 49, 50, 55, 56, 57, 58, 59].map(
  (n) => `EVAL-EDP-C${String(n).padStart(3, "0")}`,
);
export type LifecycleResult = {
  status: "control_pass" | "blocked" | "fail";
  reason?: string;
  baselineId?: string;
  boundaryEvidence?: Record<string, unknown>;
  formalCaseAccepted: false;
  actualProviderCalls: 0;
};
/** Default execution is concrete: clone a prepared genuine local seed, run the
 * actual publisher/monitor/download paths in a child, then remove only the clone.
 * Missing genuine isolated evidence remains a prerequisite hold, never a pass. */
export async function dispatchEditorialLifecycle(
  caseId: string,
  evaluationRunId: string,
): Promise<LifecycleResult> {
  if (!lifecycleCaseIds.includes(caseId) || !/^[a-f0-9-]{36}$/.test(evaluationRunId))
    throw Error("UNKNOWN_LIFECYCLE_CASE");
  const common = { formalCaseAccepted: false as const, actualProviderCalls: 0 as const };
  if (setting("NODE_ENV") !== "development" || setting("REPLIT_DEPLOYMENT"))
    throw Error("DEVELOPMENT_LIFECYCLE_ONLY");
  let seed: URL;
  try {
    seed = lifecycleSeedUrl(setting("VALO_EDITORIAL_LIFECYCLE_DATABASE_URL"), setting("DATABASE_URL"));
  } catch (error) {
    return { ...common, status: "blocked", reason: (error as Error).message };
  }
  const sandbox = await createLifecycleSandbox(seed.href, setting("DATABASE_URL"));
  try {
    const { stdout } = await execute(
      process.execPath,
      [
        "--import",
        import.meta.resolve("tsx"),
        fileURLToPath(new URL("../scripts/editorial-lifecycle-case.ts", import.meta.url)),
        caseId,
        evaluationRunId,
      ],
      {
        cwd: process.cwd(),
        env: {
          ...environment(),
          DATABASE_URL: sandbox.url,
          VALO_EDITORIAL_LIFECYCLE_DATABASE_URL: undefined,
        },
        timeout: 120000,
        killSignal: "SIGKILL",
        maxBuffer: 128 * 1024,
      },
    );
    const result = JSON.parse(stdout.trim()) as LifecycleResult;
    if (
      !["control_pass", "blocked", "fail"].includes(result.status) ||
      result.formalCaseAccepted !== false ||
      result.actualProviderCalls !== 0
    )
      throw Error("LIFECYCLE_RESULT_CONTRACT_INVALID");
    return result;
  } catch {
    return { ...common, status: "fail", reason: "ISOLATED_LIFECYCLE_PROCESS_FAILED_NO_SUCCESS_INFERRED" };
  } finally {
    await sandbox.close();
  }
}
