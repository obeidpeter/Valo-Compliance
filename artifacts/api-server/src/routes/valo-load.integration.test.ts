import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import type { NextFunction, Request, Response } from "express";

/**
 * NFR-003: "p95 ≤1s for ordinary authenticated requests and catalogue search at 20 requests/s for
 * 30 minutes; <1% unexpected 5xx", accepted with a "reproducible test excluding AI/render duration
 * but including application authorisation and database work".
 *
 * The real app runs against PostgreSQL: every middleware, the request quota, the identity, session
 * and workspace checks, the workspace scope and the queries. Only the identity provider is
 * controlled in this process. Requests leave on a fixed schedule, not one after another, so a slow
 * reply never lowers the rate. No request calls an AI model or renders a file. CI runs the test for
 * VALO_LOAD_SECONDS (60 by default); the requirement's 30-minute run is VALO_LOAD_SECONDS=1800.
 * Synthetic records only.
 */
const RATE = 20;
const SECONDS = Number(process.env.VALO_LOAD_SECONDS ?? "60");
const P95_LIMIT_MS = 1000;
const UNEXPECTED_5XX_LIMIT = 0.01;
const USERS = 20;
const DOCUMENTS_PER_USER = 3;

type Kind = "ordinary" | "search";
type Planned = {
  kind: Kind;
  label: string;
  method: "GET" | "PATCH";
  path: string;
  identity?: string;
  forwardedFor?: string;
  body?: () => unknown;
  saved?: (reply: unknown) => void;
};
type Sample = { kind: Kind; label: string; status: number; ms: number };

/** Nearest-rank percentile. */
const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
};

test(
  "ordinary requests and catalogue search keep p95 under one second at 20 requests per second",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: (SECONDS + 240) * 1000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    assert.ok(Number.isInteger(SECONDS) && SECONDS >= 10 && SECONDS <= 3600, "VALO_LOAD_SECONDS is 10-3600");
    const tag = randomUUID();
    const identityHeader = "x-synthetic-identity";
    t.mock.module("@clerk/express", {
      namedExports: {
        clerkMiddleware: () => (_req: Request, _res: Response, next: NextFunction) => next(),
        getAuth: (req: Request) => {
          const id = req.header(identityHeader);
          const synthetic = id?.startsWith(`synthetic-load-${tag}-`) ? id : null;
          return {
            userId: synthetic,
            sessionId: synthetic ? `sess_${synthetic}` : null,
            sessionClaims: null,
            has: () => false,
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
              twoFactorEnabled: false,
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
    // Anonymous visitors arrive through a proxy from distinct documentation addresses (RFC 5737), as
    // they would in production, so the per-address read quota applies to each of them.
    const previousProxies = process.env.VALO_TRUSTED_PROXY_CIDRS;
    process.env.VALO_TRUSTED_PROXY_CIDRS = "127.0.0.1/32";
    const { default: app } = await import("../app");
    const { resolveWorkspace, saveProfile } = await import("../modules/workspaces");
    const { syntheticDocument, syntheticProfile } = await import("../lib/valo-test-fixtures");
    const { pool } = await import("@workspace/db");

    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`,
      previousOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;

    try {
      // Each synthetic business has a profile and three saved documents.
      const users = await Promise.all(
        Array.from({ length: USERS }, async (_, index) => {
          const identity = `synthetic-load-${tag}-${index}`;
          await saveProfile(await resolveWorkspace(identity), {
            expectedRevision: 0,
            profile: syntheticProfile,
          });
          const documents: { id: string; revision: number }[] = [];
          for (let d = 0; d < DOCUMENTS_PER_USER; d++) {
            const response = await fetch(`${base}/api/workspace/documents`, {
              method: "POST",
              headers: { Origin: base, [identityHeader]: identity, "Content-Type": "application/json" },
              body: JSON.stringify({ ...syntheticDocument, title: `Synthetic load draft ${d}` }),
            });
            assert.equal(response.status, 201, await response.clone().text());
            const created = (await response.json()) as { id: string; revision: number };
            documents.push({ id: created.id, revision: created.revision });
          }
          return { identity, documents };
        }),
      );

      // Each block of ten requests comes from one business: six read its own records, one saves a
      // draft, two search the catalogue signed in, and one is an anonymous search. Each business has
      // a block every ten seconds, so it stays well inside its read and write limits.
      const terms = [
        "invoice",
        "employment",
        "tax",
        "privacy",
        "receipt",
        "contract",
        "registration",
        "lagos",
      ];
      const read = (n: number, id: string): readonly [label: string, path: string] =>
        (
          [
            ["workspace summary", "/workspace"],
            ["document list", "/workspace/documents"],
            ["document", `/workspace/documents/${id}`],
            ["document revisions", `/workspace/documents/${id}/revisions`],
            ["task page", "/workspace/tasks/page?page=1"],
          ] as const
        )[n % 5]!;
      const plan = (i: number): Planned => {
        const user = users[Math.floor(i / 10) % USERS]!;
        const slot = i % 10;
        if (slot === 9) {
          const term = terms[i % terms.length]!;
          return {
            kind: "search",
            label: "catalogue search, anonymous",
            method: "GET",
            path: `/public/catalogue?q=${term}&page=1`,
            forwardedFor: `203.0.113.${(Math.floor(i / 10) % 50) + 1}`,
          };
        }
        if (slot >= 7) {
          const term = terms[(i >> 1) % terms.length]!;
          return {
            kind: "search",
            label: "catalogue search, signed in",
            method: "GET",
            path: `/public/catalogue?q=${term}&page=1`,
            identity: user.identity,
          };
        }
        const doc = user.documents[Math.floor(i / (10 * USERS)) % DOCUMENTS_PER_USER]!;
        if (slot === 6)
          // A business saves one of its drafts in each block, so each draft is saved every 30
          // seconds and saves to one draft never overlap.
          return {
            kind: "ordinary",
            label: "document save",
            method: "PATCH",
            path: `/workspace/documents/${doc.id}`,
            identity: user.identity,
            body: () => ({
              expectedRevision: doc.revision,
              title: `Synthetic load draft ${i}`,
              content: syntheticDocument.content,
            }),
            saved: (reply) => {
              doc.revision = (reply as { revision: number }).revision;
            },
          };
        const [label, path] = read(i, doc.id);
        return { kind: "ordinary", label, method: "GET", path, identity: user.identity };
      };

      const samples: Sample[] = [];
      const send = async (request: Planned) => {
        const startedAt = performance.now();
        let status = 0;
        try {
          const response = await fetch(`${base}/api${request.path}`, {
            method: request.method,
            headers: {
              Origin: base,
              ...(request.identity ? { [identityHeader]: request.identity } : {}),
              ...(request.forwardedFor ? { "X-Forwarded-For": request.forwardedFor } : {}),
              ...(request.body ? { "Content-Type": "application/json" } : {}),
            },
            ...(request.body ? { body: JSON.stringify(request.body()) } : {}),
          });
          const text = await response.text();
          status = response.status;
          if (status === 200 && request.saved) request.saved(JSON.parse(text));
        } catch {
          status = 0; // The connection failed: counted as unexpected below.
        }
        samples.push({ kind: request.kind, label: request.label, status, ms: performance.now() - startedAt });
      };

      const total = RATE * SECONDS;
      const pending: Promise<void>[] = [];
      const startedAt = performance.now();
      let latestStart = 0;
      for (let i = 0; i < total; i++) {
        const wait = startedAt + (i * 1000) / RATE - performance.now();
        if (wait > 0) await sleep(wait);
        latestStart = Math.max(latestStart, performance.now() - startedAt - (i * 1000) / RATE);
        pending.push(send(plan(i)));
      }
      const sentIn = performance.now() - startedAt;
      await Promise.all(pending);

      // The schedule held: every request left within half a second of its time.
      assert.ok(latestStart < 500, `requests left up to ${Math.round(latestStart)} ms late`);
      assert.equal(samples.length, total);
      const rows = (["ordinary", "search"] as const).map((kind) => {
        const of = samples.filter((s) => s.kind === kind);
        const ms = of.map((s) => s.ms);
        return {
          kind,
          count: of.length,
          p50: percentile(ms, 50),
          p95: percentile(ms, 95),
          p99: percentile(ms, 99),
          max: Math.max(...ms),
          serverErrors: of.filter((s) => s.status >= 500 || s.status === 0).length,
        };
      });
      const unexpected = samples.filter((s) => s.status !== 200 && s.status < 500 && s.status !== 0);
      const summary = [
        `### NFR-003 load test: ${RATE} requests/s for ${SECONDS} s (${total} requests, sent in ${(sentIn / 1000).toFixed(1)} s)`,
        "",
        "| Requests | Count | p50 ms | p95 ms | p99 ms | Max ms | 5xx or failed |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        ...rows.map(
          (r) =>
            `| ${r.kind === "ordinary" ? "Ordinary authenticated" : "Catalogue search"} | ${r.count} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.p99.toFixed(0)} | ${r.max.toFixed(0)} | ${r.serverErrors} |`,
        ),
        "",
        "Measured in CI's synthetic database. Limits: p95 at most 1000 ms for each kind, under 1% 5xx.",
        "",
      ].join("\n");
      process.stdout.write(summary + "\n");
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");

      // A 4xx would mean the load did not exercise what it claims (a quota, conflict or bad request).
      assert.deepEqual(
        [...new Set(unexpected.map((s) => `${s.label}: ${s.status}`))],
        [],
        "every request succeeds or fails on the server",
      );
      for (const row of rows) {
        assert.ok(row.count > 0, `${row.kind} requests were sent`);
        assert.ok(
          row.p95 <= P95_LIMIT_MS,
          `${row.kind} p95 ${row.p95.toFixed(0)} ms exceeds ${P95_LIMIT_MS} ms`,
        );
      }
      const serverErrors = rows.reduce((sum, row) => sum + row.serverErrors, 0);
      assert.ok(
        serverErrors / total < UNEXPECTED_5XX_LIMIT,
        `${serverErrors} of ${total} requests failed on the server`,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
      if (previousOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = previousOrigin;
      if (previousProxies === undefined) delete process.env.VALO_TRUSTED_PROXY_CIDRS;
      else process.env.VALO_TRUSTED_PROXY_CIDRS = previousProxies;
    }
  },
);
