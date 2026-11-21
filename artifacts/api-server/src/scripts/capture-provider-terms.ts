import { writeFile } from "node:fs/promises";
import { captureProviderTerms } from "../modules/publication";
import { assertDevelopmentRuntime } from "../platform/valo-development-runtime";

/**
 * Operator command, development only. Fetches the AI provider's five public pages on output
 * ownership and use, and writes the copy a candidate's preparation reads:
 *
 *   NODE_ENV=development tsx src/scripts/capture-provider-terms.ts <terms.json>
 *
 * The copy is good for one day. The command refuses to write it if a page no longer holds the
 * sentence the permission record looks for. It never overwrites a file, calls no AI model and
 * decides nothing about rights.
 */
async function main() {
  assertDevelopmentRuntime();
  const [out, ...extra] = process.argv.slice(2);
  if (!out || out.startsWith("--") || extra.length) throw Error("CAPTURE_PROVIDER_TERMS_ARGUMENTS_INVALID");
  const { snapshot, read } = await captureProviderTerms();
  await writeFile(out, `${JSON.stringify(snapshot)}\n`, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({ written: out, retrievedAt: snapshot.retrievedAt, pages: read, providerCalls: 0 }),
  );
}
try {
  await main();
} catch (error) {
  console.error(
    error instanceof Error && /^[A-Z_0-9]{3,80}(?::\S{1,200})?$/.test(error.message)
      ? error.message
      : "CAPTURE_PROVIDER_TERMS_FAILED",
  );
  process.exitCode = 1;
}
