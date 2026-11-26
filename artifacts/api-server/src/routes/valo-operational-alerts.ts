import { Router, type Request } from "express";
import { GetOperationalAlertsResponse } from "@workspace/api-zod";
import { operationalAlerts } from "../modules/operations";
import type { StaffActor } from "../modules/staff";

/**
 * SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): the alerts the worker raised and cleared, for
 * the system operators who answer them.
 */
export function createOperationalAlertsRouter(authenticate: (req: Request) => Promise<StaffActor>) {
  const r = Router();
  r.get("/admin/operations/alerts", async (req, res) => {
    res.set("Cache-Control", "private, no-store");
    res.json(GetOperationalAlertsResponse.parse(await operationalAlerts(await authenticate(req))));
  });
  return r;
}
