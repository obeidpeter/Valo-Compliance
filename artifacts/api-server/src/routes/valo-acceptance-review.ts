import { Router, type Request } from "express";
import {
  ListAcceptanceCasesResponse,
  ListAcceptanceRunResponse,
  RecordAcceptanceDecisionResponse,
  RecordAcceptanceRunDecisionResponse,
} from "@workspace/api-zod";
import { sameOriginMutation } from "../middlewares/valo-identity";
import { verifiedStaffSession } from "../lib/valo-managed-session";
import {
  listAcceptanceCases,
  listAcceptanceRun,
  recordAcceptanceDecision,
  recordAcceptanceRunDecision,
} from "../modules/acceptance-review";
import type { StaffActor } from "../modules/staff";

/**
 * The reviewer's record (decision 0016, docs/architecture/reviewer-record.md): an active reviewer reads
 * a corpus's acceptance cases and records a decision on one. Nothing here accepts a case or a requirement.
 */
export function createAcceptanceReviewRouter(
  authenticate: (req: Request) => Promise<StaffActor> = verifiedStaffSession,
) {
  const router = Router();
  router.use(["/admin/acceptance-cases", "/admin/acceptance-runs"], (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get("/admin/acceptance-cases", async (req, res) => {
    res.json(
      ListAcceptanceCasesResponse.parse(await listAcceptanceCases(await authenticate(req), req.query.corpus)),
    );
  });
  router.post("/admin/acceptance-cases/decisions", sameOriginMutation, async (req, res) => {
    res
      .status(201)
      .json(
        RecordAcceptanceDecisionResponse.parse(
          await recordAcceptanceDecision(await authenticate(req), req.body),
        ),
      );
  });
  // Runs kept for a reviewer (docs/architecture/reviewer-record.md, slice 2).
  router.get("/admin/acceptance-runs", async (req, res) => {
    res.json(
      ListAcceptanceRunResponse.parse(await listAcceptanceRun(await authenticate(req), req.query.corpus)),
    );
  });
  router.post("/admin/acceptance-runs/decisions", sameOriginMutation, async (req, res) => {
    res
      .status(201)
      .json(
        RecordAcceptanceRunDecisionResponse.parse(
          await recordAcceptanceRunDecision(await authenticate(req), req.body),
        ),
      );
  });
  return router;
}
export const acceptanceReviewRouter = createAcceptanceReviewRouter();
