import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  GetManualLibraryRevisionResponse,
  ListOwnerBundlesResponse,
  PreviewOwnerBundleResponse,
  RecordOwnerBundleResponse,
} from "@workspace/api-zod";
import { sha256 } from "@workspace/valo-core";
import { wordFromText } from "../modules/manual-library/files";
import { libraryAction, templateDetails } from "./template-details";

type Call = (
  path: string,
  body?: unknown,
  actor?: string,
  headers?: Record<string, string>,
) => Promise<Response>;

/**
 * The owner's bundles (docs/architecture/commercial-settings.md, slice 4b; ADM-006) over HTTP: only the
 * recently verified development owner, from Valo's own pages, previews and records a bundle's version; a
 * bundle holds only premium templates of the staff library that have been released; recording needs the
 * preview's checksum of exactly those terms; and the next version closes the open one when it starts, once,
 * while the earlier version keeps its terms and the change log keeps both.
 */
export async function exerciseOwnerBundleRoutes(call: Call, editor: string) {
  const {
    db,
    valoBundleChanges,
    valoBundles,
    valoStaffAssignments: roles,
    valoStaffRoleChanges: audit,
  } = await import("@workspace/db");
  const id = randomUUID(),
    owner = "synthetic-bundle-route-owner-" + id,
    system = "synthetic-bundle-route-system-" + id,
    assignment = randomUUID();
  await db.insert(roles).values(
    [
      { id: assignment, identityId: owner },
      { id: randomUUID(), identityId: system },
    ].map((row) => ({
      ...row,
      role: "system" as const,
      grantedBy: "synthetic operator",
      reason: "Synthetic bundle route test",
    })),
  );
  // The development owner is the identity the operator bootstrap granted (decision 0018).
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
    reason: "Synthetic bundle owner fixture",
    after: { active: true },
    targetVerifiedAt: new Date(),
  });
  try {
    // Two premium templates and a free one, released by a Content editor, and a premium draft never released.
    const save = async (kind: "premium_template" | "template", title: string, release: boolean) => {
      const itemId = randomUUID();
      const file =
        kind === "premium_template"
          ? {
              fileMode: "upload",
              upload: {
                format: "docx",
                base64: wordFromText(title, "Only its buyers may read this sentence.").bytes.toString(
                  "base64",
                ),
              },
            }
          : { fileMode: "text" };
      const saved = await call(
        "/admin/manual-library/" + itemId + "/drafts",
        {
          kind,
          title,
          body: "Public description of " + title + ".",
          industry: null,
          requestId: randomUUID(),
          baseVersion: 0,
          ...file,
          ...templateDetails,
        },
        editor,
      );
      assert.equal(saved.status, 200);
      if (release) {
        const edition = GetManualLibraryRevisionResponse.parse(await saved.json());
        const published = await call(
          "/admin/manual-library/" + itemId + "/actions",
          libraryAction("publish", edition),
          editor,
        );
        assert.equal(published.status, 200);
      }
      return itemId;
    };
    const mark = id.slice(0, 8);
    const agreement = await save("premium_template", `Synthetic bundled agreement ${mark}`, true),
      policy = await save("premium_template", `Synthetic bundled policy ${mark}`, true),
      free = await save("template", `Synthetic free form ${mark}`, true),
      unreleased = await save("premium_template", `Synthetic unreleased agreement ${mark}`, false);
    const bundle = "synthetic-bundle-" + mark,
      licenceText = "Synthetic licence for one business's own use only.";
    const path = "/admin/owner-bundles";
    const terms = (change: Record<string, unknown> = {}) => ({
      bundle,
      title: "Synthetic starter bundle",
      items: [policy, agreement],
      amount: "4000.00",
      licenceVersion: "synthetic-bundle-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
      from: "now",
      ...change,
    });
    const record = (body: object, who = owner) => call(path, body, who);
    const listed = async () =>
      ListOwnerBundlesResponse.parse(await (await call(path, undefined, owner)).json());
    const versions = async () => (await listed()).versions.filter((version) => version.bundle === bundle);
    const rows = () => db.select().from(valoBundles).where(eq(valoBundles.bundleKey, bundle));

    // Only the recently verified development owner reads, previews or records a bundle.
    for (const [who, headers] of [
      [editor, {}],
      [system, {}],
      [owner, { "x-test-mfa": "stale" }],
    ] as const) {
      assert.equal((await call(path, undefined, who, headers)).status, 403);
      assert.equal((await call(path + "/previews", terms(), who, headers)).status, 403);
    }
    const page = await call(path, undefined, owner);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("cache-control"), "private, no-store");
    // The templates a bundle may hold are the premium ones released, each on sale while it is.
    const offered = (await listed()).templates.filter((template) => template.title.endsWith(mark));
    assert.deepEqual(offered, [
      { item: agreement, title: `Synthetic bundled agreement ${mark}`, onSale: true },
      { item: policy, title: `Synthetic bundled policy ${mark}`, onSale: true },
    ]);
    assert.deepEqual(await versions(), []);

    // From another site a write is refused, and a malformed term is refused before anything is read.
    const hostile = await call(path + "/previews", terms(), owner, { origin: "https://hostile.invalid" });
    assert.equal(hostile.status, 403);
    for (const change of [{ amount: "4,000" }, { items: [agreement] }, { bundle: "Synthetic Bundle" }])
      assert.equal(
        (await call(path + "/previews", terms(change), owner)).status,
        422,
        JSON.stringify(change),
      );
    // A bundle holds only premium templates of the staff library that have been released.
    for (const other of [free, unreleased, randomUUID()])
      assert.equal((await call(path + "/previews", terms({ items: [agreement, other] }), owner)).status, 409);

    // A preview gives the exact terms, the templates they name and their checksum, and writes nothing.
    const previewed = await call(path + "/previews", terms(), owner);
    assert.equal(previewed.status, 200);
    const preview = PreviewOwnerBundleResponse.parse(await previewed.json());
    assert.deepEqual(preview.terms, {
      bundle,
      title: "Synthetic starter bundle",
      items: [agreement, policy].sort(),
      amountKobo: 400000,
      licenceVersion: "synthetic-bundle-1",
      licenceText,
      taxTreatment: "Synthetic tax treatment",
      from: "now",
    });
    assert.deepEqual(
      preview.templates.map((template) => template.item),
      [agreement, policy],
    );
    assert.deepEqual(await rows(), []);

    // Recording needs the checksum of exactly these terms, from the owner.
    const approval = { reference: "synthetic-owner-bundle-approval-1", confirm: preview.checksum };
    assert.equal((await record({ ...terms({ amount: "4000.01" }), ...approval })).status, 409);
    assert.equal(
      (await record({ ...terms({ items: [agreement, policy] }), ...approval }, system)).status,
      403,
    );
    assert.deepEqual(await rows(), []);
    // The same templates chosen in another order are the same terms.
    const recorded = await record({ ...terms({ items: [agreement, policy] }), ...approval });
    assert.equal(recorded.status, 200);
    const first = RecordOwnerBundleResponse.parse(await recorded.json());
    assert.deepEqual(first.closed, []);
    const [row] = await db.select().from(valoBundles).where(eq(valoBundles.id, first.bundleId));
    // The owner's own sign-in is the approval's author, not a typed name.
    assert.equal(
      row?.approvalReference,
      `synthetic-owner-bundle-approval-1 (approved by the development owner, ${owner})`,
    );
    assert.deepEqual(
      (await versions()).map((version) => [version.bundleId, version.items, version.amountKobo]),
      [[first.bundleId, [agreement, policy].sort(), 400000]],
    );

    // The next version closes the open one when it starts; the earlier one keeps its terms.
    const nextTerms = terms({ title: "Synthetic starter bundle, second", amount: "4500.00" });
    const next = PreviewOwnerBundleResponse.parse(
      await (await call(path + "/previews", nextTerms, owner)).json(),
    );
    const secondResponse = await record({
      ...nextTerms,
      reference: "synthetic-owner-bundle-approval-2",
      confirm: next.checksum,
    });
    assert.equal(secondResponse.status, 200);
    const second = RecordOwnerBundleResponse.parse(await secondResponse.json());
    assert.deepEqual(second.closed, [{ bundleId: first.bundleId, amountKobo: 400000 }]);
    const [closed] = await db.select().from(valoBundles).where(eq(valoBundles.id, first.bundleId));
    assert.deepEqual(
      [closed?.title, closed?.amountKobo, closed?.licenceVersion, closed?.items],
      ["Synthetic starter bundle", 400000, "synthetic-bundle-1", [agreement, policy].sort()],
    );
    assert.equal(+closed!.effectiveTo!, +second.from);
    const changes = await db
      .select({ action: valoBundleChanges.action })
      .from(valoBundleChanges)
      .where(eq(valoBundleChanges.bundleId, first.bundleId))
      .orderBy(asc(valoBundleChanges.changedAt), asc(valoBundleChanges.id));
    assert.deepEqual(
      changes.map((change) => change.action),
      ["created", "closed"],
    );
    assert.deepEqual(
      (await versions()).map((version) => version.bundleId),
      [second.bundleId],
    );

    // A version scheduled to start later closes the one in effect then, which shows its end until it comes.
    const startsLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const scheduledTerms = terms({ amount: "5000.00", from: startsLater.toISOString() });
    const scheduledPreview = PreviewOwnerBundleResponse.parse(
      await (await call(path + "/previews", scheduledTerms, owner)).json(),
    );
    const scheduledResponse = await record({
      ...scheduledTerms,
      reference: "synthetic-owner-bundle-approval-3",
      confirm: scheduledPreview.checksum,
    });
    assert.equal(scheduledResponse.status, 200);
    const scheduled = RecordOwnerBundleResponse.parse(await scheduledResponse.json());
    assert.deepEqual(scheduled.closed, [{ bundleId: second.bundleId, amountKobo: 450000 }]);
    assert.deepEqual(
      (await versions()).map((version) => [
        version.bundleId,
        +version.effectiveFrom === +startsLater,
        version.effectiveTo && +version.effectiveTo,
      ]),
      [
        [second.bundleId, false, +startsLater],
        [scheduled.bundleId, true, null],
      ],
    );
    // Nothing starts before a version already scheduled, or in the past.
    for (const from of [new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), "2020-01-01T00:00:00Z"]) {
      const early = terms({ amount: "5500.00", from });
      const earlyPreview = PreviewOwnerBundleResponse.parse(
        await (await call(path + "/previews", early, owner)).json(),
      );
      const refused = await record({
        ...early,
        reference: "synthetic-owner-bundle-approval-4",
        confirm: earlyPreview.checksum,
      });
      assert.equal(refused.status, 409, from);
    }
    assert.equal((await rows()).length, 3);
  } finally {
    for (const identity of [owner, system])
      await db.update(roles).set({ active: false }).where(eq(roles.identityId, identity));
  }
}
