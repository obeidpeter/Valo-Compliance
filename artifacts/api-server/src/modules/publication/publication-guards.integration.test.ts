import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { digest, evaluatePublication, type PublicationBundle } from "@workspace/valo-core";
import { heldSourceBundle } from "../sources/valo-source-controls.fixtures";

/**
 * The publication guards that operational-publication.integration.test.ts checks against the
 * actual development candidates, here against a synthetic candidate that fails its gates, so CI
 * runs them on every change. Nothing here can publish: the candidate is not eligible, and every
 * check expects a refusal.
 */

// Both tests use the shared pool, so it is closed once, after the last of them.
after(async () => {
  if (process.env.VALO_RUN_DB_TESTS === "synthetic-development-only")
    await (await import("@workspace/db")).pool.end();
});

/** Drizzle reports database errors as "Failed query: ..." with the database's own error as the
 * cause; match the database's message or code anywhere in that chain. */
const databaseError = (expected: RegExp | string) => (error: unknown) => {
  for (let e: unknown = error, depth = 0; e && depth < 5; depth++) {
    const item = e as { message?: unknown; code?: unknown; cause?: unknown };
    if (typeof expected === "string" ? item.code === expected : expected.test(String(item.message ?? "")))
      return true;
    e = item.cause;
  }
  return false;
};

test(
  "a synthetic candidate that fails its gates is held, and no role or path publishes, changes or withdraws it",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db } = await import("@workspace/db");
    const { publishOperationalVersion, recordActualPublicationHold, withdrawOperationalVersion } =
      await import("./publication-publisher");
    const { liveOperationalVersions, readReleasedMaster } =
      await import("../catalogue/valo-released-content");
    const id = randomUUID(),
      prefix = `synthetic-publication-guards-${id}`,
      bundle = heldSourceBundle(new Date(), false);
    assert.equal(evaluatePublication(bundle).decision, "hold", "the synthetic candidate is not eligible");
    const asRole = (role: string | null, query: ReturnType<typeof sql>) =>
      db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        return tx.execute(query);
      });
    const status = async () =>
      (await db.execute(sql`select status from valo_content_versions where id=${id}::uuid`)).rows[0]?.status;

    await db.execute(
      sql`insert into valo_publication_policies(id,hash,policy,authority) values(${prefix},${digest(bundle.policy)},${JSON.stringify(bundle.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
    );
    // Drafters add candidates; this is the only way content versions are created.
    await asRole(
      "valo_content_drafter_dev",
      sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
        values(${id}::uuid,${prefix},1,${prefix},${prefix},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86_400_000)})`,
    );

    await t.test("the bounded publisher records the failed gates as a hold", async () => {
      const held = await recordActualPublicationHold(id);
      assert.equal(held.status, "held");
      assert.ok(held.reasons.length > 0);
      assert.equal(await status(), "held");
      const audit = await db.execute(
        sql`select action from valo_publication_audit where version_id=${id}::uuid order by created_at`,
      );
      assert.deepEqual(
        audit.rows.map((r) => r.action),
        ["held"],
      );
    });

    await t.test("the bounded publisher refuses the held version", async () => {
      await assert.rejects(() => publishOperationalVersion(id), /VERSION_NOT_RELEASABLE/);
      assert.equal(await status(), "held");
    });

    await t.test("the held version is neither listed nor downloadable", async () => {
      assert.ok(!(await liveOperationalVersions()).some((r) => r.id === id));
      await assert.rejects(() => readReleasedMaster(id, "pdf"), /withdrawn|expired|unavailable/i);
    });

    await t.test("withdrawal cannot turn the held version into a past publication", async () => {
      await assert.rejects(
        () => withdrawOperationalVersion(id, "synthetic check"),
        /PUBLISHED_VERSION_REQUIRED/,
      );
      assert.equal(await status(), "held");
    });

    await t.test("the drafter role cannot change publication state", async () => {
      await assert.rejects(
        asRole(
          "valo_content_drafter_dev",
          sql`update valo_content_versions set status='published' where id=${id}::uuid`,
        ),
        databaseError("42501"),
      );
    });

    await t.test("a drafter cannot add a version straight into published state", async () => {
      await assert.rejects(
        asRole(
          "valo_content_drafter_dev",
          sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
            values(${randomUUID()}::uuid,${prefix},2,${`${prefix}-2`},${prefix},'forged','{}','{}','published',${new Date(Date.now() + 86_400_000)})`,
        ),
        databaseError(/Candidates cannot publish themselves/),
      );
    });

    await t.test(
      "even the owner connection cannot publish a held version or change its payload",
      async () => {
        await assert.rejects(
          asRole(null, sql`update valo_content_versions set status='published' where id=${id}::uuid`),
          databaseError(/Invalid publication transition/),
        );
        await assert.rejects(
          asRole(null, sql`update valo_content_versions set bundle='{}'::jsonb where id=${id}::uuid`),
          databaseError(/Content versions are immutable/),
        );
        assert.equal(await status(), "held");
      },
    );

    await t.test("the publisher role cannot read customer drafts or change a policy", async () => {
      await assert.rejects(
        asRole("valo_content_publisher_dev", sql`select id from valo_documents limit 1`),
        databaseError("42501"),
      );
      await assert.rejects(
        asRole(
          "valo_content_publisher_dev",
          sql`update valo_publication_policies set hash='forged' where id=${prefix}`,
        ),
        databaseError("42501"),
      );
    });

    await t.test("policies and the publication audit trail are append-only", async () => {
      await assert.rejects(
        asRole(null, sql`update valo_publication_policies set hash='forged' where id=${prefix}`),
        databaseError(/append-only/),
      );
      await assert.rejects(
        asRole(null, sql`delete from valo_publication_audit where version_id=${id}::uuid`),
        databaseError(/append-only/),
      );
      await assert.rejects(
        asRole(null, sql`delete from valo_content_versions where id=${id}::uuid`),
        databaseError(/append-only/),
      );
    });
  },
);

/**
 * The publisher's own login (decision 0017, point 6). The database lets a content version become
 * published only in a session that logged in as valo_publisher_login. Every publish here is either
 * refused or rolled back: the synthetic candidate is not eligible, and nothing stays published.
 */
test(
  "a content version is published only by a session that logged in as the publisher",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, publisherConnectionString, PUBLISHER_LOGIN_ROLE, PUBLISHER_LOGIN_UNAVAILABLE_CODE } =
      await import("@workspace/db");
    const { assertPublisherCanLogIn, publishOperationalVersion } = await import("./publication-publisher");
    const { default: pg } = await import("pg");

    const id = randomUUID(),
      prefix = `synthetic-publisher-login-${id}`,
      bundle = heldSourceBundle(new Date(), false);
    const asRole = (role: string | null, query: ReturnType<typeof sql>) =>
      db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        return tx.execute(query);
      });
    const status = async () =>
      (await db.execute(sql`select status from valo_content_versions where id=${id}::uuid`)).rows[0]?.status;
    await db.execute(
      sql`insert into valo_publication_policies(id,hash,policy,authority) values(${prefix},${digest(bundle.policy)},${JSON.stringify(bundle.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
    );
    await asRole(
      "valo_content_drafter_dev",
      sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
        values(${id}::uuid,${prefix},1,${prefix},${prefix},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86_400_000)})`,
    );
    const publish = sql`update valo_content_versions set status='published', published_at=now() where id=${id}::uuid`;
    const needsPublisher = databaseError(
      /published only by a session that logged in as valo_publisher_login/,
    );

    await t.test(
      "the application's own login cannot publish a candidate, whatever role it takes",
      async () => {
        // The candidate-to-published transition is a valid one; only the login is wrong.
        await assert.rejects(asRole(null, publish), needsPublisher);
        await assert.rejects(asRole(null, publish), databaseError("42501"));
        await assert.rejects(asRole("valo_content_publisher_dev", publish), needsPublisher);
        assert.equal(await status(), "candidate");
      },
    );

    // One session that logged in as the publisher, as the release does.
    const application = process.env.DATABASE_URL!,
      configured = publisherConnectionString(process.env.VALO_PUBLISHER_DATABASE_URL, application);
    const publisher = new pg.Client({ connectionString: configured });
    await publisher.connect();
    t.after(() => publisher.end());
    const refused = async (text: string, code = "42501") => {
      await publisher.query("BEGIN");
      try {
        await assert.rejects(publisher.query(text), (error: { code?: string }) => error.code === code, text);
      } finally {
        await publisher.query("ROLLBACK");
      }
    };

    await t.test("the publisher's login holds nothing itself and can become only the publisher", async () => {
      const who = await publisher.query("select session_user as login, current_user as acting");
      assert.deepEqual(who.rows[0], { login: PUBLISHER_LOGIN_ROLE, acting: PUBLISHER_LOGIN_ROLE });
      const role = await publisher.query(
        "select rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname=$1",
        [PUBLISHER_LOGIN_ROLE],
      );
      assert.deepEqual(role.rows[0], {
        rolcanlogin: true,
        rolsuper: false,
        rolinherit: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
      });
      const memberships = await publisher.query(
        "select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname=$1",
        [PUBLISHER_LOGIN_ROLE],
      );
      assert.deepEqual(
        memberships.rows.map((r) => r.rolname),
        ["valo_content_publisher_dev"],
      );
      // As itself it reads nothing, not even the versions it publishes.
      await refused("select id from valo_content_versions limit 1");
      await refused("select id from valo_documents limit 1");
      // It cannot become the drafter, the reviewer or the customer scope.
      for (const other of ["valo_content_drafter_dev", "valo_content_reviewer_dev", "valo_workspace_scope"])
        await refused(`set local role ${other}`);
    });

    await t.test("as the publisher role it can release, and still reads no customer data", async () => {
      await publisher.query("BEGIN");
      try {
        await publisher.query("set local role valo_content_publisher_dev");
        const released = await publisher.query(
          "update valo_content_versions set status='published', published_at=now() where id=$1 returning status",
          [id],
        );
        assert.equal(released.rows[0]?.status, "published", "the database accepts the publisher's login");
      } finally {
        // Nothing stays published: the synthetic candidate passed no gate.
        await publisher.query("ROLLBACK");
      }
      assert.equal(await status(), "candidate");
      await publisher.query("BEGIN");
      try {
        await publisher.query("set local role valo_content_publisher_dev");
        for (const text of [
          "select id from valo_documents limit 1",
          "select id from valo_orders limit 1",
          "update valo_prices set amount_kobo=amount_kobo where false",
          `insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by) select gen_random_uuid(),template_id,2,slug||'-2',policy_id,candidate_hash,bundle,attestations,'candidate',review_by from valo_content_versions where id='${id}'`,
        ]) {
          await publisher.query("SAVEPOINT attempt");
          await assert.rejects(
            publisher.query(text),
            (error: { code?: string }) => error.code === "42501",
            text,
          );
          await publisher.query("ROLLBACK TO SAVEPOINT attempt");
        }
      } finally {
        await publisher.query("ROLLBACK");
      }
    });

    await t.test(
      "the release runs on the publisher's connection and still refuses a candidate that fails its gates",
      async () => {
        // The check that work which pays for reviews runs first finds the login in use.
        await assertPublisherCanLogIn();
        // The real publisher reaches its checks, which refuse the synthetic candidate's policy.
        await assert.rejects(() => publishOperationalVersion(id), /POLICY_NOT_TRUSTED|PUBLICATION_HELD/);
        assert.equal(await status(), "candidate");
      },
    );

    await t.test(
      "a publisher connection that is missing, or leads elsewhere, is refused before it is used",
      () => {
        const unavailable = (run: () => unknown) =>
          assert.throws(run, (error: { code?: string }) => error.code === PUBLISHER_LOGIN_UNAVAILABLE_CODE);
        unavailable(() => publisherConnectionString(undefined, application));
        unavailable(() => publisherConnectionString("", application));
        // The application's own login is not the publisher.
        unavailable(() => publisherConnectionString(application, application));
        // The publisher login of another database, or another server.
        const other = new URL(configured);
        other.pathname = "/another_database";
        unavailable(() => publisherConnectionString(other.href, application));
        const elsewhere = new URL(configured);
        elsewhere.port = "6543";
        unavailable(() => publisherConnectionString(elsewhere.href, application));
        unavailable(() => publisherConnectionString(configured, undefined));
      },
    );
  },
);

/**
 * A guide says what the law requires, so the publisher releases it only under the guidance policy
 * (decision 0017, point 1). Nothing here is published: each attempt is refused at the policy or held
 * by the gate, and the candidates are synthetic rows built from the retained drafts.
 */
test(
  "a guide is released only under the guidance policy, and a form only under the templates' policy",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db } = await import("@workspace/db");
    const { publishOperationalVersion } = await import("./publication-publisher");
    const { guidancePolicy } = await import("./guidance-policy");
    const { operationalPolicy } = await import("./operational-policy");
    const { assembledGuide, passagesReadAt } = await import("./guidance-release.fixtures");

    const now = new Date();
    const guidance = await guidancePolicy(),
      templates = await operationalPolicy();
    for (const { policy, authority } of [guidance, templates])
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policy.version},${policy.hash},${JSON.stringify(policy)}::jsonb,${JSON.stringify(authority)}::jsonb) on conflict do nothing`,
      );
    const save = async (bundle: PublicationBundle) => {
      const id = randomUUID(),
        name = `synthetic-guide-policy-${id}`;
      await db.transaction(async (tx) => {
        await tx.execute(sql.raw("set local role valo_content_drafter_dev"));
        await tx.execute(
          sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
            values(${id}::uuid,${name},${bundle.candidate.version},${name},${bundle.policy.version},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(bundle.candidate.reviewBy!)})`,
        );
      });
      return id;
    };
    const status = async (id: string) =>
      (await db.execute(sql`select status from valo_content_versions where id=${id}::uuid`)).rows[0]?.status;

    // The retained drafts and passages, as if the official texts had been read an hour ago: the
    // publisher runs on the real clock.
    const { bundle } = await assembledGuide("GUD-01", now, {
      passages: passagesReadAt(new Date(+now - 3_600_000)),
    });
    assert.equal(bundle.candidate.contentClass, "sourced_guidance");
    assert.equal(bundle.policy.hash, guidance.policy.hash);

    // Under the guidance policy the publisher reaches the gate, which holds the guide: it has no
    // reviews, and the owner has not approved the policy.
    const underGuidance = await save(bundle);
    await assert.rejects(
      () => publishOperationalVersion(underGuidance),
      (error: Error) => {
        assert.match(error.message, /^PUBLICATION_HELD:/);
        assert.match(error.message, /review_required:factual/);
        assert.equal(/policy_not_owner_approved/.test(error.message), !guidance.policy.ownerApproved);
        return true;
      },
    );
    assert.equal(guidance.policy.ownerApproved, false, "no approval of the guidance policy is recorded");
    assert.equal(await status(underGuidance), "candidate");

    // The same guide bound to the templates' policy is refused before the gate is asked.
    const underTemplates = await save({ ...bundle, policy: templates.policy });
    await assert.rejects(() => publishOperationalVersion(underTemplates), /POLICY_NOT_TRUSTED/);
    assert.equal(await status(underTemplates), "candidate");

    // And a form bound to the guidance policy is refused the same way.
    const form = heldSourceBundle(now, false);
    assert.equal(form.candidate.contentClass, "general_template");
    const formUnderGuidance = await save({ ...form, policy: guidance.policy });
    await assert.rejects(() => publishOperationalVersion(formUnderGuidance), /POLICY_NOT_TRUSTED/);
    assert.equal(await status(formUnderGuidance), "candidate");
  },
);
