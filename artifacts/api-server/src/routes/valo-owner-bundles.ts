import { Router, type Request } from "express";
import {
  ListOwnerBundlesResponse,
  PreviewOwnerBundleResponse,
  RecordOwnerBundleResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { verifiedStaffSession } from "./valo-customer-access";
import { ownerBundles, previewOwnerBundle, recordOwnerBundle } from "../modules/commerce";
import type { StaffActor } from "../modules/staff";

/**
 * The owner's bundles (docs/architecture/commercial-settings.md, slice 4b; ADM-006): each bundle's open and
 * scheduled versions and the premium templates a bundle may hold, a preview of a version's exact terms and
 * their checksum, and recording them. Only the recently verified development owner reaches the service.
 */
export function createOwnerBundleRouter(
  authenticate: (req: Request) => Promise<StaffActor> = verifiedStaffSession,
) {
  const router = Router();
  // The staff gate has already verified the session on Valo's own routes; a test router has none.
  const owner = async (req: Request, locals: Record<string, unknown>) =>
    (locals.verifiedStaff as StaffActor | undefined) ?? (await authenticate(req));
  router.use("/admin/owner-bundles", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/admin/owner-bundles", async (req, res) => {
    res.json(ListOwnerBundlesResponse.parse(await ownerBundles(await owner(req, res.locals))));
  });
  router.post("/admin/owner-bundles/previews", sameOriginMutation, async (req, res) => {
    res.json(
      PreviewOwnerBundleResponse.parse(await previewOwnerBundle(await owner(req, res.locals), req.body)),
    );
  });
  router.post("/admin/owner-bundles", sameOriginMutation, async (req, res) => {
    const recorded = await recordOwnerBundle(await owner(req, res.locals), req.body);
    req.log?.info({
      event: "bundle.recorded",
      bundleId: recorded.bundleId,
      closed: recorded.closed.length,
    });
    res.json(RecordOwnerBundleResponse.parse(recorded));
  });
  return router;
}
export const ownerBundleRouter = createOwnerBundleRouter();
