import { Router, type Request } from "express";
import {
  ListOwnerSettingsResponse,
  PreviewOwnerSettingResponse,
  RecordOwnerSettingResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { verifiedStaffSession } from "./valo-customer-access";
import { ownerSettings, previewOwnerSetting, recordOwnerSetting } from "../modules/commerce";
import type { StaffActor } from "../modules/staff";

/**
 * The owner's commercial settings (docs/architecture/commercial-settings.md, slice 3; ADM-006): each
 * setting with its default and its values, a preview of a value's exact terms and their checksum, and
 * recording them. Only the recently verified development owner reaches the service.
 */
export function createOwnerSettingRouter(
  authenticate: (req: Request) => Promise<StaffActor> = verifiedStaffSession,
) {
  const router = Router();
  // The staff gate has already verified the session on Valo's own routes; a test router has none.
  const owner = async (req: Request, locals: Record<string, unknown>) =>
    (locals.verifiedStaff as StaffActor | undefined) ?? (await authenticate(req));
  router.use("/admin/owner-settings", (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/admin/owner-settings", async (req, res) => {
    res.json(ListOwnerSettingsResponse.parse(await ownerSettings(await owner(req, res.locals))));
  });
  router.post("/admin/owner-settings/previews", sameOriginMutation, async (req, res) => {
    res.json(
      PreviewOwnerSettingResponse.parse(await previewOwnerSetting(await owner(req, res.locals), req.body)),
    );
  });
  router.post("/admin/owner-settings", sameOriginMutation, async (req, res) => {
    const recorded = await recordOwnerSetting(await owner(req, res.locals), req.body);
    req.log?.info({
      event: "commercial_setting.recorded",
      settingId: recorded.settingId,
      key: recorded.key,
      closed: recorded.closed.length,
    });
    res.json(RecordOwnerSettingResponse.parse(recorded));
  });
  return router;
}
export const ownerSettingRouter = createOwnerSettingRouter();
