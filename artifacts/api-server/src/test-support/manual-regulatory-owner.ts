import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { sha256 } from "@workspace/valo-core";
import {
  GetManualLibraryRevisionResponse,
  GetReleasedResourceResponse,
  ListOwnerGuidanceResponse,
} from "@workspace/api-zod";
import { eq } from "drizzle-orm";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

/** Synthetic inputs for the HTTP release boundary. Provider access is unnecessary for this test. */
export async function exerciseManualRegulatoryOwner(call: Call, editor: string) {
  const {
    db,
    valoManualRegulatoryChecks: checks,
    valoStaffAssignments: roles,
    valoStaffRoleChanges: audit,
  } = await import("@workspace/db");
  const id = randomUUID(),
    owner = "synthetic-source-owner-" + id,
    system = "synthetic-ordinary-system-" + id;
  const assignment = randomUUID(),
    title = "Synthetic source sign-off " + id,
    body = "An exact synthetic regulatory article.";
  const draft = {
    kind: "regulatory_article",
    title,
    body,
    industry: null,
    fileMode: "text",
    baseVersion: 0,
    requestId: randomUUID(),
  };
  const path = "/admin/owner-guidance",
    page = "/public/resources/manual-" + id;
  await db.insert(roles).values(
    [
      { id: assignment, identityId: owner },
      { id: randomUUID(), identityId: system },
    ].map((row) => ({
      ...row,
      role: "system" as const,
      grantedBy: "synthetic operator",
      reason: "Synthetic owner workflow test",
    })),
  );
  await db.insert(audit).values({
    id: randomUUID(),
    requestKey: randomUUID(),
    inputHash: sha256("synthetic"),
    actorId: "operator-bootstrap:synthetic",
    actorAssignmentId: assignment,
    assignmentId: assignment,
    targetIdentityId: owner,
    action: "grant",
    role: "system",
    reason: "Synthetic owner fixture",
    after: { active: true },
    targetVerifiedAt: new Date(),
  });
  try {
    const res = await call("/admin/manual-library/" + id + "/drafts", draft, editor);
    assert.equal(res.status, 200);
    const { digest } = GetManualLibraryRevisionResponse.parse(await res.json());
    const decision = (checkId: string | null, action = "publish") => ({
      action,
      version: 1,
      digest,
      checkId,
      confirmed: true,
    });
    const decide = (data: unknown, actor = owner, extra = {}) =>
      call(path + "/" + id + "/decisions", data, actor, extra);
    const list = async () =>
      ListOwnerGuidanceResponse.parse(await (await call(path, undefined, owner)).json()).items.find(
        (row) => row.itemId === id,
      )!;
    let offset = -2000;
    const source = {
      title: "Synthetic official instrument",
      url: "https://example.invalid/instrument",
      locator: "Section 1",
      rawSha256: sha256("synthetic file"),
      validThrough: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const check = async (holds: string[], text = body, checkedAt = new Date(Date.now() + offset++)) => {
      const [row] = await db
        .insert(checks)
        .values({
          candidateId: "GUD-01",
          title,
          bodySha256: sha256(text),
          evidenceSha256: sha256(JSON.stringify([text, holds, source])),
          checkedAt,
          sources: [source],
          holds,
        })
        .returning({ id: checks.id });
      return row!.id;
    };
    assert.equal((await call(path, undefined, editor)).status, 403);
    assert.equal((await call(path, undefined, system)).status, 403);
    assert.equal((await decide(decision(null), owner, { "x-test-mfa": "stale" })).status, 403);
    assert.equal(
      (await decide(decision(null), owner, { origin: "https://other.example.invalid" })).status,
      403,
    );
    assert.ok((await list()).holds.length);
    assert.equal(
      (await decide(decision(await check([], body, new Date(Date.now() - 2 * 86_400_000))))).status,
      409,
    );
    assert.equal((await decide(decision(await check([], "Different text")))).status, 409);
    const older = await check([]);
    const blocked = await check(["Synthetic unresolved claim"]);
    assert.equal((await decide(decision(older))).status, 409);
    assert.equal((await decide(decision(blocked))).status, 409);
    assert.equal((await call(page)).status, 404);
    const pass = await check([]);
    assert.equal((await list()).checkId, pass);
    assert.equal((await decide({ ...decision(pass), confirmed: false })).status, 422);
    assert.equal((await decide(decision(pass), editor)).status, 403);
    assert.equal((await decide(decision(pass))).status, 200);
    assert.equal((await decide(decision(pass))).status, 200);
    const publicArticle = GetReleasedResourceResponse.parse(await (await call(page)).json());
    assert.equal(publicArticle.kind, "guidance");
    assert.equal(publicArticle.body, body);
    assert.deepEqual(publicArticle.sources, [
      { title: source.title, url: source.url, locator: source.locator },
    ]);
    assert.ok(!JSON.stringify(publicArticle).includes(owner));
    const otherId = randomUUID();
    const otherDraft = await call(
      "/admin/manual-library/" + otherId + "/drafts",
      { ...draft, requestId: randomUUID() },
      editor,
    );
    assert.equal(otherDraft.status, 200);
    assert.equal(
      (
        await call(
          path + "/" + otherId + "/decisions",
          {
            ...decision(pass),
            digest: GetManualLibraryRevisionResponse.parse(await otherDraft.json()).digest,
          },
          owner,
        )
      ).status,
      409,
    );
    await check(["Synthetic changed source"]);
    assert.equal((await call(page)).status, 404);
    assert.equal((await decide(decision(null, "withdraw"))).status, 200);
    await assert.rejects(
      db.update(checks).set({ holds: [] }).where(eq(checks.id, blocked)),
      /Record a new regulatory source check|Failed query/,
    );
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
