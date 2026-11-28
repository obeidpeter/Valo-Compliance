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
    const { draftSynthetic } = await import("../../test-support/drafted-content");
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
    // Drafting adds candidates, on its own login; this is the only way content versions are created.
    await draftSynthetic((tx) =>
      tx.execute(
        sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
          values(${id}::uuid,${prefix},1,${prefix},${prefix},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86_400_000)})`,
      ),
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
        draftSynthetic((tx) =>
          tx.execute(sql`update valo_content_versions set status='published' where id=${id}::uuid`),
        ),
        databaseError("42501"),
      );
    });

    await t.test("a drafter cannot add a version straight into published state", async () => {
      await assert.rejects(
        draftSynthetic((tx) =>
          tx.execute(
            sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
              values(${randomUUID()}::uuid,${prefix},2,${`${prefix}-2`},${prefix},'forged','{}','{}','published',${new Date(Date.now() + 86_400_000)})`,
          ),
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
    const { draftSynthetic } = await import("../../test-support/drafted-content");

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
    await draftSynthetic((tx) =>
      tx.execute(
        sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
          values(${id}::uuid,${prefix},1,${prefix},${prefix},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86_400_000)})`,
      ),
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
 * Drafting's own login (docs/architecture/service-logins.md, part 1; SEC-006). The database adds a
 * content version or a prepared candidate only in a session that logged in as valo_drafter_login, as
 * the drafter role. Every candidate here is synthetic, and every one the database accepts is rolled back.
 */
test(
  "a content version or a prepared candidate is added only by a session that logged in as the drafting login",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, drafterLogin, DRAFTER_LOGIN_ROLE, DRAFTER_LOGIN_UNAVAILABLE_CODE } =
      await import("@workspace/db");
    const { assertDrafterCanLogIn } = await import("./drafting-login");
    const { default: pg } = await import("pg");

    const prefix = `synthetic-drafter-login-${randomUUID()}`,
      bundle = heldSourceBundle(new Date(), false),
      hash = "b".repeat(64);
    await db.execute(
      sql`insert into valo_publication_policies(id,hash,policy,authority) values(${prefix},${digest(bundle.policy)},${JSON.stringify(bundle.policy)}::jsonb,'{"synthetic":true,"approved":false}')`,
    );
    const asRole = (role: string | null, query: ReturnType<typeof sql>) =>
      db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        return tx.execute(query);
      });
    const left = async () =>
      (
        await db.execute(sql`select
          (select count(*)::int from valo_content_versions where template_id=${prefix}) as versions,
          (select count(*)::int from valo_prepared_candidates where template_id=${prefix}) as prepared`)
      ).rows[0];
    const needsDrafter = databaseError(/added only by a session that logged in as valo_drafter_login/);

    await t.test(
      "the application's own login cannot add a candidate or a prepared candidate, whatever role it takes",
      async () => {
        for (const add of [
          sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
            values(${randomUUID()}::uuid,${prefix},1,${prefix},${prefix},${hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(Date.now() + 86_400_000)})`,
          sql`insert into valo_prepared_candidates(artifact_id,artifact_hash,version_id,template_id,version,candidate_hash,prepared_at,review_by)
            values(${randomUUID()}::uuid,${"a".repeat(64)},${randomUUID()}::uuid,${prefix},1,${hash},now(),${new Date(Date.now() + 86_400_000)})`,
        ]) {
          await assert.rejects(asRole(null, add), needsDrafter);
          await assert.rejects(asRole("valo_content_drafter_dev", add), needsDrafter);
          await assert.rejects(asRole("valo_content_drafter_dev", add), databaseError("42501"));
        }
        assert.deepEqual(await left(), { versions: 0, prepared: 0 });
      },
    );

    // One session that logged in as the drafting login, as drafting does.
    const application = process.env.DATABASE_URL!,
      configured = drafterLogin.connectionString(process.env.VALO_DRAFTER_DATABASE_URL, application);
    const drafter = new pg.Client({ connectionString: configured });
    await drafter.connect();
    t.after(() => drafter.end());
    const addVersion = {
      text: `insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
        values(gen_random_uuid(),$1,1,$1,$1,$2,$3::jsonb,'{}','candidate',now()+interval '1 day') returning status`,
      values: [prefix, hash, JSON.stringify(bundle)],
    };
    const addPrepared = {
      text: `insert into valo_prepared_candidates(artifact_id,artifact_hash,version_id,template_id,version,candidate_hash,prepared_at,review_by)
        values(gen_random_uuid(),$2,gen_random_uuid(),$1,1,$3,now(),now()+interval '1 day') returning version`,
      values: [prefix, "a".repeat(64), hash],
    };
    const refused = async (query: string | { text: string; values: unknown[] }) => {
      await drafter.query("BEGIN");
      try {
        await assert.rejects(
          drafter.query(query),
          (error: { code?: string }) => error.code === "42501",
          typeof query === "string" ? query : query.text,
        );
      } finally {
        await drafter.query("ROLLBACK");
      }
    };

    await t.test("the drafting login holds nothing itself and can become only the drafter", async () => {
      const who = await drafter.query("select session_user as login, current_user as acting");
      assert.deepEqual(who.rows[0], { login: DRAFTER_LOGIN_ROLE, acting: DRAFTER_LOGIN_ROLE });
      const role = await drafter.query(
        "select rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname=$1",
        [DRAFTER_LOGIN_ROLE],
      );
      assert.deepEqual(role.rows[0], {
        rolcanlogin: true,
        rolsuper: false,
        rolinherit: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
      });
      const memberships = await drafter.query(
        "select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname=$1",
        [DRAFTER_LOGIN_ROLE],
      );
      assert.deepEqual(
        memberships.rows.map((r) => r.rolname),
        ["valo_content_drafter_dev"],
      );
      // As itself it adds and reads nothing.
      await refused(addVersion);
      await refused(addPrepared);
      await refused("select id from valo_content_versions limit 1");
      await refused("select id from valo_documents limit 1");
      // It cannot become the publisher, the reviewer or the customer scope.
      for (const other of ["valo_content_publisher_dev", "valo_content_reviewer_dev", "valo_workspace_scope"])
        await refused(`set local role ${other}`);
    });

    await t.test(
      "as the drafter role it adds candidates, and reads no customer data, publishes nothing and changes no policy",
      async () => {
        await drafter.query("BEGIN");
        try {
          await drafter.query("set local role valo_content_drafter_dev");
          const added = await drafter.query(addVersion);
          assert.equal(added.rows[0]?.status, "candidate", "the database accepts the drafting login");
          const prepared = await drafter.query(addPrepared);
          assert.equal(prepared.rows[0]?.version, 1);
          for (const text of [
            "select id from valo_documents limit 1",
            "select id from valo_orders limit 1",
            `update valo_content_versions set status='published', published_at=now() where template_id='${prefix}'`,
            `update valo_publication_policies set hash='forged' where id='${prefix}'`,
          ]) {
            await drafter.query("SAVEPOINT attempt");
            await assert.rejects(
              drafter.query(text),
              (error: { code?: string }) => error.code === "42501",
              text,
            );
            await drafter.query("ROLLBACK TO SAVEPOINT attempt");
          }
        } finally {
          // Nothing stays: the synthetic candidates passed no gate.
          await drafter.query("ROLLBACK");
        }
        assert.deepEqual(await left(), { versions: 0, prepared: 0 });
      },
    );

    await t.test("the check a preparation runs first finds the drafting login in use", async () => {
      await assertDrafterCanLogIn();
    });

    await t.test(
      "a drafting connection that is missing, or leads elsewhere, is refused before it is used",
      () => {
        const unavailable = (run: () => unknown) =>
          assert.throws(run, (error: { code?: string }) => error.code === DRAFTER_LOGIN_UNAVAILABLE_CODE);
        unavailable(() => drafterLogin.connectionString(undefined, application));
        unavailable(() => drafterLogin.connectionString("", application));
        // The application's own login, and the publisher's, are not drafting's.
        unavailable(() => drafterLogin.connectionString(application, application));
        const publisher = new URL(configured);
        publisher.username = "valo_publisher_login";
        unavailable(() => drafterLogin.connectionString(publisher.href, application));
        // The drafting login of another database, or another server.
        const other = new URL(configured);
        other.pathname = "/another_database";
        unavailable(() => drafterLogin.connectionString(other.href, application));
        const elsewhere = new URL(configured);
        elsewhere.port = "6543";
        unavailable(() => drafterLogin.connectionString(elsewhere.href, application));
        unavailable(() => drafterLogin.connectionString(configured, undefined));
      },
    );
  },
);

/**
 * Review's own login (docs/architecture/service-logins.md, part 2; SEC-006). The database records and
 * updates an AI review's attempt only in a session that logged in as valo_reviewer_login, and a drafting
 * attempt only in one that logged in as valo_drafter_login; no attempt is removed. Every attempt the
 * database accepts here is rolled back.
 */
test(
  "an AI review's attempt is recorded only by the review login, a drafting attempt only by the drafting login, and none is removed",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db, drafterLogin, reviewerLogin, REVIEWER_LOGIN_ROLE, REVIEWER_LOGIN_UNAVAILABLE_CODE } =
      await import("@workspace/db");
    const { assertReviewerCanLogIn } = await import("../editorial/operational-review");
    const { default: pg } = await import("pg");

    const candidate = `synthetic-attempt-${randomUUID()}`,
      request = `synthetic-request-${randomUUID()}`;
    const left = async () =>
      Number(
        (
          await db.execute(
            sql`select count(*)::int as n from valo_publication_ai_attempts where candidate_hash=${candidate}`,
          )
        ).rows[0]!.n,
      );
    const asRole = (role: string | null, query: ReturnType<typeof sql>) =>
      db.transaction(async (tx) => {
        if (role) await tx.execute(sql.raw(`set local role ${role}`));
        return tx.execute(query);
      });
    const needsReviewer = databaseError(
      /review attempt is recorded only by a session that logged in as valo_reviewer_login/,
    );
    const needsDrafter = databaseError(
      /drafting attempt is recorded only by a session that logged in as valo_drafter_login/,
    );
    const reviewAttempt = sql`insert into valo_publication_ai_attempts(candidate_hash,role,request_hash,request_meter,outcome)
      values(${candidate},'factual',${request},'{}'::jsonb,'reserved')`;
    const draftAttempt = sql`insert into valo_publication_ai_attempts(candidate_hash,role) values(${candidate},'draft')`;

    await t.test(
      "the application's own login records no attempt, as itself or as either service's role",
      async () => {
        await assert.rejects(asRole(null, reviewAttempt), needsReviewer);
        await assert.rejects(asRole("valo_content_reviewer_dev", reviewAttempt), needsReviewer);
        await assert.rejects(asRole(null, draftAttempt), needsDrafter);
        await assert.rejects(asRole("valo_content_drafter_dev", draftAttempt), needsDrafter);
        assert.equal(await left(), 0);
      },
    );

    // One session that logged in as each login, as review and drafting do.
    const application = process.env.DATABASE_URL!,
      configured = reviewerLogin.connectionString(process.env.VALO_REVIEWER_DATABASE_URL, application);
    const reviewer = new pg.Client({ connectionString: configured });
    const drafter = new pg.Client({
      connectionString: drafterLogin.connectionString(process.env.VALO_DRAFTER_DATABASE_URL, application),
    });
    await reviewer.connect();
    t.after(() => reviewer.end());
    await drafter.connect();
    t.after(() => drafter.end());
    const addReview = {
      text: `insert into valo_publication_ai_attempts(candidate_hash,role,request_hash,request_meter,outcome)
        values($1,'challenge',$2,'{}'::jsonb,'reserved') returning id`,
      values: [candidate, request],
    };
    const addDraft = {
      text: "insert into valo_publication_ai_attempts(candidate_hash,role) values($1,'draft') returning id",
      values: [candidate],
    };
    const refusedIn = async (
      client: InstanceType<typeof pg.Client>,
      query: string | { text: string; values: unknown[] },
      message?: RegExp,
    ) => {
      await client.query("SAVEPOINT attempt");
      await assert.rejects(
        client.query(query),
        (error: { code?: string; message?: string }) =>
          error.code === "42501" && (!message || message.test(String(error.message))),
        typeof query === "string" ? query : query.text,
      );
      await client.query("ROLLBACK TO SAVEPOINT attempt");
    };

    await t.test("the review login holds nothing itself and can become only the reviewer", async () => {
      const who = await reviewer.query("select session_user as login, current_user as acting");
      assert.deepEqual(who.rows[0], { login: REVIEWER_LOGIN_ROLE, acting: REVIEWER_LOGIN_ROLE });
      const role = await reviewer.query(
        "select rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolbypassrls from pg_roles where rolname=$1",
        [REVIEWER_LOGIN_ROLE],
      );
      assert.deepEqual(role.rows[0], {
        rolcanlogin: true,
        rolsuper: false,
        rolinherit: false,
        rolcreaterole: false,
        rolcreatedb: false,
        rolbypassrls: false,
      });
      const memberships = await reviewer.query(
        "select r.rolname from pg_auth_members m join pg_roles r on r.oid=m.roleid join pg_roles u on u.oid=m.member where u.rolname=$1",
        [REVIEWER_LOGIN_ROLE],
      );
      assert.deepEqual(
        memberships.rows.map((r) => r.rolname),
        ["valo_content_reviewer_dev"],
      );
      await reviewer.query("BEGIN");
      try {
        // As itself it records and reads nothing.
        await refusedIn(reviewer, addReview);
        await refusedIn(reviewer, "select id from valo_documents limit 1");
        // It cannot become the drafter, the publisher or the customer scope.
        for (const other of [
          "valo_content_drafter_dev",
          "valo_content_publisher_dev",
          "valo_workspace_scope",
        ])
          await refusedIn(reviewer, `set local role ${other}`);
      } finally {
        await reviewer.query("ROLLBACK");
      }
    });

    await t.test(
      "as the reviewer role it records a review's attempt and how it went, and nothing else",
      async () => {
        await reviewer.query("BEGIN");
        try {
          await reviewer.query("set local role valo_content_reviewer_dev");
          const id = (await reviewer.query(addReview)).rows[0]?.id;
          assert.ok(id, "the database accepts the review login");
          await reviewer.query(
            "update valo_publication_ai_attempts set outcome='response_received', provider_response_id='synthetic-response', input_tokens=1, output_tokens=1 where id=$1",
            [id],
          );
          await reviewer.query(
            "update valo_publication_ai_attempts set outcome='completed', completed_at=now() where id=$1",
            [id],
          );
          // Not a drafting attempt, and not another column of the attempt.
          await refusedIn(reviewer, addDraft, /valo_drafter_login/);
          await refusedIn(reviewer, {
            text: "update valo_publication_ai_attempts set role='draft' where id=$1",
            values: [id],
          });
          await refusedIn(reviewer, {
            text: "delete from valo_publication_ai_attempts where id=$1",
            values: [id],
          });
          // No content, no customer data, no release and no policy.
          for (const text of [
            "select id from valo_documents limit 1",
            `insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,review_by) select gen_random_uuid(),template_id,version+1000,slug||'-x',policy_id,candidate_hash,bundle,attestations,review_by from valo_content_versions limit 1`,
            "update valo_content_versions set status='published' where false",
            "update valo_publication_policies set hash=hash where false",
          ])
            await refusedIn(reviewer, text);
        } finally {
          // Nothing stays: the attempt was synthetic.
          await reviewer.query("ROLLBACK");
        }
        assert.equal(await left(), 0);
      },
    );

    await t.test("as the drafter role, drafting records its own attempt and no review's", async () => {
      await drafter.query("BEGIN");
      try {
        await drafter.query("set local role valo_content_drafter_dev");
        const id = (await drafter.query(addDraft)).rows[0]?.id;
        assert.ok(id, "the database accepts the drafting login");
        // Drafting cannot record a review of what it drafted, or change how an attempt went. A review's
        // attempt needs columns the drafter role may not write; one written with only the columns it
        // may write is refused by the database's check of the login.
        await refusedIn(drafter, addReview, /permission denied/);
        await refusedIn(
          drafter,
          {
            text: "insert into valo_publication_ai_attempts(candidate_hash,role) values($1,'factual')",
            values: [candidate],
          },
          /valo_reviewer_login/,
        );
        await refusedIn(drafter, {
          text: "update valo_publication_ai_attempts set outcome='completed' where id=$1",
          values: [id],
        });
      } finally {
        await drafter.query("ROLLBACK");
      }
      assert.equal(await left(), 0);
    });

    await t.test("the application's own login neither changes nor removes a review's attempt", async () => {
      // One transaction on the application's connection: it becomes the review login to record an
      // attempt, as only the test cluster's owner can, then returns to its own login.
      const outcome = await db
        .transaction(async (tx) => {
          await tx.execute(sql`SET LOCAL SESSION AUTHORIZATION valo_reviewer_login`);
          await tx.execute(sql`SET LOCAL ROLE valo_content_reviewer_dev`);
          await tx.execute(reviewAttempt);
          await tx.execute(sql`SET LOCAL SESSION AUTHORIZATION DEFAULT`);
          await assert.rejects(
            tx.transaction((sp) =>
              sp.execute(
                sql`update valo_publication_ai_attempts set outcome='completed' where candidate_hash=${candidate}`,
              ),
            ),
            needsReviewer,
          );
          await assert.rejects(
            tx.transaction((sp) =>
              sp.execute(sql`delete from valo_publication_ai_attempts where candidate_hash=${candidate}`),
            ),
            databaseError(/An AI attempt is never removed/),
          );
          throw Error("ROLLED_BACK");
        })
        .catch((error: Error) => error.message);
      assert.equal(outcome, "ROLLED_BACK");
      assert.equal(await left(), 0);
    });

    await t.test("the check before reviews are paid for finds the review login in use", async () => {
      await assertReviewerCanLogIn();
    });

    await t.test(
      "a review connection that is missing, or leads elsewhere, is refused before it is used",
      () => {
        const unavailable = (run: () => unknown) =>
          assert.throws(run, (error: { code?: string }) => error.code === REVIEWER_LOGIN_UNAVAILABLE_CODE);
        unavailable(() => reviewerLogin.connectionString(undefined, application));
        unavailable(() => reviewerLogin.connectionString("", application));
        // The application's own login, drafting's and the publisher's are not review's.
        unavailable(() => reviewerLogin.connectionString(application, application));
        for (const name of ["valo_drafter_login", "valo_publisher_login"]) {
          const other = new URL(configured);
          other.username = name;
          unavailable(() => reviewerLogin.connectionString(other.href, application));
        }
        const another = new URL(configured);
        another.pathname = "/another_database";
        unavailable(() => reviewerLogin.connectionString(another.href, application));
        const elsewhere = new URL(configured);
        elsewhere.port = "6543";
        unavailable(() => reviewerLogin.connectionString(elsewhere.href, application));
        unavailable(() => reviewerLogin.connectionString(configured, undefined));
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
    const { draftSynthetic } = await import("../../test-support/drafted-content");

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
      await draftSynthetic((tx) =>
        tx.execute(
          sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
            values(${id}::uuid,${name},${bundle.candidate.version},${name},${bundle.policy.version},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(bundle.candidate.reviewBy!)})`,
        ),
      );
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
    // reviews. The policy is the text the owner approved, so the policy is not among the reasons.
    const underGuidance = await save(bundle);
    await assert.rejects(
      () => publishOperationalVersion(underGuidance),
      (error: Error) => {
        assert.match(error.message, /^PUBLICATION_HELD:/);
        assert.match(error.message, /review_required:factual/);
        assert.doesNotMatch(error.message, /policy_not_owner_approved/);
        return true;
      },
    );
    assert.equal(
      guidance.policy.ownerApproved,
      true,
      "the recorded approval is of the policy file as it stands",
    );
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

/**
 * A template that rests on the law is checked only against the source-backed policy for templates
 * (docs/architecture/reviewed-route.md, part 4), whose text the owner has not approved. Nothing here
 * is published: each attempt is refused at the policy or held by the gate, and the candidates are
 * synthetic rows.
 */
test(
  "a template that rests on the law is checked only against its own policy, and held while no text of it is approved",
  { skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only", timeout: 60_000 },
  async () => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const { db } = await import("@workspace/db");
    const { publishOperationalVersion } = await import("./publication-publisher");
    const { operationalPolicy } = await import("./operational-policy");
    const { templateLawPolicy } = await import("./template-law-policy");
    const { draftSynthetic } = await import("../../test-support/drafted-content");

    const now = new Date();
    const law = await templateLawPolicy(),
      templates = await operationalPolicy();
    assert.equal(law.policy.ownerApproved, false, "the owner has approved no text of the file");
    // A test's supposed approval of the file's own text. A bundle that carries it is refused all the
    // same: the publisher reads the approval the code records, which is none.
    const supposed = await templateLawPolicy({ approvedHash: law.authority[0]!.hash });
    assert.equal(supposed.policy.ownerApproved, true);
    for (const { policy, authority } of [law, templates, supposed])
      await db.execute(
        sql`insert into valo_publication_policies(id,hash,policy,authority) values(${policy.version},${policy.hash},${JSON.stringify(policy)}::jsonb,${JSON.stringify(authority)}::jsonb) on conflict do nothing`,
      );
    const save = async (bundle: PublicationBundle) => {
      const id = randomUUID(),
        name = `synthetic-template-law-${id}`;
      await draftSynthetic((tx) =>
        tx.execute(
          sql`insert into valo_content_versions(id,template_id,version,slug,policy_id,candidate_hash,bundle,attestations,status,review_by)
            values(${id}::uuid,${name},${bundle.candidate.version},${name},${bundle.policy.version},${bundle.candidate.hash},${JSON.stringify(bundle)}::jsonb,'{}','candidate',${new Date(bundle.candidate.reviewBy!)})`,
        ),
      );
      return id;
    };
    const status = async (id: string) =>
      (await db.execute(sql`select status from valo_content_versions where id=${id}::uuid`)).rows[0]?.status;

    // The shape of a template that rests on the law: a template held in the regulatory mode, with a
    // source. It is a synthetic candidate, not TPL-31's.
    const held = heldSourceBundle(now);
    const template: PublicationBundle = {
      ...held,
      candidate: { ...held.candidate, contentClass: "general_template" },
    };
    assert.equal(template.candidate.evidenceMode, "regulatory");

    // Under its own policy the publisher reaches the gate, which holds it, the policy among the reasons.
    const underLaw = await save({ ...template, policy: law.policy });
    await assert.rejects(
      () => publishOperationalVersion(underLaw),
      (error: Error) => {
        assert.match(error.message, /^PUBLICATION_HELD:/);
        assert.match(error.message, /policy_not_owner_approved/);
        return true;
      },
    );
    assert.equal(await status(underLaw), "candidate");

    // Bound to the templates' own policy, or to an approval the code does not record, it is refused
    // before the gate is asked.
    for (const policy of [templates.policy, supposed.policy]) {
      const id = await save({ ...template, policy });
      await assert.rejects(() => publishOperationalVersion(id), /POLICY_NOT_TRUSTED/);
      assert.equal(await status(id), "candidate");
    }

    // And an original form that quotes no law, bound to this policy, is refused the same way.
    const form = heldSourceBundle(now, false);
    assert.equal(form.candidate.evidenceMode, "original_operational");
    const formUnderLaw = await save({ ...form, policy: law.policy });
    await assert.rejects(() => publishOperationalVersion(formUnderLaw), /POLICY_NOT_TRUSTED/);
    assert.equal(await status(formUnderLaw), "candidate");
  },
);
