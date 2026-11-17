/**
 * Creates the first permanent system administrator, once, with an audited role change.
 *
 *   VALO_STAFF_BOOTSTRAP=first-system-administrator \
 *     node dist/staff-bootstrap.mjs <user_id> <operator-label> "<reason, 20+ characters>"
 *
 * Refuses when a permanent system administrator already exists; later grants go
 * through staff role administration. The account must be an active managed account
 * with a verified primary email.
 */
import { pool } from "@workspace/db";
import { bootstrapFirstSystemAdministrator } from "../lib/valo-staff-roles";
import { ValoProblem } from "../lib/valo-problem";
import { setting } from "../platform/settings";

const [identityId, operator, reason] = process.argv.slice(2);
try {
  if (setting("VALO_STAFF_BOOTSTRAP") !== "first-system-administrator")
    throw new ValoProblem(
      412,
      "Set VALO_STAFF_BOOTSTRAP=first-system-administrator to confirm this one-time action.",
    );
  if (!identityId || !operator || !reason)
    throw new ValoProblem(422, "Usage: staff-bootstrap <user_id> <operator> <reason>");
  const receipt = await bootstrapFirstSystemAdministrator({ identityId, operator, reason });
  process.stdout.write(`${JSON.stringify({ bootstrapped: true, receipt })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof ValoProblem ? error.message : "STAFF_BOOTSTRAP_FAILED"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
