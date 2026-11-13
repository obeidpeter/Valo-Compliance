import { Router } from "express";
import { z } from "zod";
import { ListPublicCatalogueQueryParams } from "@workspace/api-zod";
import { readiness, catalogueSummary, contentReadiness, baselineTemplates } from "@workspace/valo-core";
import { verifiedWorkspace, sameOriginMutation } from "../middlewares/valo-identity";
import * as store from "../lib/valo-store";

const router = Router();
router.get("/public/catalogue", (req, res) => {
  const query = ListPublicCatalogueQueryParams.parse(req.query);
  // There are NO approved public records yet. Held metadata and private
  // documents are never searched, previewed or returned as released content.
  res.json({ items: [], total: 0, page: query.page ?? 1, heldTemplates: catalogueSummary.baselineIdentified });
});
router.get("/public/status", (_req, res) => {
  const state = readiness();
  res.json({
    receivedRequirements: state.receivedFormalRequirements, expectedRequirements: state.expectedFormalRequirements,
    publishedTemplates: catalogueSummary.published, p0Passed: false, r2Unlocked: false, livePaymentsEnabled: false,
    notice: "Development only. Synthetic data only. R1 gates have not passed; unreviewed content, live payments and public launch remain disabled.",
  });
});
router.get("/development/requirements", (_req, res) => {
  if (process.env.NODE_ENV === "production") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  res.json(readiness());
});
router.get("/development/content", (_req, res) => {
  if (process.env.NODE_ENV === "production") { res.sendStatus(404); return; }
  res.setHeader("Cache-Control", "no-store");
  const c = contentReadiness();
  res.json({
    rows: [
      ...baselineTemplates.map(t => ({
        id: t.id, title: t.title, kind: "R1 baseline template", status: "held",
        relatedIds: [], limitation: t.holdReasons.join("; "),
      })),
      ...c.supplementaryMappings.map(m => ({
        id: m.source_id, title: m.source_title, kind: `Supplementary mapping: ${m.mapping_type}`,
        status: "inventory_only", relatedIds: [...(m.canonical_template_id ? [m.canonical_template_id] : []), ...m.related_template_ids],
        limitation: m.note,
      })),
      ...c.identifiedAdditions.map(t => ({
        id: t.id, title: t.title, kind: "Identified R2 template addition", status: "held",
        relatedIds: [t.source_item_id], limitation: t.hold_reasons.join("; "),
      })),
      ...c.furtherProposals.map(t => ({
        id: t.id, title: t.title, kind: "Further distinct-purpose proposal", status: "proposed_not_published",
        relatedIds: [], limitation: `${t.rationale} ${t.distinctness}`,
      })),
      ...c.regulatoryRows.map(r => ({
        id: r.source_id, title: r.source_title, kind: `Regulatory research: ${r.classification}`, status: "held",
        relatedIds: [r.canonical_topic_id], limitation: r.hold_reasons.join("; "),
      })),
    ],
    industries: c.industryTaxonomy, deeperPacks: c.deeperPacks,
    identifiedTemplates: c.summary.identifiedIncludingProposals,
    regulatoryRows: c.summary.regulatoryRows, publishedTemplates: 0, notice: c.summary.notice,
  });
});
router.use("/workspace", sameOriginMutation, verifiedWorkspace);
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
export default router;
