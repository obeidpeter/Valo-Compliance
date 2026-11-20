import { pool } from "@workspace/db";
import { collectOperationalSample, recordOperationalAlerts } from "../modules/operations";
import { logger } from "../platform/logger";
try {
  const sample = await collectOperationalSample((text) => {
    const config = { text, query_timeout: 1500 };
    return pool.query(config);
  });
  const alerts = await recordOperationalAlerts(sample);
  logger.info({
    event: "operations.probe",
    sample,
    alerts,
    externalMessagesSent: 0,
    productionReadiness: false,
    retention35Days: "unresolved",
  });
  if (alerts.active.length) process.exitCode = 1;
} finally {
  await pool.end();
}
