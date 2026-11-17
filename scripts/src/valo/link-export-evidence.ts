import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../", import.meta.url);
const path = "docs/valo/evidence/part5-export-checks.json";
const text = await readFile(new URL(path, root), "utf8");
const report = JSON.parse(text);
for (const name of ["part5-foundation", "part5-api-unit", "part5-database", "part5-exports-integration"]) {
  const log = report.rawLogs[name];
  if (typeof log !== "string" || !/ℹ fail 0\b/.test(log) || !/ℹ skipped 0\b/.test(log))
    throw new Error("Missing real passing development log: " + name);
}
const data = {
  ids: ["EDT-006", "EDT-007", "EDT-008", "EDT-009", "SEC-001", "SEC-004", "OPS-002", "OPS-003", "OPS-007"],
  record: { kind: "test", path, hash: createHash("sha256").update(text).digest("hex"), result: "pass" },
};
const output = `/** Actual partial development test evidence. Does not clear any requirement blocker. */
export const partialExportEvidence: {
  ids: readonly string[];
  record: { kind:"test";path:string;hash:string;result:"pass"|"not_run" };
} = ${JSON.stringify(data, null, 2)};
`;
await writeFile(new URL("lib/valo-core/src/export-evidence.generated.ts", root), output);
console.log("Linked actual partial export test evidence to nine blocked requirements; no gate accepted.");
