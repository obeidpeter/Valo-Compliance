import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express, { type Request, type Response, type NextFunction } from "express";
import { checkerFactsSchema, digest } from "@workspace/valo-core";

/** Real HTTP middleware/router/domain/SQL. Identity-provider transport alone is
 * controlled in this process; this is not a managed Clerk browser proof.
 * No registry mock, release record or publication evidence is created. */
test(
  "rich checker HTTP preview, consented save, history and isolation",
  {
    skip: process.env.VALO_RUN_DB_TESTS !== "synthetic-development-only",
    timeout: 60000,
  },
  async (t) => {
    assert.equal(process.env.NODE_ENV, "development");
    assert.ok(!process.env.REPLIT_DEPLOYMENT);
    assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(process.env.DATABASE_URL!).hostname));
    const identities = [`synthetic-pr12-a-${randomUUID()}`, `synthetic-pr12-b-${randomUUID()}`];
    let verified = true,
      sessionActive = true,
      suspended = false;
    t.mock.module("@clerk/express", {
      namedExports: {
        getAuth: (req: Request) => {
          const id = req.header("x-fixture-identity");
          return {
            userId: id && identities.includes(id) ? id : null,
            sessionId: id ? `fixture:${id}` : null,
          };
        },
        clerkClient: {
          sessions: {
            getSession: async (id: string) => ({
              status: sessionActive ? "active" : "revoked",
              userId: id.slice(8),
            }),
          },
          users: {
            getUser: async (id: string) => ({
              id,
              banned: suspended,
              locked: false,
              primaryEmailAddressId: "primary",
              emailAddresses: [
                {
                  id: "primary",
                  emailAddress: "synthetic@example.invalid",
                  verification: { status: verified ? "verified" : "unverified" },
                },
              ],
            }),
          },
        },
      },
    });
    const { db, pool, valoAssessments, valoRuleReleases, valoMemberships } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    const { resolveWorkspace, saveProfile } = await import("../lib/valo-store");
    const { syntheticProfile } = await import("../lib/valo-test-fixtures");
    const { verifiedWorkspace, sameOriginMutation } = await import("../middlewares/valo-identity");
    const { default: router } = await import("./valo-requirements");
    const actors = await Promise.all(identities.map((id) => resolveWorkspace(id)));
    await saveProfile(actors[0]!, { expectedRevision: 0, profile: syntheticProfile });
    const registryBefore = digest(await db.select().from(valoRuleReleases));
    const app = express();
    app.use(express.json());
    app.use("/workspace", sameOriginMutation, verifiedWorkspace);
    app.use(router);
    app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e = err as { status?: number; name?: string };
      res.status(e.status ?? (e.name === "ZodError" ? 422 : 500)).json({
        error: err instanceof Error ? err.message : "Controlled HTTP error",
      });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}`,
      oldOrigin = process.env.VALO_TRUSTED_ORIGIN;
    process.env.VALO_TRUSTED_ORIGIN = base;
    const request = (
      path: string,
      body?: unknown,
      identity: string | undefined = identities[0],
      origin = base,
    ) =>
      fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          ...(identity ? { "x-fixture-identity": identity } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    const day = new Date().toISOString().slice(0, 10);
    const facts = {
      legalForm: "company",
      registrationStatus: "registered",
      activities: ["retail"],
      state: "Lagos",
      lga: "unknown",
      employees: "unknown",
      turnoverBand: "unknown",
      turnoverYear: "unknown",
      turnoverMetric: "gross_revenue",
      turnoverCurrency: "NGN",
      premises: "unknown",
      manufacturing: "no",
      importing: "no",
      personalData: "unknown",
      factsVersion: "checker-facts-v2",
      rich: {
        businessName: { businessName: "Synthetic PR12 Name", legalForm: "company" },
        privacy: {
          processesPersonalData: false,
          operatesInNigeria: { status: "unknown", value: null },
          processingOccursInNigeria: { status: "unanswered", value: null },
          dataSubjectsInNigeria: { status: "not_applicable", value: null },
        },
        tax: { accountingPeriodStart: "2026-01-01", accountingPeriodEnd: "2026-11-01" },
      },
    };
    const canonicalFacts = checkerFactsSchema.parse(facts);
    let first: { id: string; facts: typeof facts; result: { resultHash: string } };
    try {
      await t.test(
        "anonymous name facts, unverified accounts and hostile origins cannot enter private preview",
        async () => {
          assert.equal((await request("/checker/preview", { facts, asOfDate: day }, "")).status, 401);
          assert.equal(
            (await request("/workspace/checker/preview", { facts, asOfDate: day }, "")).status,
            401,
          );
          verified = false;
          assert.equal((await request("/workspace/checker/preview", { facts, asOfDate: day })).status, 403);
          verified = true;
          const before = digest(await db.select().from(valoAssessments));
          assert.equal(
            (
              await request(
                "/workspace/checker/preview",
                { facts, asOfDate: day },
                identities[0],
                "https://hostile.example.invalid",
              )
            ).status,
            403,
          );
          assert.equal(digest(await db.select().from(valoAssessments)), before);
        },
      );
      await t.test(
        "private preview preserves literal rich facts without persistence or browser eligibility",
        async () => {
          const before = digest(await db.select().from(valoAssessments));
          const response = await request("/workspace/checker/preview", { facts, asOfDate: day });
          assert.equal(response.status, 200);
          assert.match(response.headers.get("cache-control") ?? "", /no-store/);
          const preview = (await response.json()) as { items: unknown[]; gaps: unknown[] };
          assert.equal(preview.items.length, 0);
          assert.ok(preview.gaps.length > 0);
          assert.equal(digest(await db.select().from(valoAssessments)), before);
          assert.equal(
            (
              await request("/workspace/checker/preview", {
                facts: { ...facts, sourceContext: { approved: true } },
                asOfDate: day,
              })
            ).status,
            422,
          );
        },
      );
      await t.test(
        "consent/revision enforcement and saved fact/hash/history round trip use real SQL",
        async () => {
          const input = { facts, asOfDate: day, saveConsent: true, expectedProfileRevision: 1 };
          assert.equal(
            (await request("/workspace/assessments", { ...input, saveConsent: false })).status,
            422,
          );
          assert.equal(
            (await request("/workspace/assessments", { ...input, expectedProfileRevision: 99 })).status,
            409,
          );
          const response = await request("/workspace/assessments", input);
          const body = (await response.json()) as typeof first;
          assert.equal(response.status, 201, JSON.stringify(body));
          first = body;
          assert.deepEqual(first.facts, canonicalFacts);
          assert.deepEqual(
            first.facts.rich,
            facts.rich,
            "Explicit rich answers must not change during default normalization",
          );
          const loaded = (await (await request(`/workspace/assessments/${first.id}`)).json()) as typeof first;
          assert.deepEqual(loaded, first);
          assert.equal(digest(loaded.facts), digest(canonicalFacts));
          assert.equal(loaded.result.resultHash, first.result.resultHash);
          const list = (await (await request("/workspace/assessments")).json()) as { id: string }[];
          assert.ok(list.some((x) => x.id === first.id));
          const changed = structuredClone(facts);
          changed.rich.businessName.businessName = "Synthetic PR12 Revised";
          const secondResponse = await request("/workspace/assessments", { ...input, facts: changed });
          assert.equal(secondResponse.status, 201);
          const second = (await secondResponse.json()) as { id: string };
          const comparison = await request(`/workspace/assessments/${second.id}/compare/${first.id}`);
          assert.equal(comparison.status, 200);
          assert.match(JSON.stringify(await comparison.json()), /rich\.businessName\.businessName/);
        },
      );
      await t.test(
        "cross-workspace reads/comparisons and revoked sessions/membership are denied",
        async () => {
          assert.equal(
            (await request(`/workspace/assessments/${first.id}`, undefined, identities[1])).status,
            404,
          );
          assert.equal(
            (
              await request(
                `/workspace/assessments/${first.id}/compare/${first.id}`,
                undefined,
                identities[1],
              )
            ).status,
            404,
          );
          // Decision 0003: everyday routes may reuse a passing provider check for up to a
          // minute (bound proven in platform/session-verification.test.ts). Sensitive
          // routes check live, and a live refusal also ends cached access at once.
          sessionActive = false;
          assert.equal((await request("/workspace/account")).status, 401);
          assert.equal((await request("/workspace/assessments")).status, 401);
          sessionActive = true;
          suspended = true;
          assert.equal((await request("/workspace/assessments")).status, 403);
          suspended = false;
          await db
            .update(valoMemberships)
            .set({ active: "no" })
            .where(eq(valoMemberships.workspaceId, actors[0]!.workspaceId));
          assert.equal((await request("/workspace/checker/preview", { facts, asOfDate: day })).status, 403);
        },
      );
      assert.equal(digest(await db.select().from(valoRuleReleases)), registryBefore);
    } finally {
      if (oldOrigin === undefined) delete process.env.VALO_TRUSTED_ORIGIN;
      else process.env.VALO_TRUSTED_ORIGIN = oldOrigin;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      await pool.end();
    }
  },
);
