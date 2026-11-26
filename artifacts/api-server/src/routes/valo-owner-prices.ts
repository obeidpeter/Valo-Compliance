import { Router, type Request } from "express";
import {
  ListOwnerPricesResponse,
  PreviewOwnerPriceResponse,
  RecordOwnerPriceResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { verifiedStaffSession } from "./valo-customer-access";
import { ownerPrices, previewOwnerPrice, recordOwnerPrice } from "../modules/commerce";
import type { StaffActor } from "../modules/staff";

/**
 * The owner's price screen (docs/architecture/commercial-settings.md, slice 1; ADM-006): the
 * published premium templates and their prices, a preview of a price's exact terms and their
 * checksum, and recording them. Only the recently verified development owner reaches the service.
 */
export function createOwnerPriceRouter(
  authenticate: (req: Request) => Promise<StaffActor> = verifiedStaffSession,
) {
  const router = Router();
  // The staff gate has already verified the session on Valo's own routes; a test router has none.
  const owner = async (req: Request, locals: Record<string, unknown>) =>
    (locals.verifiedStaff as StaffActor | undefined) ?? (await authenticate(req));
  router.use("/admin/owner-prices", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/admin/owner-prices", async (req, res) => {
    res.json(ListOwnerPricesResponse.parse(await ownerPrices(await owner(req, res.locals))));
  });
  router.post("/admin/owner-prices/previews", sameOriginMutation, async (req, res) => {
    res.json(
      PreviewOwnerPriceResponse.parse(await previewOwnerPrice(await owner(req, res.locals), req.body)),
    );
  });
  router.post("/admin/owner-prices", sameOriginMutation, async (req, res) => {
    const recorded = await recordOwnerPrice(await owner(req, res.locals), req.body);
    req.log?.info({ event: "price.recorded", priceId: recorded.priceId, closed: recorded.closed.length });
    res.json(RecordOwnerPriceResponse.parse(recorded));
  });
  return router;
}
export const ownerPriceRouter = createOwnerPriceRouter();
