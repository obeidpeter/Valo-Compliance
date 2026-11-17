import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { db, pool, valoSourceSnapshots } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { probePrivateSource } from "./source-storage";
import { sourceEvidenceRegister } from "./source-register";
if (
  process.env.NODE_ENV !== "development" ||
  process.env.VALO_RUN_SOURCE_TESTS !== "official-development-only"
)
  throw Error("Explicit development source test acknowledgement required");
test("authoritative instrument capture and privacy proof, not legal approval", async (t) => {
  try {
    const evidence = JSON.parse(
      await readFile(
        new URL("../../../../docs/valo/evidence/coordinating-instrument-retrieval.json", import.meta.url),
        "utf8",
      ),
    );
    await t.test(
      "CAC body identity cannot be replaced by misleading metadata; raw and text hashes round trip privately",
      async () => {
        const [row] = await db
          .select()
          .from(valoSourceSnapshots)
          .where(eq(valoSourceSnapshots.sourceId, "SV-010"))
          .orderBy(desc(valoSourceSnapshots.attemptedAt))
          .limit(1);
        assert.ok(row);
        assert.equal(row.status, "retrieved_unreviewed");
        assert.ok(row.rawChecksum);
        assert.ok(row.textChecksum);
        const recorded = evidence.records.find((r: { sourceId: string }) => r.sourceId === "SV-010");
        assert.equal(row.rawChecksum, recorded.rawChecksum);
        assert.equal(row.textChecksum, recorded.textChecksum);
        const identity = row.metadata.identity as {
          status: string;
          metadataConflict: boolean;
          warning: string | null;
        };
        assert.equal(identity.status, "content_title_present_unreviewed");
        if (identity.metadataConflict) assert.match(identity.warning!, /metadata/i);
        for (const [kind, hash] of [
          ["raw", row.rawChecksum],
          ["text", row.textChecksum],
        ] as const) {
          const check = await probePrivateSource(row.id, kind, hash);
          assert.equal(check.authorizedChecksumMatched, true);
          assert.ok([403, 404].includes(check.anonymousStatus));
        }
      },
    );
    await t.test(
      "NRS failure remains held; a successful retry must have actual immutable bytes and text",
      async () => {
        const register = await sourceEvidenceRegister(),
          nrs = register.references.find((r) => r.id === "S02")!;
        const recorded = evidence.records.find((r: { sourceId: string }) => r.sourceId === "S02");
        assert.equal(nrs.status, recorded.status);
        assert.equal(nrs.publication, "held");
        assert.equal(nrs.aiReviewedAt, null);
        assert.equal(nrs.sourceCheckedAt, null);
        if (nrs.status === "retrieved_unreviewed") {
          assert.ok(nrs.rawStored && nrs.textStored);
          assert.ok(recorded.bytes > 8 * 1024 * 1024);
          const [row] = await db
            .select()
            .from(valoSourceSnapshots)
            .where(eq(valoSourceSnapshots.sourceId, "S02"))
            .orderBy(desc(valoSourceSnapshots.attemptedAt))
            .limit(1);
          assert.ok(row?.rawChecksum);
          const check = await probePrivateSource(row.id, "raw", row.rawChecksum);
          assert.equal(check.authorizedChecksumMatched, true);
          assert.ok([403, 404].includes(check.anonymousStatus));
        } else {
          assert.match(nrs.status, /^held_/);
          assert.ok(nrs.failureCode);
        }
      },
    );
    await t.test(
      "team observations and receipts cannot become publication or disclose private object keys",
      async () => {
        const register = await sourceEvidenceRegister();
        assert.equal(register.references.length, 28);
        assert.equal(
          register.references.reduce((n, r) => n + r.coordinatingNotes.length, 0),
          14,
        );
        assert.ok(register.references.every((r) => r.publication === "held" && r.aiReviewedAt === null));
        assert.equal(register.references.find((r) => r.id === "SV-003")!.status, "not_attempted");
        assert.doesNotMatch(
          JSON.stringify(register),
          /rawObjectKey|textObjectKey|storage\.googleapis\.com|PRIVATE_OBJECT_DIR/,
        );
      },
    );
  } finally {
    await pool.end();
  }
});
