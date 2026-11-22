import { checkManualRegulatorySources, manualGuidanceIds } from "../modules/manual-guidance";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

async function main() {
  assertDevelopmentRuntime();
  const args = process.argv.slice(2);
  const ids = args.length === 1 && args[0] === "--all" ? manualGuidanceIds : args;
  if (!ids.length || ids.some((id) => !manualGuidanceIds.includes(id)))
    throw new Error("Use --all or the registered GUD identifiers.");
  const { pool } = await import("@workspace/db");
  try {
    console.log(JSON.stringify(await checkManualRegulatorySources(ids)));
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Regulatory source check failed.");
  process.exitCode = 1;
});
