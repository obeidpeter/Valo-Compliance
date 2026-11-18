import test from "node:test";
import assert from "node:assert/strict";
import { workspaceActorFromRecord } from "../../platform/workspace-context";
import { ValoProblem } from "../../platform/valo-problem";

/**
 * A template download checks the version's database state under the shared source-state
 * lock, but reads storage (rights evidence and the file itself) outside any transaction,
 * so no lock or pooled connection is held while storage answers. Only storage, the policy
 * files, the lock and the membership check are replaced here; the release logic is real.
 */
test("template downloads read storage outside the transaction that holds the source lock", async (t) => {
  const core = await import("@workspace/valo-core");
  let inTransaction = false,
    permitted = true,
    lockedStatus = "published",
    checkedStatus = "published";
  const events: string[] = [];
  const record = (name: string) => events.push(`${name}:${inTransaction ? "inside" : "outside"}`);
  const bundle = {
    candidate: { hash: "candidate-hash", evidenceMode: "original_operational" },
    policy: { hash: "policy-hash" },
  };
  const version = (status: string) => ({
    id: "version-1",
    templateId: "TPL-01",
    version: 3,
    status,
    policyId: "policy-1",
    candidateHash: "candidate-hash",
    reviewBy: new Date(Date.now() + 86_400_000),
    bundle,
    attestations: { exports: { pdf: { id: "pdf-ref", hash: "pdf-hash" }, docx: { id: "d", hash: "h" } } },
  });
  const tables = {
    valoContentVersions: { id: "content.id", name: "content" },
    valoPublicationPolicies: { id: "policy.id", hash: "policy.hash", name: "policy" },
    valoDocuments: { name: "documents" },
    valoPrices: { name: "prices" },
    valoEntitlements: { name: "entitlements" },
  };
  const rowsFor = (table: unknown) =>
    table === tables.valoContentVersions
      ? [version(inTransaction ? lockedStatus : checkedStatus)]
      : table === tables.valoPublicationPolicies
        ? [{ id: "policy-1", hash: "policy-hash" }]
        : [];
  const select = () => ({
    from: (table: unknown) => ({
      where: () => {
        const rows = Promise.resolve(rowsFor(table));
        return Object.assign(rows, { for: () => rows, limit: () => rows });
      },
    }),
  });
  const tx = { select, execute: async () => ({ rows: [] }) };
  t.mock.module("@workspace/db", {
    namedExports: {
      ...tables,
      db: {
        select,
        transaction: async <T>(run: (t: typeof tx) => Promise<T>) => {
          inTransaction = true;
          try {
            return await run(tx);
          } finally {
            inTransaction = false;
          }
        },
      },
    },
  });
  t.mock.module("@workspace/valo-core", {
    namedExports: {
      ...core,
      // A hand-made bundle stands in for an eligible release; publication is not exercised.
      publicationSchema: {
        safeParse: (b: unknown) => ({ success: true, data: b }),
        parse: (b: unknown) => b,
      },
      evaluatePublication: () => ({ decision: "eligible" }),
    },
  });
  // The publication module, at the boundary the released content reads it through.
  t.mock.module(new URL("../publication/index.ts", import.meta.url).href, {
    namedExports: {
      developmentPublicationOnly: () => undefined,
      operationalPolicy: async () => {
        record("policy files");
        return { policy: { hash: "policy-hash" } };
      },
      currentOperationalPermission: async () => {
        record("rights evidence");
        return permitted;
      },
      getPublicationArtifact: async (ref: { id: string }) => {
        record(`storage ${ref.id}`);
        return Buffer.from("master bytes");
      },
    },
  });
  // The released content reaches the source state through the sources module's index.
  t.mock.module(new URL("../sources/index.ts", import.meta.url).href, {
    namedExports: {
      lockSourceState: async () => record("source lock"),
      sourceTargetAllowed: async () => true,
    },
  });
  t.mock.module(new URL("../../lib/valo-store.ts", import.meta.url).href, {
    namedExports: {
      ValoProblem,
      authorizeWorkspaceWrite: async () => record("membership"),
      createDocumentInTransaction: async () => "document-1",
      getDocument: async () => ({ id: "document-1" }),
    },
  });
  const { readReleasedMaster } = await import("./valo-released-content");
  const actor = workspaceActorFromRecord({ workspaceId: "workspace-1", identityId: "synthetic-reader" });

  await t.test("evidence and file bytes are read outside; the lock and membership inside", async () => {
    events.length = 0;
    const file = await readReleasedMaster("version-1", "pdf", actor);
    assert.equal(file.bytes.toString(), "master bytes");
    assert.deepEqual(events, [
      "policy files:outside",
      "rights evidence:outside",
      "source lock:inside",
      "membership:inside",
      "storage pdf-ref:outside",
    ]);
  });

  await t.test("unresolved evidence refuses before any transaction or file read", async () => {
    events.length = 0;
    permitted = false;
    try {
      await assert.rejects(readReleasedMaster("version-1", "pdf", actor), {
        status: 404,
        message: /evidence is unresolved/,
      });
    } finally {
      permitted = true;
    }
    assert.deepEqual(events, ["policy files:outside", "rights evidence:outside"]);
  });

  await t.test(
    "a version published after its evidence check is refused, not checked under the lock",
    async () => {
      events.length = 0;
      checkedStatus = "candidate";
      try {
        await assert.rejects(readReleasedMaster("version-1", "pdf", actor), {
          status: 404,
          message: /evidence is unresolved/,
        });
      } finally {
        checkedStatus = "published";
      }
      assert.deepEqual(events, ["source lock:inside"]);
    },
  );

  await t.test("a hold committed before the lock refuses the download", async () => {
    events.length = 0;
    lockedStatus = "withdrawn";
    try {
      await assert.rejects(readReleasedMaster("version-1", "pdf", actor), {
        status: 404,
        message: /withdrawn, expired or unavailable/,
      });
    } finally {
      lockedStatus = "published";
    }
    assert.ok(!events.some((e) => e.startsWith("storage")), "no file bytes are read");
  });
});
