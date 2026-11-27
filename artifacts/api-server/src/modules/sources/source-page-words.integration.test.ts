import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { allSourceLeads, sha256 } from "@workspace/valo-core";
import { heldSourceBundle } from "./valo-source-controls.fixtures";

/**
 * The daily check on a real database: a web page counts as changed when the words read from it
 * change, and a file when its bytes change.
 *
 * Two official pages return different bytes on every request (an email-protection or anti-bot
 * code) while saying the same words. Compared by bytes, they would be reported changed at every
 * check, and whatever rests on them would be held every day.
 *
 * Every row here is synthetic and nothing is fetched. The whole test runs in one transaction that
 * is rolled back, so no watch, capture or job remains.
 */
test(
  "the daily check holds what rests on a page when its words change, not when only its bytes do",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db } = await import("@workspace/db");
    const monitor = await import("./valo-source-monitor"),
      state = await import("./valo-source-state"),
      { currentSourceCaptures } = await import("./source-current-captures");

    const watched = (
      await db.execute<{ source_id: string }>(sql`select source_id from valo_source_watches`)
    ).rows.map((row) => row.source_id);
    // Other tests take the first source nobody watches, and may run beside this one. This one takes
    // the last, and checks inside its transaction that the watch is new.
    const lead = [...allSourceLeads].reverse().find((s) => !watched.includes(s.id));
    assert.ok(lead, "an official source no other test watches");

    const start = new Date(),
      day = (n: number) => new Date(+start + n * 86_400_000),
      target = randomUUID(),
      rolledBack = "ROLLED_BACK_ON_PURPOSE";
    const bundle = heldSourceBundle(start);
    bundle.sources[0]!.url = lead.url;

    await db
      .transaction(async (tx) => {
        await monitor.registerSourceWatch(tx, lead.id);
        const fresh = await tx.execute(
          sql`select last_snapshot_id,last_raw_hash,checked_at from valo_source_watches where source_id=${lead.id}`,
        );
        assert.deepEqual(fresh.rows, [{ last_snapshot_id: null, last_raw_hash: null, checked_at: null }]);
        const texts = new Map<string, string>();
        /** A capture as the daily check stores one, of bytes and words that stand for the page's. */
        const capture = async (mime: string, bytes: string, words: string, version = "source-text-3") => {
          const id = randomUUID();
          texts.set(id, words);
          await tx.execute(sql`insert into valo_source_snapshots(id,source_id,url,final_url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,bytes,extraction_version,metadata)
            values(${id}::uuid,${lead.id},${lead.url},${lead.url},${start},${start},'retrieved_unreviewed',200,${mime},${sha256(bytes)},${sha256(words)},
            ${"synthetic-not-a-retained-file/" + id + "/raw"},${"synthetic-not-a-retained-file/" + id + "/text"},${bytes.length},${version},'{"synthetic":true,"publication":"held"}')`);
          return id;
        };
        /** One day's check, completed with the capture given. */
        const check = async (n: number, snapshotId: string) => {
          const claim = { id: randomUUID(), source_id: lead.id, token: randomUUID() };
          await tx.execute(sql`insert into valo_source_check_jobs(id,source_id,day,status,attempts,lease_token,lease_until)
            values(${claim.id}::uuid,${lead.id},${day(n).toISOString().slice(0, 10)}::date,'running',1,${claim.token}::uuid,${new Date(+day(n) + 300_000)})`);
          assert.equal(await monitor.completeSourceCheckIn(tx, claim, snapshotId, day(n)), true);
          const job = (
            await tx.execute(
              sql`select result,snapshot_id,status from valo_source_check_jobs where id=${claim.id}::uuid`,
            )
          ).rows[0]!;
          const watch = (
            await tx.execute(
              sql`select last_snapshot_id,last_raw_hash,checked_at,failure_code from valo_source_watches where source_id=${lead.id}`,
            )
          ).rows[0]!;
          const held = (
            await tx.execute(
              sql`select count(*)::int as n from valo_source_dependency_jobs where dedupe_key=${"check:" + claim.id}`,
            )
          ).rows[0]!.n;
          assert.equal(job.status, "complete");
          assert.equal(job.snapshot_id, snapshotId, "the job names the capture it made");
          assert.equal(state.sourceTime(watch.checked_at), +day(n));
          assert.equal(watch.failure_code, null);
          return {
            result: job.result,
            current: watch.last_snapshot_id,
            currentBytes: watch.last_raw_hash,
            dependantsQueued: held === 1,
          };
        };
        const allowed = (n: number) => state.sourceTargetAllowed(tx, "content", target, bundle, day(n));
        const page = "text/html",
          file = "application/pdf";

        // Day 0: the first capture of the page. Something is released resting on it.
        const first = await capture(page, "page bytes with code 1", "The words of the page.");
        assert.deepEqual(await check(0, first), {
          result: "SOURCE_CAPTURED",
          current: first,
          currentBytes: sha256("page bytes with code 1"),
          dependantsQueued: false,
        });
        await tx.execute(sql`insert into valo_source_release_bindings(target_kind,target_id,source_id,bundle_source_id,source_hash,snapshot_id,raw_hash)
          values('content',${target}::uuid,${lead.id},${bundle.sources[0]!.id},${bundle.sources[0]!.hash},${first}::uuid,${sha256("page bytes with code 1")})`);
        assert.equal(await allowed(0), true);

        // Day 1: the page returns different bytes and says the same words. Nothing is held: the
        // watch goes on naming the capture already bound, and only the time of the check moves.
        const sameWords = await capture(page, "page bytes with code 2", "The words of the page.");
        assert.deepEqual(await check(1, sameWords), {
          result: "SOURCE_SAME_WORDS",
          current: first,
          currentBytes: sha256("page bytes with code 1"),
          dependantsQueued: false,
        });
        assert.equal(await allowed(1), true);
        // The preparer reads the same capture as current, checked on day 1.
        const read = await currentSourceCaptures([lead.id], day(1), {
          reader: tx,
          readText: async (snapshotId) => texts.get(snapshotId)!,
        });
        assert.deepEqual(
          read.map((c) => [c.snapshotId, c.checkedAt, c.text]),
          [[first, day(1).toISOString(), "The words of the page."]],
        );
        // Without that day's check the capture would be stale by day 2, as before.
        assert.equal(await allowed(2.5), false);

        // Day 2: the very same bytes again. The watch moves to the new capture of the same file.
        const sameFile = await capture(page, "page bytes with code 1", "The words of the page.");
        assert.deepEqual(await check(2, sameFile), {
          result: "SOURCE_CAPTURED",
          current: sameFile,
          currentBytes: sha256("page bytes with code 1"),
          dependantsQueued: false,
        });
        assert.equal(await allowed(2), true);

        // Day 3: the page says something else. What rests on it is held at once.
        const newWords = await capture(page, "page bytes with code 3", "The page now says something else.");
        assert.deepEqual(await check(3, newWords), {
          result: "SOURCE_CHANGED",
          current: newWords,
          currentBytes: sha256("page bytes with code 3"),
          dependantsQueued: true,
        });
        assert.equal(await allowed(3), false);

        // A file is still compared by its bytes. Day 4: a file where the page was. Day 5: another
        // file with different bytes and the same words. Each is a change.
        const aFile = await capture(file, "file bytes A", "The words of the file.");
        assert.equal((await check(4, aFile)).result, "SOURCE_CHANGED");
        const anotherFile = await capture(file, "file bytes B", "The words of the file.");
        assert.deepEqual(await check(5, anotherFile), {
          result: "SOURCE_CHANGED",
          current: anotherFile,
          currentBytes: sha256("file bytes B"),
          dependantsQueued: true,
        });

        // Day 6: a page where the file was is a change, though the words are the same.
        const pageAgain = await capture(page, "page bytes with code 4", "The words of the file.");
        assert.equal((await check(6, pageAgain)).result, "SOURCE_CHANGED");
        // Day 7: the same words read by another version of the extractor are not comparable.
        const otherReader = await capture(
          page,
          "page bytes with code 5",
          "The words of the file.",
          "source-text-4",
        );
        assert.equal((await check(7, otherReader)).result, "SOURCE_CHANGED");
        // Day 8: and once both captures are that version's, the same words are the same again.
        const sameAgain = await capture(
          page,
          "page bytes with code 6",
          "The words of the file.",
          "source-text-4",
        );
        assert.deepEqual(await check(8, sameAgain), {
          result: "SOURCE_SAME_WORDS",
          current: otherReader,
          currentBytes: sha256("page bytes with code 5"),
          dependantsQueued: false,
        });

        throw Error(rolledBack);
      })
      .catch((error: Error) => assert.equal(error.message, rolledBack));

    // Nothing remains: the source is as unwatched as it was.
    const after = await db.execute(sql`select 1 from valo_source_watches where source_id=${lead.id}`);
    assert.equal(after.rows.length, 0);
  },
);
