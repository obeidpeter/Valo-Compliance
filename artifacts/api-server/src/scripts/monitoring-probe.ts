import { externalMonitorConfiguration, pingExternalMonitor } from "../platform/valo-external-monitor";
import { setting } from "../platform/settings";
try {
  if (setting("VALO_MONITORING_PROBE") !== "synthetic-notification-only")
    throw Error("EXPLICIT_MONITORING_PROBE_REQUIRED");
  const [check, state, ...extra] = process.argv.slice(2);
  if (
    extra.length ||
    (check !== "worker" && check !== "operations") ||
    (state !== "success" && state !== "failure")
  )
    throw Error("MONITORING_PROBE_ARGUMENTS_INVALID");
  const config = externalMonitorConfiguration();
  if (!config) throw Error("EXTERNAL_MONITOR_UNCONFIGURED");
  const providerAcknowledged = await pingExternalMonitor(config, check, state === "success");
  console.log(
    JSON.stringify({
      check,
      state,
      providerAcknowledged,
      notificationDeliveryProved: false,
      scope:
        "operator-requested synthetic signal; confirm the actual recipient received failure and recovery notifications",
    }),
  );
  if (!providerAcknowledged) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error ? error.message : "";
  console.error(
    [
      "EXPLICIT_MONITORING_PROBE_REQUIRED",
      "MONITORING_PROBE_ARGUMENTS_INVALID",
      "EXTERNAL_MONITOR_UNCONFIGURED",
      "EXTERNAL_MONITOR_CONFIGURATION_INVALID",
    ].includes(code)
      ? code
      : "MONITORING_PROBE_FAILED",
  );
  process.exitCode = 1;
}
