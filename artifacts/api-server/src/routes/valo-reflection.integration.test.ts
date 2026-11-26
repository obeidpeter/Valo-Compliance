import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { NextFunction, Request, Response } from "express";
import { contractOperations } from "../test-support/contract-operations";
import { LONG_MARKUP, MARK, SHORT_MARKUP } from "../test-support/hostile-markup";
import { NO_ROWS, changedTables, tableDigests } from "../test-support/table-digests";

/**
 * SEC-003: "Accept: stored/reflected XSS, injection … tests pass." What a caller sends never comes back
 * as a page a browser would run (docs/architecture/hostile-input.md, part 3).
 *
 * Every operation in the contract is sent hostile markup and SQL text in each of its path's values, in
 * its query, each value twice, and, for a change, in its body's keys and values, from the site's own
 * page and, where it needs an account, signed in, so that it reaches the route's own checks. Every
 * answer must be JSON or empty, never HTML, and name its character set; carry the headers that stop a
 * browser reading it as another type, running or loading anything from it, framing it or sending its
 * address on, and HSTS for a year; be kept from shared caches when it is private; and be no failure of
 * the server's own. No request may change the prototype every object inherits. An address the API does
 * not have, a folder, TRACE, a malformed body and an oversized one are answered the same way, as are
 * refusals before any route is reached, and no read changes anything but the counts reads keep. The security baseline cites these checks by their OWASP
 * ASVS 5.0.0 identifiers (docs/registers/security-baseline.json).
 *
 * Only the identity provider is stood in for. Every account is synthetic, and the database is a
 * disposable one.
 */
const enabled = process.env.VALO_RUN_DB_TESTS === "synthetic-development-only";

/** The contract's one change whose body is not plain JSON. */
const OWN_MEDIA_TYPES: Record<string, string> = {
  "POST /admin/manual-library/{id}/drafts": "application/vnd.valo.manual-draft+json",
};

test(
  "hostile text sent to every operation in the contract comes back only inside JSON with the security headers, fails no route, and stays text in the database and its searches",
  { skip: !enabled, timeout: 240_000 },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const tag = randomUUID();
    const identityHeader = "x-synthetic-identity";
    const customer = `synthetic-reflection-${tag}`;
    // Staff assignments name a sign-in account, which the provider writes as user_ followed by letters.
    const staff = `user_synthetic_reflection_${tag.replaceAll("-", "")}`;
    t.mock.module("@clerk/express", {
      namedExports: {
        clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
        getAuth: (req: Request) => {
          const asked = req.header(identityHeader);
          const id = asked === customer || asked === staff ? asked : null;
          // The member of staff has just passed both sign-in factors, so staff routes read their input.
          const fresh = id === staff;
          return {
            userId: id,
            sessionId: id ? `sess_${id}` : null,
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
    const { db, pool, valoStaffAssignments, valoSafetySwitches } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { resolveWorkspace } = await import("../modules/workspaces");
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`;
    const previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;
    const switches = () => db.select().from(valoSafetySwitches).orderBy(valoSafetySwitches.key);
    // A read made signed out counts against the limit of the address it comes from, 60 a minute, and
    // every test in the database job reads from this machine. So this test's reads made signed out come
    // as a visitor of its own, as the web server's page renders do (middlewares/valo-quota.ts): it
    // neither waits on the reads of the tests before it nor uses up those of the tests after it.
    const visitor = { "X-Forwarded-For": "192.0.2.80" };

    type Answer = { status: number; type: string; text: string; headers: Headers };
    const send = async (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) => {
      const reply = await fetch(`${base}/api${path}`, init);
      return {
        status: reply.status,
        type: reply.headers.get("content-type") ?? "",
        text: await reply.text(),
        headers: reply.headers,
      } satisfies Answer;
    };
    /** fetch refuses TRACE, so it is sent as a plain request, with a header the answer must not repeat. */
    const traceProbe = `synthetic-trace-${tag}`;
    const sendTrace = (path: string) =>
      new Promise<Answer>((done, failed) => {
        const sent = httpRequest(
          `${base}/api${path}`,
          { method: "TRACE", headers: { "x-valo-trace-probe": traceProbe, ...visitor } },
          (reply) => {
            let text = "";
            reply.setEncoding("utf8");
            reply.on("data", (chunk: string) => (text += chunk));
            reply.on("end", () => {
              const headers = new Headers();
              for (const [name, value] of Object.entries(reply.headers))
                if (typeof value === "string") headers.set(name, value);
              done({
                status: reply.statusCode ?? 0,
                type: reply.headers["content-type"] ?? "",
                text,
                headers,
              });
            });
          },
        );
        sent.on("error", failed);
        sent.end();
      });
    /** What is wrong with an answer, if anything. */
    const faults = (where: string, answer: Answer, { privateAnswer = false } = {}) => {
      const found: string[] = [];
      if (answer.headers.get("x-content-type-options") !== "nosniff") found.push(`${where}: no nosniff`);
      if (answer.headers.get("x-frame-options") !== "DENY") found.push(`${where}: may be framed`);
      // Nothing the API answers is a page (OWASP ASVS 5.0.0 V3.4.3).
      if (answer.headers.get("content-security-policy") !== "default-src 'none'; frame-ancestors 'none'")
        found.push(`${where}: no policy that loads and runs nothing`);
      if (answer.headers.get("referrer-policy") !== "same-origin")
        found.push(`${where}: may send its address to another site`);
      // HSTS for at least a year (OWASP ASVS 5.0.0 V3.4.1).
      const hsts = Number(
        /max-age=(\d+)/.exec(answer.headers.get("strict-transport-security") ?? "")?.[1] ?? 0,
      );
      if (hsts < 31_536_000) found.push(`${where}: no HSTS for a year`);
      if (answer.text && !answer.type.startsWith("application/json"))
        found.push(`${where}: answered ${answer.type || "no type"}, not JSON`);
      // A text answer names its character encoding (ASVS V4.1.1).
      else if (answer.text && !/;\s*charset=utf-8/i.test(answer.type))
        found.push(`${where}: answered ${answer.type} with no charset`);
      if (answer.text.includes(MARK) && !answer.type.startsWith("application/json"))
        found.push(`${where}: repeats the markup outside JSON`);
      if (answer.status >= 500)
        found.push(`${where}: failed with ${answer.status} ${answer.text.slice(0, 120)}`);
      if (privateAnswer && !answer.headers.get("cache-control")?.includes("no-store"))
        found.push(`${where}: a private answer that shared caches may keep`);
      return found;
    };

    try {
      await resolveWorkspace(customer);
      // Every role but the reviewer's, which no one holds with the content role.
      await db.insert(valoStaffAssignments).values(
        (["content", "support", "finance", "system", "privacy"] as const).map((role) => ({
          id: randomUUID(),
          identityId: staff,
          role,
          grantedBy: "synthetic-reflection",
          reason: "Synthetic member of staff for the reflected markup test",
        })),
      );
      const switchesBefore = await switches();

      await t.test(
        "every operation answers hostile text in JSON, with the headers, fails no route and changes no object's prototype",
        async () => {
          const hostile = encodeURIComponent(SHORT_MARKUP);
          // Each value twice, as a caller polluting the parameters would (OWASP ASVS 5.0.0 V15.3.7), and
          // keys that would reach every object's prototype if a parser or a merge followed them (V15.3.6).
          const query =
            `?q=${hostile}&q=${hostile}&page=${hostile}&page=${hostile}&${hostile}=${hostile}` +
            "&__proto__[vhPolluted]=query&constructor[prototype][vhPolluted]=query&__proto__.vhPolluted=query";
          const polluting =
            '"__proto__":{"vhPolluted":"body"},"constructor":{"prototype":{"vhPolluted":"body"}}';
          const operations = contractOperations();
          assert.ok(operations.length >= 160, `only ${operations.length} operations in the contract`);
          const found: string[] = [];
          for (const operation of operations) {
            const path = operation.path.replace(/\{[^}]+\}/g, hostile) + query;
            const prefix = operation.path.split("/")[1];
            const account =
              prefix === "admin"
                ? staff
                : prefix === "workspace" || prefix === "v1" || prefix === "account" || prefix === "session"
                  ? customer
                  : null;
            const change = operation.method !== "GET";
            const answer = await send(path, {
              method: operation.method,
              headers: {
                Origin: base,
                "Sec-Fetch-Site": "same-origin",
                ...(account ? { [identityHeader]: account } : change ? {} : visitor),
                ...(change ? { "Content-Type": OWN_MEDIA_TYPES[operation.key] ?? "application/json" } : {}),
              },
              ...(change
                ? {
                    body: `{${polluting},${JSON.stringify({
                      [SHORT_MARKUP]: LONG_MARKUP,
                      title: SHORT_MARKUP,
                      message: LONG_MARKUP,
                    }).slice(1)}`,
                  }
                : {}),
            });
            found.push(
              ...faults(operation.key, answer, {
                privateAnswer: account !== null && prefix !== "session",
              }),
            );
          }
          assert.deepEqual(found, []);
          // The API runs in this process, so a polluted prototype would show here.
          assert.ok(
            !Object.hasOwn(Object.prototype, "vhPolluted"),
            "a request changed every object's prototype",
          );
        },
      );

      await t.test("no read changes anything but the counts it keeps", async () => {
        // ASVS V3.5.3: what changes something is a POST, PUT, PATCH or DELETE. Each read counts against
        // its reader's limit, a refusal is counted for the security alerts, and a member of staff's read
        // of a customer's data is recorded: those three tables are left out, and nothing else may change.
        const leaveOut = ["valo_rate_buckets", "valo_security_signals", "valo_staff_access_audit"];
        const before = await tableDigests(pool, leaveOut);
        for (const operation of contractOperations().filter((each) => each.method === "GET")) {
          const prefix = operation.path.split("/")[1];
          const account =
            prefix === "admin" ? staff : prefix === "public" || prefix === "checker" ? null : customer;
          await send(
            operation.path.replace(/\{[^}]+\}/g, () => randomUUID()),
            {
              headers: account ? { [identityHeader]: account } : visitor,
            },
          );
        }
        const changed = changedTables(before, await tableDigests(pool, leaveOut));
        assert.deepEqual(changed, [], "a read changed what it should only read");
        assert.notEqual(before.get("valo_workspaces") ?? NO_ROWS, NO_ROWS, "the comparison read no rows");
      });

      await t.test("answers that no route gives carry the headers, in JSON", async () => {
        const json = { "Content-Type": "application/json", Origin: base, [identityHeader]: customer };
        const answers: [string, Answer][] = [
          [
            "an address the API does not have",
            await send(`/${encodeURIComponent(SHORT_MARKUP)}`, { headers: visitor }),
          ],
          ["the API's own folder", await send("/", { headers: visitor })],
          ["a folder", await send("/static/", { headers: visitor })],
          ["a repository's folder", await send("/.git/", { headers: visitor })],
          ["TRACE", await sendTrace("/healthz")],
          [
            "a malformed body",
            await send("/workspace/documents", { method: "POST", headers: json, body: `{"${MARK}":` }),
          ],
          [
            "an oversized body",
            await send("/workspace/documents", {
              method: "POST",
              headers: json,
              body: JSON.stringify({ text: SHORT_MARKUP.repeat(1000) }),
            }),
          ],
          [
            "a change from another site",
            await send("/workspace/documents", {
              method: "POST",
              headers: { ...json, Origin: "https://hostile.synthetic.invalid" },
              body: "{}",
            }),
          ],
        ];
        const found: string[] = [];
        for (const [where, answer] of answers) {
          assert.ok(answer.status >= 400 && answer.status < 500, `${where}: ${answer.status}`);
          found.push(...faults(where, answer));
          assert.ok(!answer.text.includes(MARK), `${where}: the answer repeats what was sent`);
        }
        assert.deepEqual(found, []);
        // An address the API does not have, a folder and TRACE are each a JSON 404, never a listing,
        // and TRACE repeats nothing the request carried.
        for (const [where, answer] of answers.slice(0, 5)) {
          assert.equal(answer.status, 404, where);
          assert.equal((JSON.parse(answer.text) as { code: string }).code, "NOT_FOUND", where);
        }
        assert.ok(!answers[4]![1].text.includes(traceProbe), "TRACE repeats what it was sent");
      });

      await t.test(
        "SQL text and search wildcards are kept as text, and a character the database cannot hold is refused",
        async () => {
          const as = (account: string) => ({
            "Content-Type": "application/json",
            Origin: base,
            "Sec-Fetch-Site": "same-origin",
            [identityHeader]: account,
          });
          const task = (title: string) =>
            JSON.stringify({
              title,
              notes: title,
              dueDate: null,
              dateConfirmed: false,
              assessmentId: null,
              ruleId: null,
            });
          // SQL text saved through the API comes back byte for byte.
          const sql = `Robert'); DROP TABLE valo_tasks;-- 100% _done_ \\ "quoted" $1 $$ :name`;
          const made = await send("/workspace/tasks", {
            method: "POST",
            headers: as(customer),
            body: task(sql),
          });
          assert.ok(made.status >= 200 && made.status < 300, `${made.status} ${made.text.slice(0, 160)}`);
          const tasks = JSON.parse(
            (await send("/workspace/tasks", { headers: { [identityHeader]: customer } })).text,
          ) as {
            title: string;
            notes: string;
          }[];
          assert.ok(
            tasks.some((each) => each.title === sql && each.notes === sql),
            "the text came back changed",
          );
          // PostgreSQL cannot hold a NUL character in text: the API refuses one as a detail it does not
          // take, wherever it comes, before any route reads it.
          for (const [where, answer] of [
            [
              "a body's text",
              await send("/workspace/tasks", {
                method: "POST",
                headers: as(customer),
                body: task("Synthetic \u0000 task"),
              }),
            ],
            [
              "a body's key",
              await send("/workspace/tasks", {
                method: "POST",
                headers: as(customer),
                body: JSON.stringify({ "synthetic\u0000key": "Synthetic task" }),
              }),
            ],
            ["a search", await send("/admin/manual-library?q=%00", { headers: { [identityHeader]: staff } })],
            ["a public search", await send("/public/catalogue?q=Synthetic%00", { headers: visitor })],
            [
              "an address",
              await send("/workspace/documents/%00", { headers: { [identityHeader]: customer } }),
            ],
          ] as const) {
            assert.equal(
              answer.status,
              422,
              `a NUL character in ${where}: ${answer.status} ${answer.text.slice(0, 160)}`,
            );
            assert.equal((JSON.parse(answer.text) as { code: string }).code, "VALIDATION_FAILED", where);
          }

          const wildcards = ["%", "_", "\\", "' OR '1'='1", "%' OR 1=1 --"];
          // The catalogue's search reads words, letters and digits only, so SQL text finds only what holds
          // its words. Punctuation alone is no search, and lists everything, as an empty one does.
          const catalogue = async (q: string) =>
            JSON.parse(
              (await send(`/public/catalogue?q=${encodeURIComponent(q)}`, { headers: visitor })).text,
            ) as {
              total: number;
            };
          const everything = (await catalogue("")).total;
          assert.ok(everything > 0, "the catalogue lists nothing to search");
          for (const q of ["' OR '1'='1", "%' OR 1=1 --", "x' UNION SELECT title FROM valo_documents --"])
            assert.ok(
              (await catalogue(q)).total < everything,
              `the catalogue's search for ${q} found everything`,
            );
          // So does the staff library's, which the database runs, once it holds the drafts kept in the repository.
          const loaded = await send("/admin/manual-library/retained", {
            method: "POST",
            headers: as(staff),
            body: JSON.stringify({ load: "missing" }),
          });
          assert.equal(loaded.status, 200, loaded.text.slice(0, 160));
          const library = async (q: string) =>
            (
              JSON.parse(
                (
                  await send(`/admin/manual-library?q=${encodeURIComponent(q)}`, {
                    headers: { [identityHeader]: staff },
                  })
                ).text,
              ) as { items: { title: string }[] }
            ).items;
          assert.ok((await library("")).length > 0, "the library holds nothing to search");
          for (const q of wildcards) {
            const found = await library(q);
            assert.ok(
              found.every((entry) => entry.title.toLowerCase().includes(q.toLowerCase())),
              `the library's search for ${q} found ${found.map((entry) => entry.title).join(", ")}`,
            );
          }
        },
      );

      // Hostile bodies change nothing that every customer shares.
      assert.deepEqual(await switches(), switchesBefore, "a safety switch changed");
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
