import { Router } from "express";
import { z } from "zod";
import { AcceptCustomerAIDraftResponse } from "@workspace/api-zod";
import {
  createCustomerAIDraft,
  getCustomerAIDraft,
  acceptCustomerAIDraft,
  customerAIUsage,
} from "../lib/valo-customer-ai";
import { consumeQuota } from "../lib/valo-quota";
import { quotaSubjectHash } from "../lib/valo-quota-policy";
const router = Router();
router.get("/workspace/ai-usage", async (_req, res) => {
  res.json(await customerAIUsage(res.locals.valoActor));
});
router.post("/workspace/ai-drafts", async (req, res): Promise<void> => {
  const quota = await consumeQuota(
    "customer-ai",
    quotaSubjectHash(process.env.SESSION_SECRET, "user", res.locals.valoActor.identityId),
  );
  if (!quota.allowed) {
    res.set("Retry-After", String(quota.retryAfter));
    res.status(429).json({
      code: "AI_RATE_LIMIT",
      error: "AI request limit reached. Wait for Retry-After or continue in the independent manual editor.",
    });
    return;
  }
  res.json(await createCustomerAIDraft(res.locals.valoActor, req.body));
});
router.get("/workspace/ai-drafts/:id", async (req, res) => {
  res.json(await getCustomerAIDraft(res.locals.valoActor, z.string().uuid().parse(req.params.id)));
});
router.post("/workspace/ai-drafts/:id/accept", async (req, res) => {
  res
    .status(201)
    .json(
      AcceptCustomerAIDraftResponse.parse(
        await acceptCustomerAIDraft(res.locals.valoActor, z.string().uuid().parse(req.params.id), req.body),
      ),
    );
});
export default router;
