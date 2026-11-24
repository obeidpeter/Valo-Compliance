import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// OPS-005 accepts "the release identifies commit, migration, content/rule versions and known issues."
test(
  "the release record names the commit, the migrations shipped and applied, every content and rule version and the known issues",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60000 },
  async () => {
    const { pool } = await import("@workspace/db");
    const { buildReleaseRecord } = await import("./valo-release-record");
    const { financeHeldFixture } = await import("../modules/commerce/valo-finance-test-fixture");
    const root = fileURLToPath(new URL("../../../../", import.meta.url));
    const journalPath = join(root, "lib/db/drizzle/meta/_journal.json"),
      knownIssuesPath = join(root, "docs/valo/known-issues.json");
    const temp = await mkdtemp(join(tmpdir(), "valo-release-record-"));
    try {
      const held = await financeHeldFixture();
      const releaseSha = "a".repeat(40);
      const record = await buildReleaseRecord(pool, { releaseSha, journalPath, knownIssuesPath });
      const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
        entries: { idx: number; when: number; tag: string }[];
      };
      const latest = journal.entries.at(-1)!;
      assert.equal(record.releaseSha, releaseSha);
      assert.deepEqual(record.migrations.shipped, { count: journal.entries.length, latest: latest.tag });
      // This job applies every tracked migration before its tests run.
      assert.deepEqual(record.migrations.applied, {
        count: journal.entries.length,
        latest: latest.tag,
        matchesShipped: true,
      });

      // Every content and rule version, with its status: the held fixture is named as held.
      const content = (
        await pool.query("select id, status from valo_content_versions order by template_id, version")
      ).rows;
      assert.deepEqual(
        record.content.map((c) => [c.versionId, c.status]),
        content.map((r) => [r.id, r.status]),
      );
      assert.ok(
        record.content.some((c) => c.versionId === held.id && c.status === "held" && c.publishedAt === null),
      );
      // Each rule version says how it was released: on the reviewed route or the owner's sign-off.
      const rules = (
        await pool.query(
          "select id, status, rule->>'provenance' as provenance from valo_rule_releases order by rule_id, version",
        )
      ).rows;
      assert.deepEqual(
        record.rules.map((r) => [r.releaseId, r.status, r.provenance]),
        rules.map((r) => [r.id, r.status, r.provenance]),
      );

      // Every staff library version too (decision 0018). A synthetic Content editor's draft is saved
      // in a transaction that is rolled back, so no later test sees it; the record names it by its
      // identity, state and digest, and never by its text.
      const client = await pool.connect();
      try {
        await client.query("begin");
        const editor = `synthetic-release-editor-${randomUUID()}`,
          itemId = randomUUID(),
          draftId = randomUUID();
        await client.query(
          "insert into valo_staff_assignments(id, identity_id, role, granted_by, reason) values ($1, $2, 'content', 'synthetic test', 'Synthetic release record test')",
          [randomUUID(), editor],
        );
        await client.query(
          "insert into valo_manual_library(id, item_id, version, slug, kind, title, body, digest, created_by) values ($1, $2, 1, $3, 'practical_guide', 'Synthetic release-record draft', 'Synthetic draft body for the release record.', $4, $5)",
          [draftId, itemId, `manual-${itemId}`, "c".repeat(64), editor],
        );
        const withDraft = await buildReleaseRecord(client, { releaseSha, journalPath, knownIssuesPath });
        const library = (
          await client.query("select id, state from valo_manual_library order by item_id, version")
        ).rows;
        assert.deepEqual(
          withDraft.library.map((l) => [l.versionId, l.state]),
          library.map((r) => [r.id, r.state]),
        );
        assert.deepEqual(
          withDraft.library.find((l) => l.versionId === draftId),
          {
            versionId: draftId,
            itemId,
            version: 1,
            kind: "practical_guide",
            state: "draft",
            digest: "c".repeat(64),
            publishedAt: null,
            closedAt: null,
          },
        );
        assert.ok(!JSON.stringify(withDraft).includes("Synthetic draft body for the release record."));
      } finally {
        await client.query("rollback");
        client.release();
      }

      // The known issues exactly as committed.
      const known = JSON.parse(await readFile(knownIssuesPath, "utf8"));
      assert.ok(known.issues.length > 0);
      assert.deepEqual(record.knownIssues, known.issues);

      // A database behind the migrations the release ships is named as behind, not hidden.
      const ahead = join(temp, "journal.json");
      await writeFile(
        ahead,
        JSON.stringify({
          ...journal,
          entries: [
            ...journal.entries,
            {
              idx: latest.idx + 1,
              version: "7",
              when: latest.when + 1,
              tag: "synthetic_unapplied",
              breakpoints: true,
            },
          ],
        }),
      );
      const behind = await buildReleaseRecord(pool, { releaseSha, journalPath: ahead, knownIssuesPath });
      assert.deepEqual(behind.migrations.shipped, {
        count: journal.entries.length + 1,
        latest: "synthetic_unapplied",
      });
      assert.deepEqual(behind.migrations.applied, {
        count: journal.entries.length,
        latest: latest.tag,
        matchesShipped: false,
      });

      // It refuses a malformed commit or known-issue list instead of recording it.
      await assert.rejects(
        buildReleaseRecord(pool, { releaseSha: "HEAD", journalPath, knownIssuesPath }),
        /RELEASE_SHA_REQUIRED/,
      );
      const badIssues = join(temp, "known-issues.json");
      await writeFile(
        badIssues,
        JSON.stringify({ ...known, issues: [...known.issues, { ...known.issues[0] }] }),
      );
      await assert.rejects(buildReleaseRecord(pool, { releaseSha, journalPath, knownIssuesPath: badIssues }));

      // The command records nothing outside the clean checkout of the commit it names.
      const run = spawnSync(
        process.execPath,
        ["--import", import.meta.resolve("tsx"), "src/scripts/release-record.ts", "f".repeat(40)],
        { cwd: fileURLToPath(new URL("../..", import.meta.url)), encoding: "utf8", timeout: 30000 },
      );
      assert.equal(run.status, 1, run.stderr);
      assert.match(run.stderr, /CLEAN_RELEASE_CHECKOUT_REQUIRED/);
      assert.equal(run.stdout, "");
    } finally {
      await rm(temp, { recursive: true, force: true });
      await pool.end();
    }
  },
);
