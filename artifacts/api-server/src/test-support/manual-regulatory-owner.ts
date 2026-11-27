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
  // The article's record, which the owner signs with its text (docs/architecture/guidance-record.md).
  const record = {
    appliesTo: "Synthetic businesses that keep the synthetic register.",
    actionEvidence: "Keep the synthetic register and the receipts that show it.",
    relatedTemplates: ["TPL-16", "TPL-10"],
  };
  const draft = {
    kind: "regulatory_article",
    title,
    body,
    industry: null,
    fileMode: "text",
    baseVersion: 0,
    requestId: randomUUID(),
    ...record,
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
      retrievedAt: new Date().toISOString(),
      retrieval: "official_url" as const,
      validThrough: new Date(Date.now() + 86_400_000).toISOString(),
      // Who issued the text and the day it took effect, as a check keeps them
      // (docs/architecture/guidance-record.md).
      issuingBody: "Synthetic Commission",
      effectiveFrom: "2023-06-12T00:00:00+01:00",
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
    // The owner's panel shows the version's record with its text, and a version that does not say whom
    // it applies to is not signed, even on a passing check (CMP-001, docs/architecture/guidance-record.md).
    const listed = await list();
    assert.equal(listed.appliesTo, record.appliesTo);
    assert.equal(listed.actionEvidence, record.actionEvidence);
    assert.deepEqual(listed.relatedTemplates, [
      { number: "TPL-16", title: "Employment contract" },
      { number: "TPL-10", title: "Leave request form" },
    ]);
    const scopeless = randomUUID();
    const unscoped = GetManualLibraryRevisionResponse.parse(
      await (
        await call(
          "/admin/manual-library/" + scopeless + "/drafts",
          { ...draft, appliesTo: null, actionEvidence: null, relatedTemplates: [], requestId: randomUUID() },
          editor,
        )
      ).json(),
    );
    assert.equal(unscoped.appliesTo, null);
    const refused = await call(
      path + "/" + scopeless + "/decisions",
      { ...decision(pass), digest: unscoped.digest },
      owner,
    );
    assert.equal(refused.status, 409);
    assert.match(((await refused.json()) as { error: string }).error, /does not say whom it applies to/);
    assert.equal((await decide({ ...decision(pass), confirmed: false })).status, 422);
    assert.equal((await decide(decision(pass), editor)).status, 403);
    assert.equal((await decide(decision(pass))).status, 200);
    assert.equal((await decide(decision(pass))).status, 200);
    const publicArticle = GetReleasedResourceResponse.parse(await (await call(page)).json());
    assert.equal(publicArticle.kind, "guidance");
    assert.equal(publicArticle.body, body);
    // The page shows the source with who issued it and when its text took effect, and the record the
    // owner signed (docs/architecture/guidance-record.md, slice 2). Neither related template is released.
    assert.deepEqual(publicArticle.sources, [
      {
        title: source.title,
        url: source.url,
        locator: source.locator,
        issuingBody: source.issuingBody,
        effectiveFrom: source.effectiveFrom,
      },
    ]);
    assert.equal(publicArticle.appliesTo, record.appliesTo);
    assert.equal(publicArticle.actionEvidence, record.actionEvidence);
    assert.equal(publicArticle.relatedTemplates, undefined);
    // Once a template filed as one of them is released, the page links it, and only it.
    const leaveForm = randomUUID();
    const leaveDraft = await call(
      "/admin/manual-library/" + leaveForm + "/drafts",
      {
        kind: "template",
        title: "Leave request form",
        body: "A synthetic leave request form.",
        industry: null,
        fileMode: "text",
        baseVersion: 0,
        requestId: randomUUID(),
        purpose: "Ask for leave in a synthetic test.",
        limits: "A synthetic form only.",
        aiDrafted: false,
      },
      editor,
    );
    assert.equal(leaveDraft.status, 200);
    const leave = GetManualLibraryRevisionResponse.parse(await leaveDraft.json());
    assert.equal(
      (
        await call(
          "/admin/manual-library/" + leaveForm + "/actions",
          { action: "publish", version: leave.version, digest: leave.digest },
          editor,
        )
      ).status,
      200,
    );
    assert.deepEqual(GetReleasedResourceResponse.parse(await (await call(page)).json()).relatedTemplates, [
      { number: "TPL-10", title: "Leave request form", href: "/library/manual-" + leaveForm },
    ]);
    // The template is withdrawn again, so no other step finds it released.
    assert.equal(
      (
        await call(
          "/admin/manual-library/" + leaveForm + "/actions",
          {
            action: "withdraw",
            version: leave.version,
            digest: leave.digest,
            reason: "Synthetic: the owner's step released this form only to see it linked.",
          },
          editor,
        )
      ).status,
      200,
    );
    assert.equal(
      GetReleasedResourceResponse.parse(await (await call(page)).json()).relatedTemplates,
      undefined,
    );
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
    // A corrected version follows the withdrawn release: the owner signs it only with what changed,
    // and the article's page shows the note (docs/architecture/guidance-currency.md, slice 3).
    const corrected = "An exact synthetic regulatory article, corrected.";
    const next = await call(
      "/admin/manual-library/" + id + "/drafts",
      { ...draft, body: corrected, baseVersion: 1, requestId: randomUUID() },
      editor,
    );
    assert.equal(next.status, 200);
    const nextRevision = GetManualLibraryRevisionResponse.parse(await next.json());
    assert.equal(nextRevision.previousRelease, 1);
    assert.equal((await list()).previousRelease, 1);
    const nextCheck = await check([], corrected);
    const signNext = (change?: string) =>
      decide({
        action: "publish",
        version: nextRevision.version,
        digest: nextRevision.digest,
        checkId: nextCheck,
        confirmed: true,
        ...(change === undefined ? {} : { change }),
      });
    assert.equal((await signNext()).status, 422);
    const said = "Synthetic: the article now gives the corrected filing period.";
    assert.equal((await signNext(said)).status, 200);
    const correctedArticle = GetReleasedResourceResponse.parse(await (await call(page)).json());
    assert.equal(correctedArticle.body, corrected);
    assert.equal(correctedArticle.change?.note, said);
    // A Content editor holds the published guide short of a withdrawal (docs/architecture/library-holds.md,
    // slice 2): its page goes, and only the owner lifts the hold, from the owner's panel.
    const holdWhy = "Synthetic: held while a reader's report on the filing period is checked.",
      liftWhy = "Synthetic: the filing period was checked against the Act and is right.";
    const exact = { version: nextRevision.version, digest: nextRevision.digest };
    const held = await call(
      "/admin/manual-library/" + id + "/holds",
      { action: "hold", ...exact, reason: holdWhy },
      editor,
    );
    assert.equal(held.status, 200);
    assert.equal(GetManualLibraryRevisionResponse.parse(await held.json()).hold?.reason, holdWhy);
    assert.equal((await call(page)).status, 404);
    assert.equal((await list()).libraryHold?.reason, holdWhy);
    assert.equal(
      (
        await call(
          "/admin/manual-library/" + id + "/holds",
          { action: "lift", ...exact, reason: liftWhy },
          editor,
        )
      ).status,
      403,
    );
    const lift = (actor = owner, reason = liftWhy) =>
      call(path + "/" + id + "/hold-lifts", { ...exact, reason }, actor);
    assert.equal((await lift(editor)).status, 403);
    assert.equal((await lift(owner, "Too short.")).status, 422);
    assert.equal((await lift()).status, 200);
    assert.equal((await lift()).status, 409);
    assert.equal((await list()).libraryHold, null);
    assert.equal(GetReleasedResourceResponse.parse(await (await call(page)).json()).body, corrected);
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
