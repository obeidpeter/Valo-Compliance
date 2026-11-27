import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import {
  bindCustomerCase,
  createCustomerAIDraft,
  organizeCustomerDraft,
  rubricFollowup,
  type CustomerPreview,
  type CustomerRun,
  type CustomerRunOutcome,
  type RubricCase,
} from "../modules/ai-lanes";
import type { WorkspaceActor } from "../modules/workspaces";

/**
 * How the customer AI suite and its database test give a drafting case to the app, as its rubric
 * declares (docs/architecture/drafting-rubric.md): the case's input, with the rubric's follow-up, goes
 * to the app's own drafting service, and what the app did is read back as the rubric scores it. A stop
 * never reaches `organize`; an ordinary case reaches it only when the app's own checks allow.
 * Development and tests only: it reads the kept draft as stored, in the actor's workspace.
 */
export type CaseOrganizer = typeof organizeCustomerDraft;

/** The draft the app kept, and the actions it recorded for it, as the rubric reads them. */
export async function keptCustomerDraft(actor: WorkspaceActor, id: string) {
  const { db, valoAIDrafts, valoEvents } = await import("@workspace/db");
  const [row] = await db
    .select()
    .from(valoAIDrafts)
    .where(and(eq(valoAIDrafts.workspaceId, actor.workspaceId), eq(valoAIDrafts.id, id)));
  if (!row) throw Error("KEPT_DRAFT_NOT_FOUND");
  const events = await db
    .select({ action: valoEvents.action })
    .from(valoEvents)
    .where(and(eq(valoEvents.workspaceId, actor.workspaceId), eq(valoEvents.entityId, id)));
  return {
    draft: {
      id: row.id,
      status: row.status,
      preview: row.preview as CustomerPreview,
      plan: row.plan as never,
      providerCalls: row.providerCalls ?? 0,
      providerInputHash: row.providerInputHash,
      inputHash: row.inputHash,
      acceptedDocumentId: row.acceptedDocumentId,
    },
    events: events.map((event) => event.action),
  };
}

/**
 * Gives one case to the app and returns the run the rubric scores, with every routine line written to
 * the process's output meanwhile and the actions recorded for the draft.
 */
export async function runCustomerRubricCase(
  actor: WorkspaceActor,
  c: RubricCase,
  options: { organize?: CaseOrganizer; idempotencyKey?: string } = {},
): Promise<CustomerRun> {
  const followup = rubricFollowup(c),
    bound = bindCustomerCase(c, followup);
  const logged: string[] = [];
  const out = process.stdout.write.bind(process.stdout),
    err = process.stderr.write.bind(process.stderr);
  const capture =
    (write: typeof out) =>
    (chunk: unknown, ...rest: unknown[]) => {
      logged.push(String(chunk));
      return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
    };
  const refuse: CaseOrganizer = async () => {
    throw Error("A_STOPPED_CASE_REACHED_THE_ORGANIZER");
  };
  let outcome: CustomerRunOutcome;
  process.stdout.write = capture(out) as typeof process.stdout.write;
  process.stderr.write = capture(err) as typeof process.stderr.write;
  try {
    if (!bound.input) {
      try {
        await createCustomerAIDraft(actor, bound.submitted, refuse);
        throw Error("AN_INPUT_THE_APP_REFUSES_WAS_KEPT");
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        outcome = {
          kind: "refused",
          issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
        };
      }
    } else {
      const preview = await createCustomerAIDraft(
        actor,
        { ...bound.input, idempotencyKey: options.idempotencyKey ?? randomUUID() },
        options.organize ?? refuse,
      );
      const kept = await keptCustomerDraft(actor, preview.id);
      logged.push(...kept.events);
      outcome = { kind: "stored", ...kept };
    }
  } finally {
    process.stdout.write = out as typeof process.stdout.write;
    process.stderr.write = err as typeof process.stderr.write;
  }
  return { followup, outcome: { ...outcome, telemetry: logged } };
}
