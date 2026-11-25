import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { after, test } from "node:test";
import { sql } from "drizzle-orm";
import { allSourceLeads } from "@workspace/valo-core";

// Both tests share the database pool, which closes once, after them.
after(async () => {
  if (process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only") return;
  const { pool } = await import("@workspace/db");
  await pool.end();
});

// docs/architecture/source-register.md, slice 1 (ADM-003): the register of official sources as staff keep
// them, through its routes and against real PostgreSQL.
test(
  "the source register files the repository's regulatory sources once, keeps every version, and records a correction only by an active Content editor, with why, on the latest version",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60000,
  },
  async () => {
    const { assertDevelopmentRuntime } = await import("../../platform/valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(
      process.env.DATABASE_URL &&
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
    );
    const { db, pool } = await import("@workspace/db");
    const { default: express } = await import("express");
    const { createSourceControlsRouter } = await import("../../routes/valo-source-controls");
    const { ListSourceRegisterResponse } = await import("@workspace/api-zod");
    const prefix = `synthetic-register-${randomUUID()}`;
    const staff = { identityId: `${prefix}-content`, recentMfa: true, verifiedAt: Date.now() };
    const system = { identityId: `${prefix}-system`, recentMfa: true, verifiedAt: Date.now() };
    const fresh = <T extends { verifiedAt: number }>(actor: T) => ({ ...actor, verifiedAt: Date.now() });
    for (const [actor, area] of [
      [staff, "content"],
      [system, "system"],
    ] as const)
      await db.execute(
        sql`insert into valo_staff_assignments(id,identity_id,role,active,granted_by,reason) values(${randomUUID()}::uuid,${actor.identityId},${area},true,'synthetic-ci','Controlled CI fixture only')`,
      );
    {
      let actor: typeof staff = staff;
      const app = express();
      app.use(express.json());
      app.use(createSourceControlsRouter(async () => fresh(actor)));
      app.use(
        (
          error: unknown,
          _req: unknown,
          res: { status: (n: number) => { json: (v: unknown) => void } },
          _next: unknown,
        ) => {
          const e = error as { status?: number; message?: string };
          res.status(e.status ?? 422).json({ error: e.message ?? "Invalid request" });
        },
      );
      const server = app.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const url = `http://127.0.0.1:${address.port}`;
      const origin = process.env.VALO_TRUSTED_ORIGIN;
      process.env.VALO_TRUSTED_ORIGIN = url;
      try {
        const post = (path: string, body: unknown = {}, from = url) =>
          fetch(url + path, {
            method: "POST",
            headers: { "content-type": "application/json", origin: from },
            body: JSON.stringify(body),
          });
        const register = async (response: Response) => {
          assert.equal(response.status, 200);
          return ListSourceRegisterResponse.parse(await response.json());
        };
        // Only an active Content editor reads, files or corrects it.
        actor = system;
        assert.equal((await fetch(url + "/admin/source-register")).status, 403);
        assert.equal((await post("/admin/source-register/file")).status, 403);
        actor = staff;
        const regulatory = allSourceLeads.filter((source) => source.category === "regulatory");
        const before = await register(await fetch(url + "/admin/source-register"));
        assert.equal(before.entries.length + before.unfiled, regulatory.length);
        assert.ok(before.jurisdictions.includes("Nigeria") && before.jurisdictions.includes("Lagos"));
        // Filing files each regulatory source once, with what the claim maps and amendment records say.
        const filed = await register(await post("/admin/source-register/file"));
        assert.equal(filed.unfiled, 0);
        assert.deepEqual(
          filed.entries.map((entry) => entry.sourceId).sort(),
          regulatory.map((s) => s.id).sort(),
        );
        const act = filed.entries.find((entry) => entry.sourceId === "S04")!;
        if (!before.entries.some((entry) => entry.sourceId === "S04"))
          assert.deepEqual(
            {
              version: act.version,
              authority: act.authority,
              instrument: act.instrument,
              effectiveFrom: act.effectiveFrom,
              jurisdiction: act.jurisdiction,
              status: act.status,
              earlier: act.earlier,
            },
            {
              version: 1,
              authority: "Nigeria Data Protection Commission (official copy)",
              instrument: "act",
              effectiveFrom: "2023-06-12",
              jurisdiction: "Nigeria",
              status: "active",
              earlier: [],
            },
          );
        assert.deepEqual(
          (await register(await post("/admin/source-register/file"))).entries.length,
          regulatory.length,
        );
        // A correction needs why, a listed jurisdiction, a real day and none for a page, a change, and the
        // latest version. Each run names its own edition, so a database the test ran on before still sees a
        // change.
        const edition = `Synthetic edition ${prefix}`;
        const base = {
          baseVersion: act.version,
          authority: act.authority,
          jurisdiction: act.jurisdiction,
          instrument: act.instrument,
          versionInForce: edition,
          effectiveFrom: act.effectiveFrom,
          status: "active",
          reason: "Synthetic: the edition in force was named from the Act's own copy.",
        };
        const revise = (body: unknown, from = url) => post("/admin/source-register/S04/versions", body, from);
        for (const refused of [
          { ...base, reason: "Too short." },
          { ...base, jurisdiction: "Synthetic nowhere" },
          { ...base, instrument: "official_page", effectiveFrom: "2023-06-12" },
          { ...base, effectiveFrom: "2023-02-30" },
          { ...base, versionInForce: act.versionInForce, status: act.status },
          { ...base, published: true },
        ])
          assert.equal((await revise(refused)).status, 422, JSON.stringify(refused));
        assert.equal((await revise({ ...base, baseVersion: act.version + 1 })).status, 409);
        assert.equal((await post("/admin/source-register/SYNTHETIC-NONE/versions", base)).status, 404);
        assert.equal((await revise(base, "https://untrusted.invalid")).status, 403);
        const corrected = (await register(await revise(base))).entries.find((e) => e.sourceId === "S04")!;
        assert.equal(corrected.version, act.version + 1);
        assert.equal(corrected.versionInForce, edition);
        assert.equal(corrected.createdBy, staff.identityId);
        assert.equal(corrected.earlier[0]!.version, act.version);
        assert.equal(corrected.earlier[0]!.versionInForce, act.versionInForce);
        const retired = (
          await register(
            await revise({
              ...base,
              baseVersion: corrected.version,
              status: "retired",
              reason: "Synthetic: retired to check that its versions stay on the record.",
            }),
          )
        ).entries.find((e) => e.sourceId === "S04")!;
        assert.equal(retired.status, "retired");
        assert.equal(retired.earlier.length, corrected.earlier.length + 1);
        const returned = (
          await register(
            await revise({
              ...base,
              baseVersion: retired.version,
              reason: "Synthetic: brought back to check that a return is a version too.",
            }),
          )
        ).entries.find((e) => e.sourceId === "S04")!;
        assert.deepEqual(
          [returned.version, returned.status, returned.earlier.map((v) => v.status).slice(0, 2)],
          [retired.version + 1, "active", ["retired", "active"]],
        );
        // The database keeps every version: none is changed or removed, the address stays, and only an
        // active Content editor records the next one.
        const next = returned.version + 1;
        const insert = (version: number, by: string, address = act.url) =>
          pool.query(
            `insert into valo_source_register(source_id,version,title,url,jurisdiction,status,reason,created_by)
               values('S04',$1,$2,$3,'Nigeria','active','Synthetic: recorded straight into the database.',$4)`,
            [version, act.title, address, by],
          );
        await assert.rejects(
          pool.query(
            "update valo_source_register set reason='Synthetic: a changed reason.' where source_id='S04'",
          ),
          /never changed or removed/,
        );
        await assert.rejects(
          pool.query("delete from valo_source_register where source_id='S04'"),
          /never changed or removed/,
        );
        await assert.rejects(
          insert(next, staff.identityId, "https://example.invalid/other"),
          /keeps its address/,
        );
        await assert.rejects(insert(next, system.identityId), /active content editor/);
        await assert.rejects(insert(returned.version, staff.identityId), /next version/);
        await assert.rejects(
          pool.query(
            `insert into valo_source_register(source_id,version,title,url,jurisdiction,instrument,effective_from,status,reason,created_by)
               values('S04',$1,$2,$3,'Nigeria','official_page','2023-06-12','active','Synthetic: a page given a day it took effect.',$4)`,
            [next, act.title, act.url, staff.identityId],
          ),
          /valo_source_register_fields/,
        );
      } finally {
        if (origin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
        else process.env.VALO_TRUSTED_ORIGIN = origin;
        server.close();
        await once(server, "close");
      }
    }
  },
);

// docs/architecture/source-register.md, slice 2 (ADM-003, CMP-007): retiring a source stops its daily
// check and holds what rests on it. The test files a synthetic source of its own, so no source kept in
// the repository is ever retired, and leaves it retired and unwatched for the steps after it.
test(
  "retiring a source stops its daily check and holds what rests on it at once, and bringing it back restarts the check without releasing a hold",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60000,
  },
  async () => {
    const { assertDevelopmentRuntime } = await import("../../platform/valo-development-runtime");
    assertDevelopmentRuntime();
    assert.ok(
      process.env.DATABASE_URL &&
        ["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL).hostname),
    );
    const { db } = await import("@workspace/db");
    const { digest } = await import("@workspace/valo-core");
    const register = await import("./index");
    const controls = await import("../sources/valo-source-controls"),
      monitor = await import("../sources/valo-source-monitor"),
      state = await import("../sources/valo-source-state"),
      corrections = await import("../sources/valo-source-corrections");
    const { heldSourceBundle } = await import("../sources/valo-source-controls.fixtures");
    const prefix = `synthetic-retire-${randomUUID()}`;
    const staff = { identityId: `${prefix}-content`, recentMfa: true, verifiedAt: Date.now() };
    const fresh = <T extends { verifiedAt: number }>(actor: T) => ({ ...actor, verifiedAt: Date.now() });
    await db.execute(
      sql`insert into valo_staff_assignments(id,identity_id,role,active,granted_by,reason) values(${randomUUID()}::uuid,${staff.identityId},'content',true,'synthetic-ci','Controlled CI fixture only')`,
    );
    {
      const now = new Date();
      const sourceId = `SYNTHETIC-RETIRE-${randomUUID().slice(0, 8).toUpperCase()}`,
        url = `https://example.invalid/${prefix}`,
        raw = "synthetic bytes of a source to be retired",
        contentId = randomUUID(),
        snapshotId = randomUUID();
      // A source in the register, watched, with a current capture, and a version bound to it.
      await db.execute(
        sql`insert into valo_source_register(source_id,version,title,url,jurisdiction,status,reason,created_by)
         values(${sourceId},1,'Synthetic source to retire',${url},'Nigeria','active','Synthetic: filed for the retirement check.',${staff.identityId})`,
      );
      await db.execute(
        sql`insert into valo_source_watches(source_id,url,risk,next_check_at) values(${sourceId},${url},'high',${new Date(+now + 30 * 86400000)})`,
      );
      const b = heldSourceBundle(now);
      b.candidate.id = prefix;
      b.sources[0]!.url = url;
      await db.execute(sql`insert into valo_source_snapshots(id,source_id,url,attempted_at,fetched_at,status,http_status,mime,raw_checksum,text_checksum,raw_object_key,text_object_key,bytes,extraction_version,metadata)
       values(${snapshotId}::uuid,${sourceId},${url},${now},${now},'retrieved_unreviewed',200,'text/plain',${digest(raw)},${b.sources[0]!.hash},
        ${"synthetic-ci-not-a-retained-file/" + snapshotId + "/raw"},${"synthetic-ci-not-a-retained-file/" + snapshotId + "/text"},10,'controlled-no-extraction','{"synthetic":true,"publication":"held"}')`);
      await db.execute(
        sql`update valo_source_watches set last_snapshot_id=${snapshotId}::uuid,last_raw_hash=${digest(raw)},checked_at=${now} where source_id=${sourceId}`,
      );
      const policyId = `${prefix}-unapproved`;
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policyId},${digest(b.policy)},${JSON.stringify(b.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
      );
      await db.execute(sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
       values(${contentId}::uuid,${prefix},1,${contentId},${policyId},${b.candidate.hash},${JSON.stringify(b)}::jsonb,'{}','candidate',${new Date(+now + 86400000)})`);
      await db.execute(sql`insert into valo_source_release_bindings(target_kind,target_id,source_id,bundle_source_id,source_hash,snapshot_id,raw_hash)
       values('content',${contentId}::uuid,${sourceId},${b.sources[0]!.id},${b.sources[0]!.hash},${snapshotId}::uuid,${digest(raw)})`);
      assert.equal(await state.sourceTargetAllowed(db, "content", contentId, b, now), true);
      const entry = async (value: Promise<Awaited<ReturnType<typeof register.listSourceRegister>>>) =>
        (await value).entries.find((e) => e.sourceId === sourceId)!;
      const before = await entry(register.listSourceRegister(fresh(staff)));
      assert.deepEqual([before.restingVersions, before.watch?.stoppedAt], [1, null]);
      const fields = {
        authority: null,
        jurisdiction: "Nigeria",
        instrument: null,
        versionInForce: null,
        effectiveFrom: null,
      };
      // Retiring it stops the watch and refuses the gate at once, before the hold is fanned out.
      const retired = await entry(
        register.reviseSourceEntry(fresh(staff), sourceId, {
          ...fields,
          baseVersion: 1,
          status: "retired",
          reason: "Synthetic: retired to check that what rests on it is held.",
        }),
      );
      assert.equal(retired.status, "retired");
      assert.ok(retired.watch?.stoppedAt);
      assert.equal(await state.sourceTargetAllowed(db, "content", contentId, b, now), false);
      const [job] = (
        await db.execute(
          sql`select reason,status from valo_source_dependency_jobs where dedupe_key=${`retired:${sourceId}:2`}`,
        )
      ).rows;
      assert.deepEqual(job, {
        reason: "The official source was retired from the source register.",
        status: "pending",
      });
      for (let n = 0; n < 50 && (await corrections.processSourceDependencyJob()); n++);
      const impacts = (
        await db.execute(
          sql`select source_id,reason from valo_source_impacts where target_kind='content' and target_id=${contentId}::uuid`,
        )
      ).rows;
      assert.deepEqual(impacts, [
        { source_id: sourceId, reason: "The official source was retired from the source register." },
      ]);
      assert.equal((await entry(register.listSourceRegister(fresh(staff)))).restingVersions, 0);
      // The scheduler leaves a stopped watch alone, and a check queued before the source was retired
      // fetches nothing. The watch falls due in 2000 and the scheduler runs as of then, so it touches no
      // other watch. The queued check is dated first, and claimed after every lease has run out, so it is
      // the one claimed whatever earlier steps left in the queue.
      await db.execute(
        sql`update valo_source_watches set next_check_at='2000-01-01T00:00:00Z' where source_id=${sourceId}`,
      );
      await monitor.scheduleSourceChecks(new Date("2000-01-02T00:00:00Z"));
      assert.equal(
        (await db.execute(sql`select id from valo_source_check_jobs where source_id=${sourceId}`)).rows
          .length,
        0,
      );
      const queued = randomUUID();
      await db.execute(
        sql`insert into valo_source_check_jobs(id,source_id,day,status,created_at) values(${queued}::uuid,${sourceId},'2000-01-01','pending','2000-01-01T00:00:00Z')`,
      );
      assert.equal(await monitor.claimSourceCheck(new Date(+now + 3600000)), null);
      assert.deepEqual(
        (await db.execute(sql`select status,result from valo_source_check_jobs where id=${queued}::uuid`))
          .rows[0],
        { status: "complete", result: "SOURCE_WATCH_STOPPED" },
      );
      // Staff can no longer start watching it, nor a document that is not a source of law.
      const watch = (sourceId: string) =>
        controls.actOnSourceControls(fresh(staff), {
          action: "watch_source",
          sourceId,
          requestKey: randomUUID(),
          reason: "Synthetic request to watch a source that is not offered.",
        });
      await assert.rejects(watch(sourceId), /the register has not retired/);
      await assert.rejects(watch("S10"), /the register has not retired/);
      const choices = (await controls.sourceControls(fresh(staff), "content")).sourceChoices.map((c) => c.id);
      assert.ok(choices.includes("S01") && !choices.includes("S10") && !choices.includes(sourceId));
      // Bringing it back restarts the check at once, and what was held stays held.
      const returned = await entry(
        register.reviseSourceEntry(fresh(staff), sourceId, {
          ...fields,
          baseVersion: 2,
          status: "active",
          reason: "Synthetic: brought back to check that its watch restarts.",
        }),
      );
      assert.equal(returned.watch?.stoppedAt, null);
      assert.ok(Date.parse(returned.watch!.nextCheckAt!) <= Date.now());
      assert.equal(await state.sourceTargetAllowed(db, "content", contentId, b, now), false);
      // Retired again, so no step after this one checks a synthetic address.
      const left = await entry(
        register.reviseSourceEntry(fresh(staff), sourceId, {
          ...fields,
          baseVersion: 3,
          status: "retired",
          reason: "Synthetic: retired again so that no later step checks it.",
        }),
      );
      assert.ok(left.watch?.stoppedAt);
    }
  },
);
