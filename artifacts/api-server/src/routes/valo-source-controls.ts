import { Router, type Request } from "express";
import { z } from "zod";
import {
  GetSourceControlsResponse,
  ActOnSourceControlsResponse,
  GetCorrectionNoticesResponse,
  GetEditorialRecordParams,
  GetEditorialRecordResponse,
  ListOwnerRulesResponse,
  WatchOwnerRuleSourcesParams,
  WatchOwnerRuleSourcesResponse,
  DecideOwnerRuleResponse,
  ListSourceRegisterResponse,
  AddSourceRegisterEntryResponse,
  FileSourceRegisterResponse,
  ReviseSourceRegisterEntryParams,
  ReviseSourceRegisterEntryResponse,
  ListSourceReviewResponse,
  NoteSourceReviewParams,
  NoteSourceReviewResponse,
  PrepareSourceReviewParams,
  PrepareSourceReviewResponse,
  ListOwnerReviewWorkResponse,
  NoteOwnerReviewWorkParams,
  NoteOwnerReviewWorkResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { verifiedStaffSession } from "./valo-customer-access";
import {
  sourceControls,
  actOnSourceControls,
  correctionNotices,
  listSourceReview,
  noteSourceReview,
  type SourceStaffActor,
} from "../modules/sources";
import {
  decideOwnerRule,
  listOwnerReviewWork,
  listOwnerRules,
  noteOwnerReviewWork,
  requestReviewPreparation,
  reviewPreparable,
  watchOwnerRuleSources,
} from "../modules/editorial";
import {
  addSourceEntry,
  fileRepositorySources,
  listSourceRegister,
  reviseSourceEntry,
} from "../modules/source-register";
import { editorialRecord } from "../lib/valo-editorial-record";
import { ValoProblem } from "../platform/valo-problem";
const page = (value: unknown) => z.coerce.number().int().min(1).max(10000).default(1).parse(value);
/** A prepared rule's name from the path; a malformed one names no rule, whoever asks. */
const ownerRuleId = (params: unknown) => {
  const parsed = WatchOwnerRuleSourcesParams.safeParse(params);
  if (!parsed.success) throw new ValoProblem(404, "There is no rule prepared under that name.");
  return parsed.data.ruleId;
};
export function createSourceControlsRouter(
  authenticate: (req: Request) => Promise<SourceStaffActor> = verifiedStaffSession,
) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/admin/source-controls", async (req, res) => {
    const actor = await authenticate(req),
      area = z.enum(["content", "system"]).parse(req.query.area);
    res.json(GetSourceControlsResponse.parse(await sourceControls(actor, area, page(req.query.page))));
  });
  router.get("/admin/editorial-records/:kind/:id", async (req, res) => {
    const actor = await authenticate(req);
    // A malformed kind or id names no version, whoever asks.
    const params = GetEditorialRecordParams.safeParse(req.params);
    if (!params.success) throw new ValoProblem(404, "No such version.");
    res.json(
      GetEditorialRecordResponse.parse(await editorialRecord(actor, params.data.kind, params.data.id)),
    );
  });
  router.post("/admin/source-controls/action", sameOriginMutation, async (req, res) => {
    res.json(ActOnSourceControlsResponse.parse(await actOnSourceControls(await authenticate(req), req.body)));
  });
  // The source register (docs/architecture/source-register.md, slices 1 and 2).
  router.get("/admin/source-register", async (req, res) => {
    res.json(ListSourceRegisterResponse.parse(await listSourceRegister(await authenticate(req))));
  });
  router.post("/admin/source-register", sameOriginMutation, async (req, res) => {
    res.json(AddSourceRegisterEntryResponse.parse(await addSourceEntry(await authenticate(req), req.body)));
  });
  router.post("/admin/source-register/file", sameOriginMutation, async (req, res) => {
    res.json(FileSourceRegisterResponse.parse(await fileRepositorySources(await authenticate(req))));
  });
  router.post("/admin/source-register/:sourceId/versions", sameOriginMutation, async (req, res) => {
    const actor = await authenticate(req);
    // A malformed name names no source, whoever asks.
    const params = ReviseSourceRegisterEntryParams.safeParse(req.params);
    if (!params.success) throw new ValoProblem(404, "This source is not in the register.");
    res.json(
      ReviseSourceRegisterEntryResponse.parse(await reviseSourceEntry(actor, params.data.sourceId, req.body)),
    );
  });
  // Review work with its owner (docs/architecture/source-register.md, slice 3), and a candidate prepared
  // from it (slice 4). The queue marks the rows a preparer can run on.
  const preparable = { preparable: reviewPreparable };
  router.get("/admin/source-review", async (req, res) => {
    res.json(ListSourceReviewResponse.parse(await listSourceReview(await authenticate(req), preparable)));
  });
  router.post("/admin/source-review/:workId/notes", sameOriginMutation, async (req, res) => {
    const actor = await authenticate(req);
    // A malformed id names no review work, whoever asks.
    const params = NoteSourceReviewParams.safeParse(req.params);
    if (!params.success) throw new ValoProblem(404, "This review work is not in the queue.");
    res.json(
      NoteSourceReviewResponse.parse(await noteSourceReview(actor, params.data.workId, req.body, preparable)),
    );
  });
  router.post("/admin/source-review/:workId/prepare", sameOriginMutation, async (req, res) => {
    const actor = await authenticate(req);
    const params = PrepareSourceReviewParams.safeParse(req.params);
    if (!params.success) throw new ValoProblem(404, "This review work is not in the queue.");
    res
      .status(202)
      .json(PrepareSourceReviewResponse.parse(await requestReviewPreparation(actor, params.data.workId)));
  });
  // Requirements-checker rules on the development owner's sign-off (decision 0020).
  const owner = (req: Request, locals: Record<string, unknown>) =>
    (locals.verifiedStaff as SourceStaffActor | undefined) ?? authenticate(req);
  router.get("/admin/owner-rules/review-work", async (req, res) => {
    res.json(ListOwnerReviewWorkResponse.parse(await listOwnerReviewWork(await owner(req, res.locals))));
  });
  router.post("/admin/owner-rules/review-work/:workId/notes", sameOriginMutation, async (req, res) => {
    const actor = await owner(req, res.locals);
    const params = NoteOwnerReviewWorkParams.safeParse(req.params);
    if (!params.success) throw new ValoProblem(404, "This review work is not on a rule you signed.");
    res.json(
      NoteOwnerReviewWorkResponse.parse(await noteOwnerReviewWork(actor, params.data.workId, req.body)),
    );
  });
  router.get("/admin/owner-rules", async (req, res) => {
    res.json(ListOwnerRulesResponse.parse(await listOwnerRules(await owner(req, res.locals))));
  });
  router.post("/admin/owner-rules/:ruleId/source-watches", sameOriginMutation, async (req, res) => {
    const actor = await owner(req, res.locals);
    res.json(
      WatchOwnerRuleSourcesResponse.parse(
        await watchOwnerRuleSources(actor, ownerRuleId(req.params), req.body),
      ),
    );
  });
  router.post("/admin/owner-rules/:ruleId/decisions", sameOriginMutation, async (req, res) => {
    const actor = await owner(req, res.locals);
    res.json(DecideOwnerRuleResponse.parse(await decideOwnerRule(actor, ownerRuleId(req.params), req.body)));
  });
  return router;
}
export const sourceControlsRouter = createSourceControlsRouter();
export const correctionNoticesRouter = Router();
correctionNoticesRouter.get("/workspace/correction-notices", async (req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(
    GetCorrectionNoticesResponse.parse(await correctionNotices(res.locals.valoActor, page(req.query.page))),
  );
});
