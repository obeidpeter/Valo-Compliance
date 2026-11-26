import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import type { NextFunction, Request, Response } from "express";
import { contractOperations } from "../test-support/contract-operations";

/**
 * SEC-003: "Apply CSRF protection to cookie-authenticated mutations. Accept: … cross-site mutation
 * tests pass." A page on another site cannot make the API change anything, whoever is signed in
 * (docs/architecture/hostile-input.md, part 1).
 *
 * The browser signs in with the identity provider's session cookie, which it also sends on a request
 * another site's page makes. So every change in the contract is sent here as such a page could send
 * it: from that site, with no origin or a null one, with the browser's own word that it comes from
 * another site, and with a body a form sends without any script. Each must be refused, counted as
 * denied access for the security alerts (SEC-008), and leave the database as it was.
 *
 * It also holds the checks of the two probes of the development preview (valo-proxy-security.test.ts
 * and valo-http.test.ts) that need no preview: forwarding headers sent to the API itself, and how it
 * answers a malformed body, a signed-out read and a change from its own site without a sign-in.
 *
 * Only the identity provider is stood in for, as in the other HTTP tests: the server takes the account
 * from a header. Every account is synthetic, and the database is a disposable one.
 */
const enabled = process.env.VALO_RUN_DB_TESTS === "synthetic-development-only";

/** Changes another site's page may make, each with the reason it is safe. Each must be in the contract. */
const EXEMPT: Record<string, string> = {
  "POST /checker/preview":
    "The anonymous requirements check: it has no account and saves nothing but the visitor's count.",
};

/** The contract's one change whose body is not plain JSON; its own media type is sent where the site
 * itself would send it, so that only the origin decides. */
const OWN_MEDIA_TYPES: Record<string, string> = {
  "POST /admin/manual-library/{id}/drafts": "application/vnd.valo.manual-draft+json",
};

const HOSTILE = "https://hostile.synthetic.invalid";

test(
  "every change in the contract refuses a request from another site, counts it, and saves nothing",
  { skip: !enabled, timeout: 240_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const tag = randomUUID();
    const identityHeader = "x-synthetic-identity";
    const customer = `synthetic-cross-site-${tag}`;
    // Staff assignments name a sign-in account, which the provider writes as user_ followed by letters.
    const staff = `user_synthetic_cross_site_${tag.replaceAll("-", "")}`;
    const accounts = new Set([customer, staff]);
    t.mock.module("@clerk/express", {
      namedExports: {
        clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
        getAuth: (req: Request) => {
          const id = req.header(identityHeader);
          const known = id && accounts.has(id) ? id : null;
          // The member of staff has just passed both sign-in factors, as a staff change needs.
          const fresh = known === staff;
          return {
            userId: known,
            sessionId: known ? `sess_${known}` : null,
            sessionClaims: fresh ? { fva: [0, 0] } : null,
            has: () => fresh,
          };
        },
        clerkClient: {
          sessions: {
            getSession: async (id: string) => ({ status: "active", userId: id.slice("sess_".length) }),
          },
          users: {
            getUser: async (id: string) => ({
              id,
              banned: false,
              locked: false,
              twoFactorEnabled: id === staff,
              primaryEmailAddressId: "primary",
              emailAddresses: [
                {
                  id: "primary",
                  emailAddress: "synthetic@example.invalid",
                  verification: { status: "verified" },
                },
              ],
            }),
          },
        },
      },
    });
    const { default: app } = await import("../app");
    const { db, pool, valoStaffAssignments } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { resolveWorkspace } = await import("../modules/workspaces");

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;

    /** Every table's rows, as one digest a table, but the security counts, which refusals add to. */
    const tables = async () => {
      const { rows } = await pool.query<{ name: string; digest: string }>(`
        SELECT c.relname AS name,
          (xpath('/row/d/text()', query_to_xml(format(
            'SELECT md5(coalesce(string_agg(t::text, chr(10) ORDER BY t::text), %L)) AS d FROM %I.%I t',
            '', n.nspname, c.relname), false, true, '')))[1]::text AS digest
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'valo_security_signals'
        ORDER BY c.relname`);
      return new Map(rows.map((row) => [row.name, row.digest]));
    };
    const deniedCount = async () =>
      Number(
        (
          await pool.query<{ total: string }>(
            "SELECT coalesce(sum(count), 0)::text AS total FROM valo_security_signals WHERE kind = 'denied_access'",
          )
        ).rows[0]!.total,
      );
    /** Each refusal this test caused, which the security counts must show. */
    let refused = 0;
    const send = async (path: string, init: RequestInit & { headers?: Record<string, string> }) => {
      const reply = await fetch(`${base}/api${path}`, init);
      if (reply.status === 401 || reply.status === 403) refused++;
      const text = await reply.text();
      let code: string | undefined;
      try {
        code = (JSON.parse(text) as { code?: string }).code;
      } catch {
        code = undefined;
      }
      return { status: reply.status, code, text, headers: reply.headers };
    };

    try {
      await resolveWorkspace(customer);
      // Every role but the reviewer's, which no one holds with the content role (the reviewer's own
      // routes check the origin before the role). So each staff change would be allowed but for where
      // the request comes from.
      await db.insert(valoStaffAssignments).values(
        (["content", "support", "finance", "system", "privacy"] as const).map((role) => ({
          id: randomUUID(),
          identityId: staff,
          role,
          grantedBy: "synthetic-cross-site",
          reason: "Synthetic member of staff for the cross-site change test",
        })),
      );
      const before = await tables();
      const deniedBefore = await deniedCount();

      await t.test("each change from another site is refused, even for staff who hold its role", async () => {
        const contract = readFileSync(
          new URL("../../../../lib/api-spec/openapi.yaml", import.meta.url),
          "utf8",
        );
        // The media types of request bodies other than JSON, which the contract writes inline.
        const declared = new Set(contract.match(/application\/vnd\.valo\.[a-z0-9.+-]+/g) ?? []);
        assert.deepEqual([...declared].sort(), Object.values(OWN_MEDIA_TYPES).sort());
        const operations = contractOperations();
        const changes = operations.filter((operation) => operation.method !== "GET");
        for (const key of [...Object.keys(EXEMPT), ...Object.keys(OWN_MEDIA_TYPES)])
          assert.ok(
            changes.some((operation) => operation.key === key),
            `${key} is not a change in the contract`,
          );
        assert.ok(changes.length >= 77, `only ${changes.length} changes in the contract`);
        const attempts: {
          name: string;
          headers: Record<string, string>;
          body: () => string | FormData;
        }[] = [
          { name: "from another site", headers: { Origin: HOSTILE }, body: () => "{}" },
          { name: "with no origin", headers: {}, body: () => "{}" },
          { name: "with a null origin", headers: { Origin: "null" }, body: () => "{}" },
          {
            name: "that the browser says comes from another site",
            headers: { Origin: base, "Sec-Fetch-Site": "cross-site" },
            body: () => "{}",
          },
          {
            name: "that the browser says comes from a sibling site",
            headers: { Origin: base, "Sec-Fetch-Site": "same-site" },
            body: () => "{}",
          },
          {
            name: "as plain text, which a form sends",
            headers: { Origin: base, "Content-Type": "text/plain" },
            body: () => "{}",
          },
          {
            name: "form-encoded",
            headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" },
            body: () => "synthetic=1",
          },
          {
            name: "as multipart form data",
            headers: { Origin: base },
            body: () => {
              const form = new FormData();
              form.append("synthetic", "1");
              return form;
            },
          },
        ];
        const failures: string[] = [];
        let sent = 0;
        for (const operation of changes) {
          if (EXEMPT[operation.key]) continue;
          // Any value reaches the route: the check comes before a path's values are read.
          const path = operation.path.replace(/\{[^}]+\}/g, () => randomUUID());
          const identity = operation.path.startsWith("/admin")
            ? staff
            : operation.path.startsWith("/public")
              ? null
              : customer;
          const media = OWN_MEDIA_TYPES[operation.key] ?? "application/json";
          for (const attempt of attempts) {
            const headers: Record<string, string> = {
              ...(attempt.headers["Content-Type"] || attempt.name === "as multipart form data"
                ? {}
                : { "Content-Type": media }),
              ...attempt.headers,
              ...(identity ? { [identityHeader]: identity } : {}),
            };
            const reply = await send(path, { method: operation.method, headers, body: attempt.body() });
            sent++;
            if (reply.status !== 403 || reply.code !== "UNTRUSTED_ORIGIN")
              failures.push(
                `${operation.key} ${attempt.name}: ${reply.status} ${reply.code ?? reply.text.slice(0, 80)}`,
              );
          }
        }
        assert.deepEqual(failures, [], "every change must refuse a request another site's page could send");
        assert.ok(sent >= 76 * attempts.length);
      });

      await t.test(
        "forwarding headers sent to the API itself cannot change which site it trusts",
        async () => {
          const port = Number(new URL(base).port);
          const cases = [
            {
              label: "matching hostile host and protocol",
              origin: HOSTILE,
              headers: { "x-forwarded-host": "hostile.synthetic.invalid", "x-forwarded-proto": "https" },
            },
            {
              label: "a list of hops, the hostile host first",
              origin: HOSTILE,
              headers: {
                "x-forwarded-host": `hostile.synthetic.invalid, 127.0.0.1:${port}`,
                "x-forwarded-proto": "https, http",
              },
            },
            {
              label: "a list of hops, the trusted host first",
              origin: HOSTILE,
              headers: {
                "x-forwarded-host": `127.0.0.1:${port}, hostile.synthetic.invalid`,
                "x-forwarded-proto": "http, https",
              },
            },
            {
              label: "the wrong scheme, despite a matching forwarded protocol",
              origin: base.replace("http:", "https:"),
              headers: { "x-forwarded-proto": "https" },
            },
            {
              label: "the wrong port",
              origin: `http://127.0.0.1:${port + 1}`,
              headers: { "x-forwarded-host": `127.0.0.1:${port + 1}` },
            },
            {
              label: "the standard Forwarded header",
              origin: HOSTILE,
              headers: { forwarded: "host=hostile.synthetic.invalid;proto=https" },
            },
            { label: "two Origin values", origin: `${base}, ${HOSTILE}`, headers: {} },
          ];
          for (const c of cases) {
            const reply = await send("/workspace/documents", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Origin: c.origin,
                ...c.headers,
                [identityHeader]: customer,
              },
              body: "{}",
            });
            assert.equal(reply.status, 403, c.label);
            assert.equal(reply.code, "UNTRUSTED_ORIGIN", c.label);
          }
          // The site's own origin, with forwarding headers spoofed, still has to sign in.
          const reply = await send("/workspace/documents", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Origin: base,
              "x-forwarded-host": "hostile.synthetic.invalid, another.invalid",
              "x-forwarded-proto": "http, https",
            },
            body: "{}",
          });
          assert.equal(
            reply.status,
            401,
            "forwarding headers neither grant an identity nor refuse the site's own origin",
          );
        },
      );

      await t.test(
        "malformed and oversized bodies fail plainly, without repeating what was sent",
        async () => {
          for (const [body, status] of [
            ['{"synthetic":', 400],
            [JSON.stringify({ synthetic: "x".repeat(132_000) }), 413],
          ] as const) {
            const reply = await send("/workspace/documents", {
              method: "POST",
              headers: { "Content-Type": "application/json", Origin: base, [identityHeader]: customer },
              body,
            });
            assert.equal(reply.status, status);
            assert.ok(reply.headers.get("cache-control")?.includes("no-store"));
            assert.ok(!reply.text.includes("synthetic"), "the answer repeats what was sent");
          }
        },
      );

      await t.test("a change from the site's own pages still has to be signed in", async () => {
        const reply = await send("/workspace/documents", {
          method: "POST",
          headers: { "Content-Type": "application/json", Origin: base },
          body: JSON.stringify({ title: "Synthetic request without a sign-in" }),
        });
        assert.equal(reply.status, 401);
      });

      const after = await tables();
      const changed = [...after]
        .filter(([name, digest]) => before.get(name) !== digest)
        .map(([name]) => name);
      assert.deepEqual(changed, [], "a refused change saved something");
      // The digest of no rows. The workspaces hold this test's customer, so theirs must differ from it.
      const noRows = "d41d8cd98f00b204e9800998ecf8427e";
      assert.ok(after.size >= 50, `only ${after.size} tables compared`);
      assert.notEqual(after.get("valo_workspaces") ?? noRows, noRows, "the comparison read no rows");

      // The comparison sees a change when one is saved: the same kind of request, from the site's own
      // page, saves a task.
      const made = await send("/workspace/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: base, [identityHeader]: customer },
        body: JSON.stringify({
          title: "Synthetic task from the site's own page",
          notes: "",
          dueDate: null,
          dateConfirmed: false,
          assessmentId: null,
          ruleId: null,
        }),
      });
      assert.ok(made.status >= 200 && made.status < 300, `${made.status} ${made.text.slice(0, 160)}`);
      const saved = [...(await tables())]
        .filter(([name, digest]) => after.get(name) !== digest)
        .map(([name]) => name);
      assert.ok(
        saved.includes("valo_tasks"),
        `the comparison did not see the saved task (${saved.join(", ")})`,
      );

      // After that comparison, as every read counts against the reader's limit, which is saved.
      await t.test(
        "private reads made signed out are refused, kept from shared caches and not shared",
        async () => {
          const id = randomUUID();
          for (const path of [
            "/workspace",
            "/workspace/documents",
            `/workspace/documents/${id}/revisions`,
            `/v1/documents/${id}/exports`,
            `/v1/exports/${id}/file`,
          ]) {
            const reply = await send(path, {});
            assert.equal(reply.status, 401, path);
            assert.ok(reply.headers.get("cache-control")?.includes("no-store"), path);
            assert.equal(reply.headers.get("access-control-allow-origin"), null, path);
            const error = JSON.parse(reply.text) as { code: string; requestId: string; message: string };
            assert.ok(error.code && error.requestId && error.message, path);
          }
        },
      );

      // Each refusal is counted after its answer is sent, so the counts may still be on their way.
      let counted = 0;
      for (let poll = 0; poll < 100; poll++) {
        counted = (await deniedCount()) - deniedBefore;
        if (counted >= refused) break;
        await delay(100);
      }
      assert.equal(counted, refused, "each refusal is counted as denied access");
    } finally {
      await db
        .update(valoStaffAssignments)
        .set({ active: false })
        .where(eq(valoStaffAssignments.identityId, staff));
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await pool.end();
    }
  },
);
