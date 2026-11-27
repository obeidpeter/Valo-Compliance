import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { valoMessages, type db } from "@workspace/db";
import { MESSAGE_KINDS, type MessageKind } from "./message-policy";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Whether the messages migration has reached this database: whether `valo_messages` is there, by the name a
 * query would find it under. The Replit development database is given each migration by hand, so this code
 * can run before the table exists. Until it does, no message is owed, sent, listed or removed, and
 * everything else carries on.
 */
export async function messagesReady(tx: Pick<Tx, "execute">) {
  const [table] = (
    await tx.execute<{ present: boolean }>(sql`select to_regclass('valo_messages') is not null as present`)
  ).rows;
  return table?.present === true;
}

/**
 * Records that a message is owed, in the transaction of the event that owes it, so the message exists
 * exactly when the event does (docs/architecture/messages.md, part 1). A record owes one message of each
 * kind: a replayed event adds none. Nothing is sent here; the dispatcher sends it, and checks again then
 * whatever could stop it.
 *
 * Returns whether the message is recorded. In a database the messages migration has not reached it is not,
 * and the event goes on without it: a payment still settles, and its receipt is on the purchases screen.
 */
export async function queueMessage(
  tx: Pick<Tx, "insert" | "execute">,
  message: { workspaceId: string; kind: MessageKind; recipientIdentityId: string; subjectId: string },
) {
  if (!(await messagesReady(tx))) return false;
  await tx
    .insert(valoMessages)
    .values({ id: randomUUID(), ...message, class: MESSAGE_KINDS[message.kind] })
    .onConflictDoNothing();
  return true;
}
