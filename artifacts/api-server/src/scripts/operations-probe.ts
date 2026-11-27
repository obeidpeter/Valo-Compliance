import { pool } from "@workspace/db";
import {
  collectOperationalSample,
  copyAlertChanges,
  publishAlertChanges,
  recordOperationalAlerts,
} from "../modules/operations";
import { logger } from "../platform/logger";
try {
  const sample = await collectOperationalSample((text) => {
    const config = { text, query_timeout: 1500 };
    return pool.query(config);
  });
  const alerts = await recordOperationalAlerts(sample);
  // Staff read the alerts from the database's journal (docs/architecture/alerts.md, part 1).
  const copy = await copyAlertChanges(publishAlertChanges);
  logger.info({
    event: "operations.probe",
    sample,
    alerts,
    alertJournalBehind: copy.behind,
    alertJournalLost: copy.lost,
    ...(copy.behind > 0 ? { err: copy.error } : {}),
    externalMessagesSent: 0,
    productionReadiness: false,
    retention35Days: "unresolved",
  });
  if (alerts.active.length) process.exitCode = 1;
} finally {
  await pool.end();
}
