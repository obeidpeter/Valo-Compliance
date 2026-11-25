import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

/**
 * EDP-011, CMP-007 (docs/architecture/guidance-currency.md, slice 1). Two synthetic regulatory guides
 * are released on a synthetic development owner's sign-off, each on a synthetic check citing a web
 * page and a file. Later checks are recorded as the worker's daily check would record them. Synthetic
 * records only; nothing is read from an official source. Both guides are withdrawn at the end.
 */
test(
  "a published guide stays shown while its web page says the same words, is held when a source or its words change, and is due again a day after its newest check or an hour after a check that held it",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 120000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    const {
      db,
      pool,
      valoManualLibrary: library,
      valoManualRegulatoryChecks: checks,
      valoManualWithdrawals: withdrawals,
      valoStaffAssignments,
      valoStaffRoleChanges,
    } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { sha256 } = await import("@workspace/valo-core");
    const { dueGuidance } = await import("./daily-check");
    const { regulatoryEvidence } = await import("./regulatory-evidence");
    const { releasedManualEntries } = await import("../manual-library");

    const id = randomUUID();
    const editor = "synthetic-currency-editor-" + id,
      owner = "synthetic-currency-owner-" + id,
      ownerAssignment = randomUUID();
    await db.insert(valoStaffAssignments).values([
      {
        id: randomUUID(),
        identityId: editor,
        role: "content",
        grantedBy: "synthetic operator",
        reason: "Synthetic editor for the daily guide check test",
      },
      {
        id: ownerAssignment,
        identityId: owner,
        role: "system",
        grantedBy: "synthetic operator",
        reason: "Synthetic owner for the daily guide check test",
      },
    ]);
    await db.insert(valoStaffRoleChanges).values({
      id: randomUUID(),
      requestKey: randomUUID(),
      inputHash: sha256("synthetic"),
      actorId: "operator-bootstrap:synthetic",
      actorAssignmentId: ownerAssignment,
      assignmentId: ownerAssignment,
      targetIdentityId: owner,
      action: "grant",
      role: "system",
      reason: "Synthetic owner for the daily guide check test",
      after: { active: true },
      targetVerifiedAt: new Date(),
    });

    const day = 86_400_000;
    const page = {
      url: "https://synthetic.example/official-page",
      title: "Synthetic official page",
      locator: "Synthetic section",
      rawSha256: "a".repeat(64),
      textSha256: "b".repeat(64),
      validThrough: new Date(Date.now() + 20 * day).toISOString(),
      retrievedAt: new Date().toISOString(),
      retrieval: "official_url" as const,
    };
    const file = {
      url: "https://synthetic.example/official-act.pdf",
      title: "Synthetic official act",
      locator: "section 1",
      rawSha256: "c".repeat(64),
      validThrough: new Date(Date.now() + 20 * day).toISOString(),
      retrievedAt: new Date().toISOString(),
      retrieval: "official_url" as const,
    };
    type Source = typeof page | typeof file;
    const record = async (
      candidateId: string,
      title: string,
      body: string,
      sources: Source[],
      holds: string[] = [],
      checkedAt = new Date(),
    ) => {
      const bodySha256 = sha256(body);
      const [row] = await db
        .insert(checks)
        .values({
          candidateId,
          title,
          bodySha256,
          ...regulatoryEvidence({ id: candidateId, title, bodySha256, sources, holds }),
          sources,
          holds,
          checkedAt,
        })
        .returning();
      return row!;
    };
    const release = async (candidateId: string) => {
      const itemId = randomUUID(),
        title = "Synthetic daily-checked guide " + candidateId,
        body = "A synthetic regulatory guide, checked each day against its sources. " + id;
      const [entry] = await db
        .insert(library)
        .values({
          id: randomUUID(),
          itemId,
          version: 1,
          slug: "manual-" + itemId,
          kind: "regulatory_article",
          title,
          body,
          digest: sha256(body),
          state: "draft",
          createdBy: editor,
        })
        .returning();
      const signed = await record(candidateId, title, body, [page, file]);
      await db
        .update(library)
        .set({
          state: "published",
          publishedBy: owner,
          publishedAt: new Date(),
          regulatoryCheckId: signed.id,
        })
        .where(eq(library.id, entry!.id));
      return { entry: entry!, title, body, signed, slug: "manual-" + itemId };
    };
    const shown = async (slug: string) => (await releasedManualEntries(slug)).length === 1;

    const released: Awaited<ReturnType<typeof release>>[] = [];
    try {
      const first = await release("GUD-29");
      released.push(first);
      const second = await release("GUD-30");
      released.push(second);
      assert.ok(await shown(first.slug), "shown on the check it was signed on");

      // The page returned other bytes with the same words: the guide stays shown.
      await record("GUD-29", first.title, first.body, [{ ...page, rawSha256: "e".repeat(64) }, file]);
      assert.ok(await shown(first.slug), "shown while the page says the same words");
      // The page's words changed: held.
      await record("GUD-29", first.title, first.body, [
        { ...page, rawSha256: "e".repeat(64), textSha256: "f".repeat(64) },
        file,
      ]);
      assert.equal(await shown(first.slug), false, "held when the page's words change");
      // The same evidence again: shown again.
      await record("GUD-29", first.title, first.body, [page, file]);
      assert.ok(await shown(first.slug));
      // The file's bytes changed: held, since a file is compared by its bytes.
      await record("GUD-29", first.title, first.body, [page, { ...file, rawSha256: "e".repeat(64) }]);
      assert.equal(await shown(first.slug), false, "held when the file's bytes change");
      // A source that could not be read: held, until a check passes again.
      const held = await record(
        "GUD-29",
        first.title,
        first.body,
        [page, file],
        ["The official source synthetic could not be read."],
      );
      assert.equal(await shown(first.slug), false, "held when a source could not be read");

      // A guide that was never published is never due, however old its check.
      await record(
        "GUD-28",
        "Synthetic unpublished guide",
        "Synthetic body. " + id,
        [page, file],
        [],
        new Date(Date.now() - 10 * day),
      );
      const at = (ms: number) => new Date(+held.checkedAt + ms);
      const ours = (list: string[]) => list.filter((c) => ["GUD-28", "GUD-29", "GUD-30"].includes(c));
      assert.deepEqual(ours(await dueGuidance(at(30 * 60_000))), [], "nothing is due within the hour");
      assert.deepEqual(
        ours(await dueGuidance(at(61 * 60_000))),
        ["GUD-29"],
        "a check that held is due after an hour",
      );
      // A day on, both are due, the one whose newest check is older first.
      assert.deepEqual(ours(await dueGuidance(at(day + 60_000))), ["GUD-30", "GUD-29"]);

      // A withdrawn guide is never due.
      await db.insert(withdrawals).values({
        edition: second.entry.id,
        reason: "Synthetic withdrawal at the end of the daily check test.",
        recordedBy: owner,
      });
      await db
        .update(library)
        .set({ state: "withdrawn", closedBy: owner, closedAt: new Date() })
        .where(eq(library.id, second.entry.id));
      released.splice(released.indexOf(second), 1);
      assert.deepEqual(ours(await dueGuidance(at(day + 60_000))), ["GUD-29"]);
    } finally {
      for (const guide of released) {
        await db.insert(withdrawals).values({
          edition: guide.entry.id,
          reason: "Synthetic withdrawal at the end of the daily check test.",
          recordedBy: owner,
        });
        await db
          .update(library)
          .set({ state: "withdrawn", closedBy: owner, closedAt: new Date() })
          .where(eq(library.id, guide.entry.id));
      }
      await pool.end();
    }
  },
);
