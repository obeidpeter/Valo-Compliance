import { initializeApplicationRuntime } from "../platform/valo-runtime-activation";
import { productionPreflight } from "../platform/valo-production-readiness";
import { environment } from "../platform/settings";
const args = process.argv.slice(2);
if (
  args.length > 1 ||
  (args.length === 1 && !["--configuration-only", "--activate-rehearsal"].includes(args[0]!))
) {
  console.error("USAGE: production-preflight [--configuration-only|--activate-rehearsal]");
  process.exitCode = 1;
} else {
  const report = productionPreflight(environment());
  console.log(JSON.stringify(report, null, 2));
  // Default invocation remains nonzero while launch evidence/approval is absent.
  if (args[0] === "--activate-rehearsal") {
    try {
      await initializeApplicationRuntime();
      console.log(JSON.stringify({ runtimeReady: true, launchReady: false, customerTrafficEnabled: false }));
    } catch {
      console.error("PRODUCTION_REHEARSAL_PREFLIGHT_FAILED");
      process.exitCode = 1;
    }
  } else process.exitCode = report.configurationValid ? (args[0] === "--configuration-only" ? 0 : 2) : 1;
}
