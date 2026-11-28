import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { sha256 } from "@workspace/valo-core";

/**
 * A template that states the law, prepared on a real database (docs/architecture/reviewed-route.md,
 * part 4). The Data Protection Act's words are not kept in the repository, so no capture this test
 * could make holds TPL-31's passages under the checksums their record describes: what is shown here
 * is that the preparer keeps nothing it cannot bind. The template's bundle, short of a real capture,
 * is shown by the publication module's unit tests. Nothing calls a model, and nothing is released.
 */
test(
  "a template that states the law is not prepared without a current capture of each of its sources, and nothing is kept",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120_000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db } = await import("@workspace/db");
    const { prepareLawTemplateCandidate } = await import("./law-template-preparation");
    const { controlledTermsSnapshot } = await import("../publication/guidance-release.fixtures");

    const now = new Date();
    const terms = controlledTermsSnapshot(new Date(+now - 1_800_000));
    const kept = async () =>
      Number(
        (
          await db.execute<{ n: number }>(
            sql`select (select count(*) from valo_prepared_candidates where template_id = 'TPL-31')
                 + (select count(*) from valo_content_versions where template_id = 'TPL-31') as n`,
          )
        ).rows[0]!.n,
      );
    const before = await kept();

    // No capture of the Act or the directive is stored, so no sentence about the law is bound.
    await assert.rejects(
      prepareLawTemplateCandidate("TPL-31", terms, { now }),
      /^Error: TEMPLATE_HAS_NO_BOUND_SOURCE$/,
    );
    // A capture of each address whose words are not the passage's, under the checksum its record
    // describes, binds nothing either: a passage is read only from the words it was recorded as.
    const standIn = (leadId: string, text: string) => ({
      leadId,
      url: "https://ndpc.gov.ng/synthetic-stand-in.pdf",
      snapshotId: randomUUID(),
      checkedAt: new Date(+now - 3_600_000).toISOString(),
      rawChecksum: sha256(text),
      text,
    });
    await assert.rejects(
      prepareLawTemplateCandidate("TPL-31", terms, {
        now,
        captures: [
          standIn(
            "S04",
            "29.—(1) Where a data controller engages the services of a data (stand-in words) engaged data processor — processors, as the case may be. 40.—(1) Where a personal data breach has occurred (stand-in words) under this section.",
          ),
          standIn(
            "S05",
            "Article 34: Data Processing Agreement\n(1) In line with Section 29(2) (stand-in words) rebuttable proof of compliance with the\n    NDP Act.",
          ),
        ],
      }),
      /^Error: TEMPLATE_HAS_NO_BOUND_SOURCE$/,
    );
    // A template with no claim map is not this preparer's, and terms more than a day old are refused.
    await assert.rejects(prepareLawTemplateCandidate("TPL-13", terms, { now }), /TEMPLATE_CLAIM_MAP_MISSING/);
    await assert.rejects(
      prepareLawTemplateCandidate("TPL-31", controlledTermsSnapshot(new Date(+now - 2 * 86_400_000)), {
        now,
      }),
      /FRESH_ACTUAL_PROVIDER_TERMS_REQUIRED/,
    );
    assert.equal(await kept(), before, "nothing is kept as a candidate or a version");
  },
);

/**
 * The operator's own command for such a template, run as a process against the same database. Only
 * the provider's terms are stood in for, in a file. No capture holds the words of TPL-31's passages,
 * so the command has to stop and say why in words an operator can look up.
 */
test(
  "run as a process, the command for a template that states the law stops with a plain reason, and refuses a template with no claim map",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 300_000 },
  async (t) => {
    const { db } = await import("@workspace/db");
    const { controlledTermsSnapshot } = await import("../publication/guidance-release.fixtures");
    const folder = await mkdtemp(join(tmpdir(), "valo-law-template-command-"));
    t.after(() => rm(folder, { recursive: true, force: true }));
    const termsPath = join(folder, "terms.json");
    await writeFile(termsPath, JSON.stringify(controlledTermsSnapshot(new Date(Date.now() - 3_600_000))));
    const command = fileURLToPath(new URL("../../scripts/finite-inference-run.ts", import.meta.url));
    const run = (...args: string[]) =>
      spawnSync(process.execPath, ["--import", import.meta.resolve("tsx"), command, ...args], {
        encoding: "utf8",
        timeout: 120_000,
        env: { ...process.env, NODE_ENV: "development" },
      });

    const stopped = run("--prepare-law-template-candidate", "TPL-31", termsPath);
    assert.equal(stopped.status, 1, stopped.stderr);
    assert.match(stopped.stderr, /^TEMPLATE_HAS_NO_BOUND_SOURCE$/m);
    assert.doesNotMatch(stopped.stderr, /FINITE_INFERENCE_RUN_FAILED/);
    assert.equal(stopped.stdout, "", "nothing is reported as prepared");

    // A template with no claim map, and a call without the terms file, are refused as arguments.
    for (const args of [["TPL-13", termsPath], ["TPL-31"]]) {
      const refused = run("--prepare-law-template-candidate", ...args);
      assert.equal(refused.status, 1, refused.stderr);
      assert.match(refused.stderr, /^FINITE_RUN_ARGUMENTS_INVALID$/m);
      assert.equal(refused.stdout, "");
    }
    const kept = await db.execute<{ n: number }>(
      sql`select (select count(*) from valo_prepared_candidates where template_id = 'TPL-31')
           + (select count(*) from valo_content_versions where template_id = 'TPL-31') as n`,
    );
    assert.equal(Number(kept.rows[0]!.n), 0, "nothing is kept as a candidate or a version");
  },
);
