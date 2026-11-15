import { Router } from "express";
import { GetSourceEvidenceResponse } from "@workspace/api-zod";
import { sourceEvidenceRegister } from "../editorial/source-register";
import { z } from "zod";
import { ListPublicCatalogueQueryParams, GetProofRegisterResponse, GetContentRegisterResponse, GetPublicCoverageResponse } from "@workspace/api-zod";
import { readiness, catalogueSummary, contentReadiness, contentTraceRows, expansionReadiness, coveragePlan } from "@workspace/valo-core";
import { verifiedWorkspace, sameOriginMutation } from "../middlewares/valo-identity";
import * as store from "../lib/valo-store";
import requirementsRouter from "./valo-requirements";
import customerAIRouter from "./valo-customer-ai";
import { releasedCatalogue,releasedTemplate,createReleasedTemplateDraft,readReleasedMaster,liveCoverage } from "../lib/valo-released-content";
import { exportMime } from "../lib/valo-render";
import { GetReleasedTemplateResponse } from "@workspace/api-zod";
import { GetReleasedResourceResponse as ReleasedResource } from "@workspace/api-zod";
import { publicAccessRouter,customerAccessRouter,staffOperationsRouter,createPrivacyRequesterRouter } from "./valo-customer-access";
import { releasedResources } from "../lib/valo-released-content";
import { commerceRouter } from "./valo-commerce";

import {customerPaymentConcernsRouter,financePaymentConcernsRouter} from "./valo-payment-concerns";
const router = Router();
router.use(publicAccessRouter);
router.use(staffOperationsRouter);
router.use(financePaymentConcernsRouter);
// Register these case-only routes before the broad workspace-membership gate.
// Unhandled operations (verification/cancellation/full exports) still fall
// through to their existing workspace authority checks.
router.use("/workspace/privacy-cases",createPrivacyRequesterRouter());
router.get("/public/resources",async(_req,res)=>{
  res.set("Cache-Control","no-store");res.json((await releasedResources()).map(r=>ReleasedResource.parse(r)));
});
router.get("/public/resources/:slug",async(req,res)=>{
  const item=(await releasedResources()).find(r=>r.slug===z.string().max(100).parse(req.params.slug));
  if(!item){res.status(404).json({error:"This resource is unavailable or no longer released."});return;}
  res.set("Cache-Control","no-store");res.json(ReleasedResource.parse(item));
});
router.get("/development/source-evidence",async (_req,res):Promise<void>=>{
  if(process.env.NODE_ENV!=="development"){res.status(404).json({error:"Not found"});return;}
  res.set("Cache-Control","no-store");
  res.json(GetSourceEvidenceResponse.parse(await sourceEvidenceRegister()));
});
router.get("/public/coverage", async (_req, res) => {
  res.set("Cache-Control","no-store");
  res.json(GetPublicCoverageResponse.parse(await liveCoverage()));
});
router.get("/public/catalogue", async (req, res) => {
  const query = ListPublicCatalogueQueryParams.parse(req.query);
  // Consult live eligibility on every request; never search held/private records.
  res.set("Cache-Control","no-store");
  res.json(await releasedCatalogue(query));
});
router.get("/public/templates/:slug",async(req,res)=>{
  res.set("Cache-Control","no-store");res.json(GetReleasedTemplateResponse.parse(await releasedTemplate(z.string().max(100).parse(req.params.slug))));
});
router.get("/public/recommendations",async(_req,res)=>{
  res.set("Cache-Control","no-store");res.json(await releasedCatalogue());
});
router.get("/public/status", async (_req, res) => {
  const state = readiness();
  res.json({
    receivedRequirements: state.receivedFormalRequirements, expectedRequirements: state.expectedFormalRequirements,
    publishedTemplates: (await releasedCatalogue({type:"template"})).total, p0Passed: false, r2Unlocked: false, livePaymentsEnabled: false,
    notice: "Development only. Synthetic data only. R1 gates have not passed; unreviewed content, live payments and public launch remain disabled.",
  });
});
router.get("/development/requirements", (_req, res) => {
  if (process.env.NODE_ENV === "production") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(readiness());
});
router.get("/development/proof", (_req, res) => {
  if (process.env.NODE_ENV === "production") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(GetProofRegisterResponse.parse(readiness()));
});
router.get("/development/content", async (_req, res) => {
  if (process.env.NODE_ENV === "production") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  const c = contentReadiness();
  res.json(GetContentRegisterResponse.parse({
    rows: contentTraceRows(),
    industries: c.industryTaxonomy, deeperPacks: c.deeperPacks,
    identifiedTemplates: c.summary.identifiedIncludingProposals,
    regulatoryRows: c.summary.regulatoryRows, publishedTemplates: (await releasedCatalogue({type:"template"})).total,
    notice: `${c.summary.notice} 78 canonical research keys remain after the explicit SCUML alias only; other umbrella overlaps remain. Neither figure counts distinct published entries.`,
    overlaps:c.overlaps, ...expansionReadiness(),
  }));
});
router.use("/workspace", sameOriginMutation, verifiedWorkspace);
router.use(customerAccessRouter);
router.use(commerceRouter);
router.use(customerPaymentConcernsRouter);
router.get("/workspace", async (_req, res) => { res.json(await store.getWorkspace(res.locals.valoActor)); });
router.put("/workspace/profile", async (req, res) => { res.json(await store.saveProfile(res.locals.valoActor, req.body)); });
router.get("/workspace/documents", async (_req, res) => { res.json(await store.listDocuments(res.locals.valoActor)); });
router.post("/workspace/documents", async (req, res) => { res.status(201).json(await store.createDocument(res.locals.valoActor, req.body)); });
router.get("/workspace/documents/:id", async (req, res) => {
  res.json(await store.getDocument(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.patch("/workspace/documents/:id", async (req, res) => {
  res.json(await store.saveDocument(res.locals.valoActor, z.string().uuid().parse(req.params.id), req.body));
});
router.get("/workspace/documents/:id/revisions", async (req, res) => {
  res.json(await store.listRevisions(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.post("/workspace/support", async (req, res) => { res.status(201).json(await store.createTicket(res.locals.valoActor, req.body)); });
// Mounted after the shared server identity, workspace and CSRF boundary above.
router.use(requirementsRouter);
router.use(customerAIRouter);
router.post("/workspace/templates/:id/draft",async(req,res)=>{
  res.set("Cache-Control","private, no-store");
  res.status(201).json(await createReleasedTemplateDraft(res.locals.valoActor,z.string().uuid().parse(req.params.id)));
});
router.get("/workspace/templates/:id/files/:format",async(req,res)=>{
  const format=z.enum(["docx","pdf"]).parse(req.params.format);
  const asset=await readReleasedMaster(z.string().uuid().parse(req.params.id),format,res.locals.valoActor);
  res.set({"Content-Type":exportMime[format],"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
    "Content-Disposition":`attachment; filename="${asset.templateId}-v${asset.version}.${format}"`});
  res.send(asset.bytes);
});
export default router;

