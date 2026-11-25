import { Router, type Request } from "express";
import {
  ListCustomerSupportCasesQueryParams,
  ListCustomerSupportCasesResponse,
  GetCustomerSupportCaseParams,
  GetCustomerSupportCaseQueryParams,
  GetCustomerSupportCaseResponse,
  ReplyToSupportCaseParams,
  ReplyToSupportCaseResponse,
  ListStaffSupportCasesQueryParams,
  ListStaffSupportCasesResponse,
  ListSupportAssigneesResponse,
  GetStaffSupportCaseParams,
  GetStaffSupportCaseQueryParams,
  GetStaffSupportCaseResponse,
  ActOnSupportCaseParams,
  ActOnSupportCaseResponse,
  ListContentEscalationsQueryParams,
  ListContentEscalationsResponse,
  ActOnContentEscalationParams,
  ActOnContentEscalationResponse,
  FindSupportLibraryEntriesQueryParams,
  FindSupportLibraryEntriesResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { verifiedStaffSession } from "./valo-customer-access";
import {
  customerSupportCases,
  customerSupportCase,
  replyToSupportCase,
  staffSupportCases,
  staffSupportCase,
  supportAssignees,
  actOnSupportCase,
  contentSupportEscalations,
  actOnContentSupportEscalation,
  supportLibraryEntries,
  type SupportStaffActor,
} from "../modules/support";

// Responses are parsed with the contract's schemas, so a customer reply can never carry
// the staff-only fields (assignment, internal events, content referrals).
export const supportCustomerRouter = Router();
supportCustomerRouter.use("/workspace/support-cases", (_req, res, next) => {
  res.set("Cache-Control", "private, no-store");
  next();
});
supportCustomerRouter.get("/workspace/support-cases", async (req, res) => {
  const { page } = ListCustomerSupportCasesQueryParams.parse(req.query);
  res.json(ListCustomerSupportCasesResponse.parse(await customerSupportCases(res.locals.valoActor, page)));
});
supportCustomerRouter.get("/workspace/support-cases/:id", async (req, res) => {
  const { id } = GetCustomerSupportCaseParams.parse(req.params),
    { messagesPage } = GetCustomerSupportCaseQueryParams.parse(req.query);
  res.json(
    GetCustomerSupportCaseResponse.parse(await customerSupportCase(res.locals.valoActor, id, messagesPage)),
  );
});
supportCustomerRouter.post("/workspace/support-cases/:id/reply", sameOriginMutation, async (req, res) => {
  const { id } = ReplyToSupportCaseParams.parse(req.params);
  res.json(ReplyToSupportCaseResponse.parse(await replyToSupportCase(res.locals.valoActor, id, req.body)));
});

/** Staff routes. Mount after the staff gate; each operation still checks its own area
 * role, assignment currency and recent MFA. */
export function makeSupportOperationsRouter(
  authenticate: (req: Request) => Promise<SupportStaffActor> = verifiedStaffSession,
) {
  const router = Router();
  router.use(
    ["/admin/support-cases", "/admin/support-escalations", "/admin/support-library-entries"],
    (_req, res, next) => {
      res.set("Cache-Control", "private, no-store");
      next();
    },
  );
  router.get("/admin/support-escalations", async (req, res) => {
    const actor = await authenticate(req),
      { page } = ListContentEscalationsQueryParams.parse(req.query);
    res.json(ListContentEscalationsResponse.parse(await contentSupportEscalations(actor, page)));
  });
  router.post("/admin/support-escalations/:id/action", sameOriginMutation, async (req, res) => {
    const actor = await authenticate(req),
      { id } = ActOnContentEscalationParams.parse(req.params);
    res.json(ActOnContentEscalationResponse.parse(await actOnContentSupportEscalation(actor, id, req.body)));
  });
  // The published staff-library entries a referral can point at, found by title.
  router.get("/admin/support-library-entries", async (req, res) => {
    const actor = await authenticate(req),
      { q } = FindSupportLibraryEntriesQueryParams.parse(req.query);
    res.json(FindSupportLibraryEntriesResponse.parse(await supportLibraryEntries(actor, q)));
  });
  router.get("/admin/support-cases", async (req, res) => {
    const actor = await authenticate(req),
      { status, page } = ListStaffSupportCasesQueryParams.parse(req.query);
    res.json(ListStaffSupportCasesResponse.parse(await staffSupportCases(actor, status, page)));
  });
  router.get("/admin/support-cases/assignees", async (req, res) => {
    res.json(ListSupportAssigneesResponse.parse(await supportAssignees(await authenticate(req))));
  });
  router.get("/admin/support-cases/:id", async (req, res) => {
    const actor = await authenticate(req),
      { id } = GetStaffSupportCaseParams.parse(req.params),
      { messagesPage } = GetStaffSupportCaseQueryParams.parse(req.query);
    res.json(GetStaffSupportCaseResponse.parse(await staffSupportCase(actor, id, messagesPage)));
  });
  router.post("/admin/support-cases/:id/action", sameOriginMutation, async (req, res) => {
    const actor = await authenticate(req),
      { id } = ActOnSupportCaseParams.parse(req.params);
    res.json(ActOnSupportCaseResponse.parse(await actOnSupportCase(actor, id, req.body)));
  });
  return router;
}
export const supportOperationsRouter = makeSupportOperationsRouter();
