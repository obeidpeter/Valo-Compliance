import { Router, type Request } from "express";
import {
  GetStaffRoleAdministrationResponse,
  VerifyStaffRoleTargetResponse,
  ChangeStaffRoleResponse,
  GetAuditHistoryResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { auditHistory, staffRoleService, type makeStaffRoleService } from "../modules/staff";
import type { StaffActor } from "../modules/staff";
export function createStaffRoleRouter(
  authenticate: (req: Request) => Promise<StaffActor>,
  service: ReturnType<typeof makeStaffRoleService> = staffRoleService,
) {
  const r = Router();
  r.use(["/admin/staff-roles", "/admin/staff-role-target", "/admin/audit-history"], (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  r.get("/admin/staff-roles", async (req, res) =>
    res.json(
      GetStaffRoleAdministrationResponse.parse(await service.list(await authenticate(req), req.query)),
    ),
  );
  r.post("/admin/staff-role-target", sameOriginMutation, async (req, res) =>
    res.json(VerifyStaffRoleTargetResponse.parse(await service.target(await authenticate(req), req.body))),
  );
  r.post("/admin/staff-roles", sameOriginMutation, async (req, res) => {
    const receipt = await service.change(await authenticate(req), req.body);
    req.log?.warn({
      event: "staff.role_changed",
      auditId: receipt.id,
      action: receipt.action,
      role: receipt.role,
    });
    res.json(ChangeStaffRoleResponse.parse(receipt));
  });
  // ADM-009: the histories no other staff screen shows, for permanent system operators.
  r.get("/admin/audit-history", async (req, res) =>
    res.json(GetAuditHistoryResponse.parse(await auditHistory(await authenticate(req), req.query))),
  );
  return r;
}
