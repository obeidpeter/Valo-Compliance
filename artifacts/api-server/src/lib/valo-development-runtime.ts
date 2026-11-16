import { environment } from "../platform/settings";
/** Approval boundary, not an environment-name heuristic. No environment values
 * are included in errors/logs. Whitespace and "0"/"false" are nonempty markers. */
export const deployedEnvironmentMarkers = [
  "REPLIT_DEPLOYMENT",
  "REPLIT_DEPLOYMENT_ID",
  "REPLIT_DEPLOYMENT_TYPE",
  "REPLIT_DEPLOYMENT_REGION",
] as const;
export function assertDevelopmentRuntime(env: Record<string, string | undefined> = environment()): void {
  if (
    env.NODE_ENV !== "development" ||
    Object.keys(env).some(
      (k) => (k === "REPLIT_DEPLOYMENT" || k.startsWith("REPLIT_DEPLOYMENT_")) && Boolean(env[k]?.length),
    )
  )
    throw Object.assign(new Error("Explicit non-deployed development is required"), {
      code: "DEVELOPMENT_RUNTIME_REQUIRED",
    });
}
