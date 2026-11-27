import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import {
  GetCustomerPurchasesResponse,
  GetManualLibraryRevisionResponse,
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
 * Buying a bundle (docs/architecture/commercial-settings.md, slice 4c; ADM-006, PAY-005) against the real
 * staff library: the owner records a bundle of two released premium templates; checkout offers it while
 * each template is on sale, and not while one is held; a bundle's order copies the bundle's terms and each
 * template's edition; its settlement grants each edition once; both templates then download, the workspace
 * is not sold either again, and a later edition carries under the order's rule. The owner's next version
 * leaves the order's amount, licence and editions as they were, and a reversal ends both grants together.
 */
export async function exerciseBundlePurchase(call: Call, editor: string) {
  const {
    db,
    runInWorkspaceScope,
    valoEntitlements,
    valoOrders,
    valoStaffAssignments: roles,
    valoStaffRoleChanges: audit,
  } = await import("@workspace/db");
  const { resolveWorkspace } = await import("../modules/workspaces");
  const { createOrder, settleVerifiedOrder } = await import("../modules/commerce");
  const id = randomUUID(),
    mark = id.slice(0, 8),
    owner = "synthetic-bundle-buy-owner-" + id,
    assignment = randomUUID();
  await db.insert(roles).values({
    id: assignment,
    identityId: owner,
    role: "system",
    grantedBy: "synthetic operator",
    reason: "Synthetic bundle purchase test",
  });
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
    reason: "Synthetic bundle purchase owner fixture",
    after: { active: true },
    targetVerifiedAt: new Date(),
  });
  try {
    const library = (itemId: string) => "/admin/manual-library/" + itemId;
    const revision = async (response: Response) => {
      const body: unknown = await response.json();
      assert.equal(response.status, 200, JSON.stringify(body));
      return GetManualLibraryRevisionResponse.parse(body);
    };
    const release = async (itemId: string, title: string, baseVersion = 0) => {
      const draft = await revision(
        await call(
          library(itemId) + "/drafts",
          {
            kind: "premium_template",
            title,
            body: "Public description of " + title + ".",
            industry: null,
            requestId: randomUUID(),
            baseVersion,
            ...(baseVersion
              ? { fileMode: "keep" }
              : {
                  fileMode: "upload",
                  upload: {
                    format: "docx",
                    base64: wordFromText(title, "Only its buyers may read this sentence.").bytes.toString(
                      "base64",
                    ),
                  },
                }),
            ...templateDetails,
          },
          editor,
        ),
      );
      return revision(await call(library(itemId) + "/actions", libraryAction("publish", draft), editor));
    };
    const agreementItem = randomUUID(),
      policyItem = randomUUID();
    const agreementTitle = `Synthetic bundled agreement ${mark}`,
      policyTitle = `Synthetic bundled policy ${mark}`;
    const agreement = await release(agreementItem, agreementTitle);
    const policy = await release(policyItem, policyTitle);
    const holding = (itemId: string, action: "hold" | "lift", edition: { version: number; digest: string }) =>
      call(
        library(itemId) + "/holds",
        {
          action,
          version: edition.version,
          digest: edition.digest,
          reason:
            action === "hold"
              ? "Synthetic: held while its payment clause is checked against the Act."
              : "Synthetic: the payment clause was checked and needs no change.",
        },
        editor,
      );

    // The owner records the bundle, as on the owner's screen.
    const licenceText = "Synthetic bundle licence for one business's own use only.";
    const record = async (amount: string, reference: string) => {
      const terms = {
        bundle: "synthetic-buy-" + mark,
        title: "Synthetic starter bundle",
        items: [agreementItem, policyItem],
        amount,
        licenceVersion: "synthetic-bundle-1",
        licenceText,
        taxTreatment: "Synthetic tax treatment",
        from: "now",
      };
      const preview = PreviewOwnerBundleResponse.parse(
        await (await call("/admin/owner-bundles/previews", terms, owner)).json(),
      );
      const recorded = await call(
        "/admin/owner-bundles",
        { ...terms, reference, confirm: preview.checksum },
        owner,
      );
      assert.equal(recorded.status, 200);
      return RecordOwnerBundleResponse.parse(await recorded.json());
    };
    const first = await record("6000.00", "synthetic-owner-bundle-approval-1");

    const purchases = async (identity: string) => {
      const response = await call("/workspace/purchases", undefined, identity);
      const body = await response.text();
      assert.equal(response.status, 200, body);
      return GetCustomerPurchasesResponse.parse(JSON.parse(body));
    };
    const offered = async (identity: string) =>
      (await purchases(identity)).bundles.filter((bundle) => bundle.bundle === "synthetic-buy-" + mark);
    const download = async (edition: string, identity: string) =>
      (await call("/workspace/manual-premium-templates/" + edition + "/download", undefined, identity))
        .status;
    const buyer = await resolveWorkspace("synthetic-bundle-buyer-" + id);
    const order = (body: Record<string, unknown>) =>
      runInWorkspaceScope(buyer.workspaceId, () =>
        createOrder(buyer, {
          bundleId: first.bundleId,
          acceptedLicenceVersion: "synthetic-bundle-1",
          acceptedCarriesToLaterEditions: true,
          requestKey: randomUUID(),
          ...body,
        }),
      );

    // Checkout offers the bundle with each template's released edition, by title.
    assert.deepEqual(
      (await offered(buyer.identityId)).map((bundle) => [bundle.id, bundle.amountKobo, bundle.templates]),
      [
        [
          first.bundleId,
          600000,
          [
            { edition: agreement.id, title: agreementTitle },
            { edition: policy.id, title: policyTitle },
          ],
        ],
      ],
    );
    // While one of its templates is held, the bundle is neither offered nor ordered.
    assert.equal((await holding(policyItem, "hold", policy)).status, 200);
    assert.deepEqual(await offered(buyer.identityId), []);
    await assert.rejects(order({}), /A template in this bundle is not available for purchase now/);
    assert.equal((await holding(policyItem, "lift", policy)).status, 200);
    // An order names one template or one bundle, with the licence and the access rule its buyer was shown.
    await assert.rejects(order({ priceId: randomUUID() }), /Choose one template or one bundle/);
    await assert.rejects(order({ acceptedLicenceVersion: "synthetic-bundle-0" }), /The licence changed/);
    await assert.rejects(
      order({ acceptedCarriesToLaterEditions: false }),
      /What a purchase includes has changed/,
    );
    await assert.rejects(order({ bundleId: randomUUID() }), /This bundle is not on sale now/);

    // A bundle's order copies the bundle's terms and the edition of each of its templates.
    const made = await order({});
    assert.equal(made.amountKobo, 600000);
    assert.equal(made.contentVersionId, null);
    assert.deepEqual(made.editions, [
      { contentVersionId: agreement.id, title: agreementTitle },
      { contentVersionId: policy.id, title: policyTitle },
    ]);
    const [stored] = await db.select().from(valoOrders).where(eq(valoOrders.id, made.id));
    assert.deepEqual([stored?.priceId, stored?.bundleId], [null, first.bundleId]);
    const terms = stored?.line;
    // Nothing is granted before a verified payment, and asking again returns the same order.
    assert.equal(await download(agreement.id, buyer.identityId), 403);
    const again = await runInWorkspaceScope(buyer.workspaceId, () =>
      createOrder(buyer, {
        bundleId: first.bundleId,
        acceptedLicenceVersion: "synthetic-bundle-1",
        acceptedCarriesToLaterEditions: true,
        requestKey: randomUUID(),
      }),
    );
    assert.equal(again.id, made.id);

    // PAY-005: a verified payment grants each edition once, however often it is reported.
    const verified = {
      id: String(Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 12), 16)),
      domain: "test" as const,
      status: "success" as const,
      reference: made.reference,
      amount: made.amountKobo,
      currency: "NGN" as const,
      metadata: { valoOrderId: made.id, workspaceId: buyer.workspaceId },
    };
    await settleVerifiedOrder(made.id, verified);
    await settleVerifiedOrder(made.id, verified);
    const grants = async () =>
      (
        await db
          .select({ edition: valoEntitlements.contentVersionId, status: valoEntitlements.status })
          .from(valoEntitlements)
          .where(eq(valoEntitlements.orderId, made.id))
          .orderBy(asc(valoEntitlements.contentVersionId))
      ).map((grant) => [grant.edition, grant.status]);
    assert.deepEqual(
      await grants(),
      [agreement.id, policy.id].sort().map((edition) => [edition, "active"]),
    );
    for (const edition of [agreement.id, policy.id])
      assert.equal(await download(edition, buyer.identityId), 200);
    // Both templates are the workspace's own now, and the bundle is no longer offered to it.
    const bought = await purchases(buyer.identityId);
    const byEdition = (a: string[], b: string[]) => a[0]!.localeCompare(b[0]!);
    assert.deepEqual(
      bought.ownedDownloads
        .filter((file) => [agreement.id, policy.id].includes(file.edition))
        .map((file) => [file.edition, file.title, file.downloadPath])
        .sort(byEdition),
      [
        [
          agreement.id,
          agreementTitle,
          "/api/workspace/manual-premium-templates/" + agreement.id + "/download",
        ],
        [policy.id, policyTitle, "/api/workspace/manual-premium-templates/" + policy.id + "/download"],
      ].sort(byEdition),
    );
    assert.deepEqual(await offered(buyer.identityId), []);
    await assert.rejects(order({}), /already owns a template in this bundle/);
    // Another workspace is offered the bundle, and holds nothing of it.
    const stranger = await resolveWorkspace("synthetic-bundle-stranger-" + id);
    assert.equal((await offered(stranger.identityId)).length, 1);
    assert.equal(await download(agreement.id, stranger.identityId), 403);

    // ADM-006: the owner's next version of the bundle leaves the order's amount, licence and editions.
    const second = await record("7500.00", "synthetic-owner-bundle-approval-2");
    assert.deepEqual(second.closed, [{ bundleId: first.bundleId, amountKobo: 600000 }]);
    const [kept] = await db.select().from(valoOrders).where(eq(valoOrders.id, made.id));
    assert.deepEqual([kept?.amountKobo, kept?.bundleId, kept?.line], [600000, first.bundleId, terms]);
    assert.equal(await download(policy.id, buyer.identityId), 200);
    assert.deepEqual(
      (await offered(stranger.identityId)).map((bundle) => [bundle.id, bundle.amountKobo]),
      [[second.bundleId, 750000]],
    );

    // Under the access rule the order recorded, its purchase carries to a template's next edition.
    const nextAgreement = await release(agreementItem, agreementTitle, 1);
    assert.equal(await download(nextAgreement.id, buyer.identityId), 200);
    assert.equal(await download(nextAgreement.id, stranger.identityId), 403);

    // A reversed payment ends both grants together.
    await settleVerifiedOrder(made.id, { ...verified, status: "reversed" });
    assert.deepEqual(
      await grants(),
      [agreement.id, policy.id].sort().map((edition) => [edition, "suspended"]),
    );
    for (const edition of [nextAgreement.id, policy.id])
      assert.equal(await download(edition, buyer.identityId), 403);
  } finally {
    await db.update(roles).set({ active: false }).where(eq(roles.identityId, owner));
  }
}
