import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { allSourceLeads } from "@workspace/valo-core";

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
    try {
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
    } finally {
      await pool.end();
    }
  },
);
