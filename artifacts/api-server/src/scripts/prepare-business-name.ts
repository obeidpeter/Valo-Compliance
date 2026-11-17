import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { and, eq } from "drizzle-orm";
import { db, pool, valoSourceSnapshots } from "@workspace/db";
import { readSourceText, probePrivateSource } from "../editorial/source-storage";
import { buildBusinessNameEvidence, type CapturedText } from "../editorial/business-name-evidence";

if (
  process.env.NODE_ENV !== "development" ||
  process.env.VALO_RUN_SOURCE_RETRIEVAL !== "official-development-only"
)
  throw Error("Explicit development source acknowledgement required");
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const retrieval = JSON.parse(
  await readFile(root + "generated-artifacts/valo-business-name/retrieval.json", "utf8"),
);
try {
  const inputs: CapturedText[] = [];
  const storageChecks = [];
  for (const record of retrieval.records) {
    const [row] = await db
      .select()
      .from(valoSourceSnapshots)
      .where(and(eq(valoSourceSnapshots.id, record.id), eq(valoSourceSnapshots.sourceId, record.sourceId)));
    if (
      !row ||
      row.status !== "retrieved_unreviewed" ||
      !row.textChecksum ||
      !row.rawChecksum ||
      row.textChecksum !== record.textChecksum ||
      !row.fetchedAt
    )
      throw Error("SOURCE_CAPTURE_NOT_ELIGIBLE_FOR_PREPARATION");
    inputs.push({
      id: row.id,
      sourceId: record.sourceId,
      textChecksum: row.textChecksum,
      fetchedAt: row.fetchedAt.toISOString(),
      text: await readSourceText(row.id, row.textChecksum),
    });
    for (const kind of ["raw", "text"] as const) {
      const probe = await probePrivateSource(
        row.id,
        kind,
        kind === "raw" ? row.rawChecksum : row.textChecksum,
      );
      if (![401, 403, 404].includes(probe.anonymousStatus)) throw Error("SOURCE_PRIVATE_ACCESS_UNPROVED");
      storageChecks.push({ sourceId: row.sourceId, kind, ...probe });
    }
  }
  const bundle = buildBusinessNameEvidence(inputs);
  const dir = root + "docs/valo/evidence/business-name";
  await mkdir(dir, { recursive: true });
  await writeFile(dir + "/retrieval.json", JSON.stringify(retrieval, null, 2) + "\n");
  await writeFile(dir + "/candidate.json", JSON.stringify(bundle, null, 2) + "\n");
  await writeFile(
    dir + "/private-storage.json",
    JSON.stringify({ checks: storageChecks, checkedAt: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(
    JSON.stringify({
      candidate: bundle.candidateId,
      hash: bundle.bundleHash,
      privateSources: inputs.length,
      passageChecks: bundle.checks.passages,
      publication: bundle.publication,
    }),
  );
} finally {
  await pool.end();
}
