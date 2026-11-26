import { Router } from "express";
import { GetSourceEvidenceResponse } from "@workspace/api-zod";
import { sourceEvidenceRegister } from "../modules/sources";
import { z } from "zod";
import {
  ListPublicCatalogueQueryParams,
  GetProofRegisterResponse,
  GetContentRegisterResponse,
  GetPublicCoverageResponse,
} from "@workspace/api-zod";
import { contentReadiness, contentTraceRows, expansionReadiness } from "@workspace/valo-core";
import { readiness } from "@workspace/valo-records";
import { verifiedWorkspace, sameOriginMutation } from "../middlewares/valo-identity";
import { createTicket } from "../modules/support";
import {
  listDocuments,
  getDocument,
  getDocumentForm,
  listFormTemplates,
  listRevisions,
  createDocument,
  saveDocument,
  startFormDocument,
} from "../modules/documents";
import { getWorkspace, saveProfile } from "../modules/workspaces";
import requirementsRouter from "./valo-requirements";
import customerAIRouter from "./valo-customer-ai";
import {
  releasedCatalogue,
  releasedTemplate,
  createReleasedTemplateDraft,
  readReleasedMaster,
  liveCoverage,
  publishedTemplateCount,
  releasedResource,
  releasedResources,
} from "../modules/catalogue";
import { exportMime } from "../lib/valo-render";
import { GetReleasedTemplateResponse } from "@workspace/api-zod";
import { GetReleasedResourceResponse as ReleasedResource } from "@workspace/api-zod";
import {
  publicAccessRouter,
  customerAccessRouter,
  staffOperationsRouter,
  createPrivacyRequesterRouter,
} from "./valo-customer-access";
import { commerceRouter } from "./valo-commerce";
import {
  listDocumentEditions,
  listEditionNotices,
  markEditionNoticeRead,
  savedTemplateList,
  saveTemplate,
  unsaveTemplate,
} from "../modules/catalogue";
import {
  ListDocumentEditionsResponse,
  ListEditionNoticesResponse,
  ListRuleNoticesResponse,
  MarkEditionNoticeReadResponse,
  MarkRuleNoticeReadResponse,
} from "@workspace/api-zod";
import { listRuleNotices, markRuleNoticeRead } from "../modules/rules";
import { publicDiscovery } from "../modules/catalogue";
import { setting } from "../platform/settings";
import { supportCustomerRouter, supportOperationsRouter } from "./valo-support-lifecycle";

import { customerPaymentConcernsRouter, financePaymentConcernsRouter } from "./valo-payment-concerns";
import { createSessionVerificationRouter } from "./valo-session-verification";
import { makeStaffGate } from "../middlewares/valo-staff-gate";
import { createManualLibraryRouter, premiumManualTemplateRouter } from "./valo-manual-library";
import { sourceControlsRouter, correctionNoticesRouter } from "./valo-source-controls";
import { acceptanceReviewRouter } from "./valo-acceptance-review";
import { ownerPriceRouter } from "./valo-owner-prices";
import { ownerSettingRouter } from "./valo-owner-settings";
const router = Router();
router.use(createSessionVerificationRouter());
router.use(publicAccessRouter);
// Refuse accounts without any active staff assignment before staff routes read input.
router.use("/admin", makeStaffGate());
router.use(createManualLibraryRouter());
router.use(staffOperationsRouter);
router.use(sourceControlsRouter);
router.use(acceptanceReviewRouter);
router.use(ownerPriceRouter);
router.use(ownerSettingRouter);
router.use(supportOperationsRouter);
router.get("/public/discovery", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await publicDiscovery());
});
router.use(financePaymentConcernsRouter);
// Register these case-only routes before the broad workspace-membership gate.
// Unhandled operations (verification/cancellation/full exports) still fall
// through to their existing workspace authority checks.
router.use("/workspace/privacy-cases", createPrivacyRequesterRouter());
router.get("/public/resources", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json((await releasedResources()).map((r) => ReleasedResource.parse(r)));
});
router.get("/public/resources/:slug", async (req, res) => {
  const item = await releasedResource(z.string().max(100).parse(req.params.slug));
  if (!item) {
    res.status(404).json({ error: "This guide is not available, or it is no longer published." });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(ReleasedResource.parse(item));
});
router.get("/development/source-evidence", async (_req, res): Promise<void> => {
  if (setting("NODE_ENV") !== "development") {
    res.status(404).json({ error: "This was not found." });
    return;
  }
  res.set("Cache-Control", "no-store");
  res.json(GetSourceEvidenceResponse.parse(await sourceEvidenceRegister()));
});
router.get("/public/coverage", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(GetPublicCoverageResponse.parse(await liveCoverage()));
});
router.get("/public/catalogue", async (req, res) => {
  const query = ListPublicCatalogueQueryParams.parse(req.query);
  // Consult live eligibility on every request; never search held/private records.
  res.set("Cache-Control", "no-store");
  res.json(await releasedCatalogue(query));
});
router.get("/public/templates/:slug", async (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(
    GetReleasedTemplateResponse.parse(await releasedTemplate(z.string().max(100).parse(req.params.slug))),
  );
});
router.get("/public/recommendations", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(await releasedCatalogue({ type: "template" }));
});
router.get("/public/status", async (_req, res) => {
  const state = readiness();
  res.set("Cache-Control", "no-store");
  res.json({
    receivedRequirements: state.receivedFormalRequirements,
    expectedRequirements: state.expectedFormalRequirements,
    publishedTemplates: await publishedTemplateCount(),
    p0Passed: false,
    r2Unlocked: false,
    livePaymentsEnabled: false,
    notice:
      "Development only. Synthetic data only. R1 gates have not passed; unreviewed content, live payments and public launch remain disabled.",
  });
});
router.get("/development/requirements", (_req, res) => {
  if (setting("NODE_ENV") === "production") {
    res.sendStatus(404);
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(readiness());
});
router.get("/development/proof", (_req, res) => {
  if (setting("NODE_ENV") === "production") {
    res.sendStatus(404);
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json(GetProofRegisterResponse.parse(readiness()));
});
router.get("/development/content", async (_req, res) => {
  if (setting("NODE_ENV") === "production") {
    res.sendStatus(404);
    return;
  }
  res.setHeader("Cache-Control", "no-store");
  const c = contentReadiness();
  res.json(
    GetContentRegisterResponse.parse({
      rows: contentTraceRows(),
      industries: c.industryTaxonomy,
      deeperPacks: c.deeperPacks,
      identifiedTemplates: c.summary.identifiedIncludingProposals,
      regulatoryRows: c.summary.regulatoryRows,
      publishedTemplates: await publishedTemplateCount(),
      notice: `${c.summary.notice} 78 canonical research keys remain after the explicit SCUML alias only; other umbrella overlaps remain. Neither figure counts distinct published entries.`,
      overlaps: c.overlaps,
      ...expansionReadiness(),
    }),
  );
});
router.use("/workspace", sameOriginMutation, verifiedWorkspace);
router.use(customerAccessRouter);
router.use(correctionNoticesRouter);
router.use(supportCustomerRouter);
router.use(commerceRouter);
router.get("/workspace/saved-templates", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(await savedTemplateList(res.locals.valoActor));
});
router.put("/workspace/saved-templates/:id", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(await saveTemplate(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.delete("/workspace/saved-templates/by-template/:templateId", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(
    await unsaveTemplate(
      res.locals.valoActor,
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,80}$/)
        .parse(req.params.templateId),
    ),
  );
});
router.use(customerPaymentConcernsRouter);
router.get("/workspace", async (_req, res) => {
  res.json(await getWorkspace(res.locals.valoActor));
});
router.put("/workspace/profile", async (req, res) => {
  res.json(await saveProfile(res.locals.valoActor, req.body));
});
router.get("/workspace/documents", async (_req, res) => {
  res.json(await listDocuments(res.locals.valoActor));
});
router.post("/workspace/documents", async (req, res) => {
  res.status(201).json(await createDocument(res.locals.valoActor, req.body));
});
// Where the template edition behind each of the workspace's documents stands, for those whose edition
// was replaced or withdrawn (docs/architecture/editions.md).
router.get("/workspace/document-editions", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListDocumentEditionsResponse.parse(await listDocumentEditions(res.locals.valoActor)));
});
// The workspace's notices that a template edition it bought or used was replaced or withdrawn.
router.get("/workspace/edition-notices", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListEditionNoticesResponse.parse(await listEditionNotices(res.locals.valoActor)));
});
router.post("/workspace/edition-notices/:id/read", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(
    MarkEditionNoticeReadResponse.parse(
      await markEditionNoticeRead(res.locals.valoActor, z.string().uuid().parse(req.params.id)),
    ),
  );
});
// The workspace's notices that a requirements-check rule version it saved a result under, or made a
// task from, was replaced or withdrawn (docs/architecture/rule-changes.md).
router.get("/workspace/rule-notices", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListRuleNoticesResponse.parse(await listRuleNotices(res.locals.valoActor)));
});
router.post("/workspace/rule-notices/:id/read", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(
    MarkRuleNoticeReadResponse.parse(
      await markRuleNoticeRead(res.locals.valoActor, z.string().uuid().parse(req.params.id)),
    ),
  );
});
router.get("/workspace/documents/:id", async (req, res) => {
  res.json(await getDocument(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.patch("/workspace/documents/:id", async (req, res) => {
  res.json(await saveDocument(res.locals.valoActor, z.string().uuid().parse(req.params.id), req.body));
});
router.get("/workspace/form-templates", async (_req, res) => {
  res.json(await listFormTemplates(res.locals.valoActor));
});
router.post("/workspace/form-documents", async (req, res) => {
  res.status(201).json(await startFormDocument(res.locals.valoActor, req.body));
});
router.get("/workspace/documents/:id/form", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(await getDocumentForm(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.get("/workspace/documents/:id/revisions", async (req, res) => {
  res.json(await listRevisions(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.post("/workspace/support", async (req, res) => {
  res.status(201).json(await createTicket(res.locals.valoActor, req.body));
});
// Mounted after the shared server identity, workspace and CSRF boundary above.
router.use(requirementsRouter);
router.use(customerAIRouter);
router.use(premiumManualTemplateRouter);
router.post("/workspace/templates/:id/draft", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res
    .status(201)
    .json(await createReleasedTemplateDraft(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.get("/workspace/templates/:id/files/:format", async (req, res) => {
  const format = z.enum(["docx", "pdf"]).parse(req.params.format);
  const asset = await readReleasedMaster(
    z.string().uuid().parse(req.params.id),
    format,
    res.locals.valoActor,
  );
  res.set({
    "Content-Type": exportMime[format],
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `attachment; filename="${asset.templateId}-v${asset.version}.${format}"`,
  });
  res.send(asset.bytes);
});
export default router;
