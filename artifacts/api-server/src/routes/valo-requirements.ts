import { Router } from "express";
import { z } from "zod";
import {
  ListCheckerRulesInUseResponse,
  PreviewAssessmentResponse,
  ListAssessmentsResponse,
  CreateAssessmentResponse,
  GetAssessmentResponse,
  ListTasksResponse,
  ListTasksPageResponse,
  CreateTaskResponse,
  UpdateTaskResponse,
  ListRemindersResponse,
  GetReminderPreferencesResponse,
  SaveReminderPreferencesResponse,
  CompareAssessmentsResponse,
} from "@workspace/api-zod";
import * as assessments from "../modules/rules";
import * as tasks from "../modules/tasks";
import { consumeQuota } from "../lib/valo-quota";
import { quotaSubjectHash } from "../lib/valo-quota-policy";
import { clientAddress } from "../lib/valo-proxy-boundary";
import { setting } from "../platform/settings";
const router = Router();
const id = (v: unknown) => z.string().uuid().parse(v);
router.post("/checker/preview", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const quota = await consumeQuota(
    "anonymous-read",
    quotaSubjectHash(setting("SESSION_SECRET"), "ip", clientAddress(req)),
  );
  if (!quota.allowed) {
    res.set("Retry-After", String(quota.retryAfter));
    res.status(429).json({
      code: "CHECKER_RATE_LIMIT",
      error:
        "Too many checks in a short time. Your answers are still on this page. Wait a moment and try again.",
    });
    return;
  }
  res.json(PreviewAssessmentResponse.parse(await assessments.previewAssessment(req.body)));
});
// The rules the check would use today, so that its page asks only their questions (RUL-001). It
// holds no customer data, and counts against the same per-visitor limit as a check.
router.get("/checker/questions", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  const quota = await consumeQuota(
    "anonymous-read",
    quotaSubjectHash(setting("SESSION_SECRET"), "ip", clientAddress(req)),
  );
  if (!quota.allowed) {
    res.set("Retry-After", String(quota.retryAfter));
    res.status(429).json({
      code: "CHECKER_RATE_LIMIT",
      error:
        "Too many checks in a short time. Your answers are still on this page. Wait a moment and try again.",
    });
    return;
  }
  res.json(ListCheckerRulesInUseResponse.parse(await assessments.listRulesInUse()));
});
// Mounted behind the shared verified-workspace and same-origin boundaries.
router.post("/workspace/checker/preview", async (req, res): Promise<void> => {
  res.set("Cache-Control", "private, no-store");
  const quota = await consumeQuota(
    "anonymous-read",
    quotaSubjectHash(setting("SESSION_SECRET"), "user", res.locals.valoActor.identityId),
  );
  if (!quota.allowed) {
    res.set("Retry-After", String(quota.retryAfter));
    res.status(429).json({
      code: "CHECKER_RATE_LIMIT",
      error:
        "Too many checks in a short time. Your answers are still on this page. Wait a moment and try again.",
    });
    return;
  }
  res.json(
    PreviewAssessmentResponse.parse(
      await assessments.previewWorkspaceAssessment(res.locals.valoActor, req.body),
    ),
  );
});
router.get("/workspace/assessments", async (_req, res): Promise<void> => {
  res.json(ListAssessmentsResponse.parse(await assessments.listAssessments(res.locals.valoActor)));
});
router.post("/workspace/assessments", async (req, res): Promise<void> => {
  res
    .status(201)
    .json(CreateAssessmentResponse.parse(await assessments.createAssessment(res.locals.valoActor, req.body)));
});
router.get("/workspace/assessments/:id", async (req, res): Promise<void> => {
  res.json(
    GetAssessmentResponse.parse(await assessments.getAssessment(res.locals.valoActor, id(req.params.id))),
  );
});
router.get("/workspace/assessments/:id/compare/:previousId", async (req, res): Promise<void> => {
  res.json(
    CompareAssessmentsResponse.parse(
      await assessments.compareAssessments(
        res.locals.valoActor,
        id(req.params.id),
        id(req.params.previousId),
      ),
    ),
  );
});
router.get("/workspace/tasks", async (_req, res): Promise<void> => {
  res.json(ListTasksResponse.parse(await tasks.listTasks(res.locals.valoActor)));
});
router.get("/workspace/tasks/page", async (req, res): Promise<void> => {
  res.json(ListTasksPageResponse.parse(await tasks.listTasksPage(res.locals.valoActor, req.query)));
});
router.post("/workspace/tasks", async (req, res): Promise<void> => {
  res.status(201).json(CreateTaskResponse.parse(await tasks.createTask(res.locals.valoActor, req.body)));
});
router.patch("/workspace/tasks/:id", async (req, res): Promise<void> => {
  res.json(
    UpdateTaskResponse.parse(await tasks.updateTask(res.locals.valoActor, id(req.params.id), req.body)),
  );
});
router.delete("/workspace/tasks/:id", async (req, res): Promise<void> => {
  await tasks.deleteTask(res.locals.valoActor, id(req.params.id), req.body);
  res.sendStatus(204);
});
router.get("/workspace/reminder-preferences", async (_req, res): Promise<void> => {
  res.json(GetReminderPreferencesResponse.parse(await tasks.getReminderPreferences(res.locals.valoActor)));
});
router.put("/workspace/reminder-preferences", async (req, res): Promise<void> => {
  res.json(
    SaveReminderPreferencesResponse.parse(
      await tasks.saveReminderPreferences(res.locals.valoActor, req.body),
    ),
  );
});
router.get("/workspace/reminders", async (_req, res): Promise<void> => {
  res.json(ListRemindersResponse.parse(await tasks.listReminders(res.locals.valoActor)));
});
export default router;
