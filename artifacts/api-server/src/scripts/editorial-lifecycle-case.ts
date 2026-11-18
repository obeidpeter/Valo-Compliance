import { pool } from "@workspace/db";
import { runEditorialLifecycle } from "../modules/editorial";
try {
  process.stdout.write(
    JSON.stringify(await runEditorialLifecycle(process.argv[2]!, process.argv[3]!)) + "\n",
  );
} catch {
  process.stdout.write(
    JSON.stringify({
      status: "fail",
      reason: "LIFECYCLE_SANDBOX_INVALID",
      formalCaseAccepted: false,
      actualProviderCalls: 0,
    }) + "\n",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
