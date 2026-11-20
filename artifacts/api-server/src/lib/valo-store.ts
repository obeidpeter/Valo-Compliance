import { randomUUID } from "node:crypto";
import type { db } from "@workspace/db";
import { ticketInput } from "./valo-validation";
import {
  authorizeWorkspaceWrite,
  limitWorkspaceWrite,
  recordWorkspaceEvent,
  type WorkspaceActor,
} from "../modules/workspaces";
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export async function createTicket(actor: WorkspaceActor, raw: unknown) {
  const { db } = await import("@workspace/db");
  return db.transaction((tx) => createTicketInTransaction(tx, actor, raw));
}
/** Shared transaction lets a privacy request and its support reference commit together. */
export async function createTicketInTransaction(tx: Tx, actor: WorkspaceActor, raw: unknown) {
  const { valoSupportTickets } = await import("@workspace/db");
  const input = ticketInput.parse(raw);
  const id = randomUUID();
  await authorizeWorkspaceWrite(tx, actor);
  await limitWorkspaceWrite(tx, actor, "support");
  await tx.insert(valoSupportTickets).values({
    id,
    workspaceId: actor.workspaceId,
    ...input,
    consentVersion: "service-sharing-v1",
    dispatchStatus: "awaiting_staff",
  });
  const { openSupportCase } = await import("./valo-support-intake");
  await openSupportCase(tx, "workspace", id, actor.workspaceId);
  await recordWorkspaceEvent(tx, actor, "support.ticket_saved", id);
  return {
    reference: `VALO-${id}`,
    message:
      "Enquiry received and saved. Awaiting staff review; no appointment or external dispatch has been confirmed.",
    dispatchStatus: "awaiting_staff" as const,
  };
}
