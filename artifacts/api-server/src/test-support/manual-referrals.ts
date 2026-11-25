import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import {
  ActOnContentEscalationResponse,
  FindSupportLibraryEntriesResponse,
  GetManualLibraryRevisionResponse,
  GetStaffSupportCaseResponse,
  ListContentEscalationsResponse,
  ListPublicCatalogueResponse,
} from "@workspace/api-zod";
import { libraryAction, templateDetails } from "./template-details";

type Call = (path: string, body?: unknown, actor?: string) => Promise<Response>;

/**
 * Holding, withdrawing and reporting staff-library entries, slice 3 (ADM-008): support staff refer a
 * workspace's reported problem to a published library entry, found by its title. In the Content triage
 * queue, "Hold and reassess" holds that exact version in the staff library at once, with a reason that
 * names the request and copies none of its text, or points the referral at the hold already on it. A
 * version no longer published is not held, and resolving a referral keeps its hold.
 */
export async function exerciseLibraryReferrals(call: Call, editor: string, support: string) {
  const { db, valoManualHolds } = await import("@workspace/db");
  const { createTicket, customerSupportCases } = await import("../modules/support");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const run = randomUUID().slice(0, 8);
  const path = (itemId: string) => "/admin/manual-library/" + itemId;
  const json = async (response: Response) => {
    const body: unknown = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    return body;
  };
  const revision = async (response: Response) => GetManualLibraryRevisionResponse.parse(await json(response));
  const draft = (itemId: string, title: string, baseVersion = 0) =>
    call(
      path(itemId) + "/drafts",
      {
        kind: "template",
        title,
        industry: null,
        body: "Synthetic text of " + title + ".",
        requestId: randomUUID(),
        baseVersion,
        fileMode: "text",
        ...templateDetails,
      },
      editor,
    );
  const title = `A synthetic referred template ${run}`;
  const itemId = randomUUID();
  const released = await revision(
    await call(
      path(itemId) + "/actions",
      libraryAction("publish", await revision(await draft(itemId, title))),
      editor,
    ),
  );
  assert.equal(released.state, "published");
  // A draft with a like title is not offered to support staff.
  const unreleased = await revision(await draft(randomUUID(), title + " draft"));

  // Support staff find the published entry by words of its title; nobody else may search.
  const search = (q: string, actor = support) =>
    call("/admin/support-library-entries?q=" + encodeURIComponent(q), undefined, actor);
  assert.equal((await search("referred template " + run, editor)).status, 403);
  assert.equal((await search("x")).status, 422);
  assert.deepEqual(
    FindSupportLibraryEntriesResponse.parse(await json(await search("REFERRED template " + run))).entries,
    [{ editionId: released.id, title, kind: "template", version: 1 }],
  );
  // Its words are matched as written: a wildcard matches only itself.
  assert.deepEqual(FindSupportLibraryEntriesResponse.parse(await json(await search("%_" + run))).entries, []);

  // A workspace reports a problem, and support staff refer it to the entry's published version.
  const reporter = await resolveWorkspace("synthetic-library-referral-" + run);
  const supportText = "Synthetic report: the payment clause in this template reads wrongly.";
  const { reference } = await createTicket(reporter, {
    category: "support",
    scope: supportText,
    contactEmail: `synthetic-library-referral-${run}@example.invalid`,
    sharingConsent: true,
  });
  const caseId = (await customerSupportCases(reporter)).cases.find((c) => c.reference === reference)!.id;
  let caseVersion = 1;
  const refer = async (targetId: string, status = 200) => {
    const response = await call(
      "/admin/support-cases/" + caseId + "/action",
      {
        idempotencyKey: randomUUID(),
        expectedVersion: caseVersion,
        action: "escalate_content",
        body: "Synthetic referral: the customer says the payment clause reads wrongly.",
        targetKind: "library",
        targetId,
      },
      support,
    );
    if (status !== 200) {
      assert.equal(response.status, status, await response.text());
      return null;
    }
    const detail = GetStaffSupportCaseResponse.parse(await json(response));
    caseVersion = detail.case.version;
    return detail.escalations[0]!;
  };
  // Only a published version, and only one that exists, is referred.
  await refer(unreleased.id, 409);
  await refer(randomUUID(), 404);
  const first = (await refer(released.id))!;
  assert.deepEqual(
    {
      targetKind: first.targetKind,
      targetId: first.targetId,
      targetHash: first.targetHash,
      targetVersion: first.targetVersion,
      status: first.status,
      libraryHoldId: first.libraryHoldId,
      sourceImpactId: first.sourceImpactId,
    },
    {
      targetKind: "library",
      targetId: released.id,
      targetHash: released.digest,
      targetVersion: 1,
      status: "queued",
      libraryHoldId: null,
      sourceImpactId: null,
    },
  );

  // The Content triage queue lists it with the entry's title.
  const queued = async (id: string) =>
    ListContentEscalationsResponse.parse(
      await json(await call("/admin/support-escalations", undefined, editor)),
    ).escalations.find((e) => e.id === id)!;
  const listed = await queued(first.id);
  assert.equal(listed.targetTitle, title);
  assert.equal(listed.reference, reference);

  // "Hold and reassess" holds the exact version in the staff library, at once.
  const triage = (id: string, action: string, sent = { key: randomUUID(), version: caseVersion }) =>
    call(
      "/admin/support-escalations/" + id + "/action",
      {
        idempotencyKey: sent.key,
        expectedVersion: sent.version,
        action,
        body: "Synthetic triage: the payment clause needs checking before more customers use it.",
      },
      editor,
    );
  const sent = { key: randomUUID(), version: caseVersion };
  const held = ActOnContentEscalationResponse.parse(
    await json(await triage(first.id, "hold_and_reassess", sent)),
  );
  caseVersion = held.caseVersion;
  assert.equal(held.escalation.status, "acknowledged");
  assert.equal(held.escalation.sourceImpactId, null);
  assert.ok(held.escalation.libraryHoldId);
  assert.match(held.notice, /^Exact version held in the staff library\./);
  const holds = () =>
    db
      .select({ id: valoManualHolds.id, reason: valoManualHolds.reason, placedBy: valoManualHolds.placedBy })
      .from(valoManualHolds)
      .where(eq(valoManualHolds.edition, released.id));
  const expectedReason = `Held after a reported problem (support request ${reference}). Reassess this exact version.`;
  assert.deepEqual(await holds(), [
    { id: held.escalation.libraryHoldId, reason: expectedReason, placedBy: editor },
  ]);
  // The staff view says why, with none of the request's own words; the entry leaves the public list.
  const staffView = await revision(await call(path(itemId), undefined, editor));
  assert.equal(staffView.hold?.reason, expectedReason);
  assert.ok(!staffView.hold?.reason.includes("payment clause"));
  const publicList = async () =>
    ListPublicCatalogueResponse.parse(
      await json(await call("/public/catalogue?type=template&q=" + encodeURIComponent(title))),
    ).items.some((entry) => entry.slug === "manual-" + itemId);
  assert.equal(await publicList(), false);
  assert.equal((await call("/public/templates/manual-" + itemId)).status, 404);
  // The same request again repeats nothing; another is refused, since the version is held already.
  const again = ActOnContentEscalationResponse.parse(
    await json(await triage(first.id, "hold_and_reassess", sent)),
  );
  assert.match(again.notice, /no action repeated/);
  assert.equal((await triage(first.id, "hold_and_reassess")).status, 409);
  assert.equal((await holds()).length, 1);

  // A second referral of the same version points at the hold already placed.
  const second = (await refer(released.id))!;
  const linked = ActOnContentEscalationResponse.parse(
    await json(await triage(second.id, "hold_and_reassess")),
  );
  caseVersion = linked.caseVersion;
  assert.equal(linked.escalation.libraryHoldId, held.escalation.libraryHoldId);
  assert.match(linked.notice, /^This version was already held in the staff library/);
  assert.equal((await holds()).length, 1);

  // Resolving a referral keeps its hold: a Content editor lifts it, or releases a corrected version.
  const resolved = ActOnContentEscalationResponse.parse(await json(await triage(first.id, "resolve")));
  caseVersion = resolved.caseVersion;
  assert.equal(resolved.escalation.status, "resolved");
  assert.equal(resolved.escalation.libraryHoldId, held.escalation.libraryHoldId);
  assert.equal((await revision(await call(path(itemId), undefined, editor))).hold?.reason, expectedReason);

  // A referral of a version that a corrected one has since replaced is not held.
  const third = (await refer(released.id))!;
  const corrected = await revision(await draft(itemId, title, 1));
  await revision(await call(path(itemId) + "/actions", libraryAction("publish", corrected), editor));
  const late = await triage(third.id, "hold_and_reassess");
  assert.equal(late.status, 409);
  assert.match(((await late.json()) as { error: string }).error, /no longer published/);
  assert.equal(
    (
      await db
        .select({ id: valoManualHolds.id })
        .from(valoManualHolds)
        .where(eq(valoManualHolds.edition, corrected.id))
    ).length,
    0,
    "the corrected version is not held",
  );
}
