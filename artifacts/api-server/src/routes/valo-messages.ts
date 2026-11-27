import { Router } from "express";
import { ListWorkspaceMessagesResponse } from "@workspace/api-zod";
import { listWorkspaceMessages } from "../modules/messages";

/** The workspace's delivery log (docs/architecture/messages.md, part 1). */
export const messagesRouter = Router();
messagesRouter.get("/workspace/messages", async (_req, res) => {
  res.set("Cache-Control", "private, no-store");
  res.json(ListWorkspaceMessagesResponse.parse(await listWorkspaceMessages(res.locals.valoActor)));
});
