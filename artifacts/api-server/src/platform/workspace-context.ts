/**
 * The workspace a request or background job acts in.
 *
 * A WorkspaceActor cannot be written as an object literal. It is issued only by:
 * - `workspaceActorFromMembership`, which `resolveWorkspace` calls after reading the
 *   verified identity's server-side membership; and
 * - `workspaceActorFromRecord`, for background work, operator commands and tests that
 *   act for a requester stored with the work (exports, reminders, privacy processing).
 *   Every read and write still re-checks that membership in the database.
 *
 * HTTP code may use neither constructor, may not cast to WorkspaceActor and may not
 * write a `workspaceId` in an object literal (repository rule "workspace-actor"). So a
 * workspace named by the browser can never become the workspace a request acts in.
 *
 * The brand exists only in types; at runtime an actor is a plain object.
 */
declare const serverIssued: unique symbol;

export type WorkspaceActor = {
  readonly workspaceId: string;
  readonly identityId: string;
  readonly [serverIssued]: true;
};

type ActorRecord = { readonly workspaceId: string; readonly identityId: string };

function issue(record: ActorRecord): WorkspaceActor {
  return { workspaceId: record.workspaceId, identityId: record.identityId } as WorkspaceActor;
}

/** For `resolveWorkspace` only: the membership it just read for the verified identity. */
export function workspaceActorFromMembership(membership: ActorRecord): WorkspaceActor {
  return issue(membership);
}

/** For work acting for a requester stored with it. Never for HTTP code. */
export function workspaceActorFromRecord(record: ActorRecord): WorkspaceActor {
  return issue(record);
}
