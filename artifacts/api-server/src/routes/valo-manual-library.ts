import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  DecideOwnerGuidanceResponse,
  RefreshOwnerGuidanceResponse,
  GetManualLibraryRevisionResponse,
  ListManualLibraryResponse,
  ListOwnerGuidanceResponse,
} from "@workspace/api-zod";
import { verifiedStaffSession } from "../lib/valo-managed-session";
import { mutationOriginFor, sameOriginMutation } from "../middlewares/valo-identity";
import { requestComplexityLimit } from "../platform/request-complexity";
import { exportMime } from "../lib/valo-render";
import type { SourceStaffActor } from "../modules/sources";
import { listOwnerGuidance, decideOwnerGuidance, refreshOwnerSources } from "../modules/manual-guidance";
import {
  authorizeManualEditor,
  listManualLibrary,
  getManualRevision,
  saveManualDraft,
  actOnManualRevision,
  privateManualFile,
  releasedManualFile,
  purchasedManualFile,
} from "../modules/manual-library";

const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
function sendManualFile(res: Response, file: Awaited<ReturnType<typeof releasedManualFile>>) {
  res.set({
    "Content-Type": exportMime[file.format],
    "Content-Disposition": 'attachment; filename="' + file.filename + '"',
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  });
  res.send(file.bytes);
}
/** Mounted after workspace identity resolution, on the scoped customer connection. */
export const premiumManualTemplateRouter = Router().get(
  "/workspace/manual-premium-templates/:id/download",
  async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    sendManualFile(res, await purchasedManualFile(res.locals.valoActor, uuid.parse(req.params.id)));
  },
);
export function createManualLibraryRouter(
  authenticate: (req: Request) => Promise<SourceStaffActor> = verifiedStaffSession,
) {
  const router = Router();
  router.use("/admin/owner-guidance", async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.locals.guidanceOwner = res.locals.verifiedStaff ?? (await authenticate(req));
    next();
  });
  router.get("/admin/owner-guidance", async (req, res) => {
    const page = z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page);
    res.json(ListOwnerGuidanceResponse.parse(await listOwnerGuidance(res.locals.guidanceOwner, page)));
  });
  router.post("/admin/owner-guidance/:id/source-check", sameOriginMutation, async (req, res) => {
    res.json(
      RefreshOwnerGuidanceResponse.parse(
        await refreshOwnerSources(res.locals.guidanceOwner, uuid.parse(req.params.id), req.body),
      ),
    );
  });
  router.post("/admin/owner-guidance/:id/decisions", sameOriginMutation, async (req, res) => {
    const result = await decideOwnerGuidance(res.locals.guidanceOwner, uuid.parse(req.params.id), req.body);
    res.json(DecideOwnerGuidanceResponse.parse(result));
  });
  router.use("/admin/manual-library", async (req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    res.locals.manualEditor = res.locals.verifiedStaff ?? (await authenticate(req));
    await authorizeManualEditor(res.locals.manualEditor);
    next();
  });
  router.get("/admin/manual-library", async (req, res) => {
    res.json(
      ListManualLibraryResponse.parse(
        await listManualLibrary(
          res.locals.manualEditor,
          z.coerce.number().int().min(1).max(10000).default(1).parse(req.query.page),
        ),
      ),
    );
  });
  router.get("/admin/manual-library/:id", async (req, res) => {
    res.json(
      GetManualLibraryRevisionResponse.parse(
        await getManualRevision(res.locals.manualEditor, uuid.parse(req.params.id)),
      ),
    );
  });
  // Only verified content staff can reach the larger parser. All other JSON routes keep their normal limit.
  const draftMedia = "application/vnd.valo.manual-draft+json";
  router.post(
    "/admin/manual-library/:id/drafts",
    mutationOriginFor(draftMedia),
    express.json({ type: draftMedia, limit: "3mb", inflate: false }),
    requestComplexityLimit,
    async (req, res) => {
      res.json(
        GetManualLibraryRevisionResponse.parse(
          await saveManualDraft(res.locals.manualEditor, uuid.parse(req.params.id), req.body),
        ),
      );
    },
  );
  router.post("/admin/manual-library/:id/actions", sameOriginMutation, async (req, res) => {
    res.json(
      GetManualLibraryRevisionResponse.parse(
        await actOnManualRevision(res.locals.manualEditor, uuid.parse(req.params.id), req.body),
      ),
    );
  });
  router.get("/admin/manual-library/:id/revisions/:version/file", async (req, res) => {
    sendManualFile(
      res,
      await privateManualFile(
        res.locals.manualEditor,
        uuid.parse(req.params.id),
        z.coerce.number().int().positive().parse(req.params.version),
      ),
    );
  });
  router.get("/account/manual-templates/:id/download", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    // This route serves only released free templates. Premium editions require a workspace purchase.
    const account = await authenticate(req);
    sendManualFile(res, await releasedManualFile(uuid.parse(req.params.id), account.identityId));
  });
  return router;
}
