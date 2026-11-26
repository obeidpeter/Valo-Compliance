import { useListPrivacyHolds, usePlacePrivacyHold, useReleasePrivacyHold } from "@workspace/api-client-react";
import { ErrorState } from "@/components/states";
import { formatDateTime } from "@/lib/format";

/** What staff have typed into the holds section and not sent. The screen keeps it, so that leaving
 * the page asks first. */
export type HoldDraft = {
  workspaceId: string;
  reason: string;
  releasing: string | null;
  releaseReason: string;
};
export const emptyHoldDraft: HoldDraft = { workspaceId: "", reason: "", releasing: null, releaseReason: "" };
export const holdDraftDirty = (draft: HoldDraft) =>
  !!draft.workspaceId.trim() || !!draft.reason.trim() || !!draft.releaseReason.trim();

const by = (you: boolean) => (you ? "by you" : "by another member of privacy staff");

/**
 * Holds of their own on workspaces, apart from any request (PRV-003; docs/architecture/privacy-requests.md,
 * slice 4). Privacy staff place one with a reason; another member of privacy staff releases it with one.
 */
export function PrivacyHolds({
  draft,
  onDraft,
  openedWorkspace,
  onChanged,
}: {
  draft: HoldDraft;
  onDraft: (draft: HoldDraft) => void;
  /** The workspace of the request open on the screen, which staff may hold in one step. */
  openedWorkspace: string | null;
  /** Called once a hold is placed or released, so the open request shows it. */
  onChanged: () => Promise<unknown>;
}) {
  const holds = useListPrivacyHolds({
    query: { retry: false, refetchOnWindowFocus: !holdDraftDirty(draft) },
  });
  const place = usePlacePrivacyHold({
    mutation: {
      onSuccess: async () => {
        onDraft({ ...draft, workspaceId: "", reason: "" });
        await Promise.all([holds.refetch(), onChanged()]);
      },
    },
  });
  const release = useReleasePrivacyHold({
    mutation: {
      onSuccess: async () => {
        onDraft({ ...draft, releasing: null, releaseReason: "" });
        await Promise.all([holds.refetch(), onChanged()]);
      },
    },
  });
  const busy = place.isPending || release.isPending;
  const workspaceId = draft.workspaceId.trim(),
    reason = draft.reason.trim(),
    releaseReason = draft.releaseReason.trim();
  return (
    <section className="surface mt-8 grid gap-4 p-5 sm:p-7" aria-labelledby="privacy-holds-heading">
      <h2 id="privacy-holds-heading" className="font-display text-2xl">
        Holds on workspaces
      </h2>
      <p className="text-sm text-muted-foreground" data-testid="text-privacy-holds-explained">
        A hold stands apart from any request. While it stands, Valo's own deletion of the workspace's data
        stops: an erasure does not start or continue, and its old downloads are not removed. The person's own
        changes in their workspace go on. The person whose workspace is held is not shown the reason. Another
        member of privacy staff releases a hold you place.
      </p>
      {holds.isLoading && <p role="status">Loading the holds…</p>}
      {holds.isError && <ErrorState error={holds.error} onRetry={() => holds.refetch()} />}
      {holds.data && !holds.data.ready && (
        <p className="text-sm" data-testid="text-privacy-holds-waiting">
          Holds cannot be placed yet: a database update is waiting to be applied. Until it is, no workspace is
          held.
        </p>
      )}
      {holds.data?.ready && (
        <>
          {holds.data.items.length === 0 && <p className="text-sm">No workspace has been held.</p>}
          {holds.data.items.length > 0 && (
            <ul className="grid gap-3" aria-label="Holds" data-testid="list-privacy-holds">
              {holds.data.items.map((hold) => (
                <li key={hold.id} className="min-w-0 rounded-xl border border-border p-4 text-sm">
                  <p className="break-words">
                    <strong>{hold.released ? "Released" : "Standing"}</strong> · workspace {hold.workspaceId}
                  </p>
                  <p className="mt-1">
                    Placed {formatDateTime(hold.placedAt)} {by(hold.placedByYou)}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap break-words">{hold.reason}</p>
                  {hold.released && hold.releasedAt && (
                    <>
                      <p className="mt-2">
                        Released {formatDateTime(hold.releasedAt)} {by(hold.releasedByYou)}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap break-words">{hold.releaseReason}</p>
                    </>
                  )}
                  {!hold.released && hold.placedByYou && (
                    <p className="mt-2 text-muted-foreground">
                      Another member of privacy staff releases a hold you placed.
                    </p>
                  )}
                  {!hold.released && !hold.placedByYou && draft.releasing !== hold.id && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm mt-3"
                      disabled={busy}
                      onClick={() => onDraft({ ...draft, releasing: hold.id, releaseReason: "" })}
                      data-testid={`button-privacy-hold-release-${hold.id}`}
                    >
                      Release this hold
                    </button>
                  )}
                  {!hold.released && !hold.placedByYou && draft.releasing === hold.id && (
                    <form
                      className="mt-3 grid gap-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (releaseReason.length < 10 || busy) return;
                        release.mutate({ id: hold.id, data: { reason: releaseReason } });
                      }}
                    >
                      <label className="grid gap-2">
                        Why it is released
                        <textarea
                          className="field min-h-24"
                          value={draft.releaseReason}
                          onChange={(e) => onDraft({ ...draft, releaseReason: e.target.value })}
                          minLength={10}
                          maxLength={1000}
                          disabled={busy}
                          data-testid="input-privacy-hold-release-reason"
                        />
                      </label>
                      <p className="rounded-xl bg-secondary p-3">
                        Once released, Valo's own deletion of this workspace's data goes on where it stopped.
                      </p>
                      {release.isError && <ErrorState error={release.error} />}
                      <div className="flex flex-wrap gap-3">
                        <button
                          type="submit"
                          className="btn btn-primary btn-sm"
                          disabled={releaseReason.length < 10 || busy}
                        >
                          {release.isPending ? "Releasing…" : "Release the hold"}
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={busy}
                          onClick={() => {
                            onDraft({ ...draft, releasing: null, releaseReason: "" });
                            release.reset();
                          }}
                        >
                          Keep it standing
                        </button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-3 text-sm"
            aria-labelledby="privacy-hold-place-heading"
            onSubmit={(e) => {
              e.preventDefault();
              if (!workspaceId || reason.length < 10 || busy) return;
              place.mutate({ data: { workspaceId, reason } });
            }}
          >
            <h3 id="privacy-hold-place-heading" className="font-medium">
              Hold a workspace
            </h3>
            <label className="grid gap-2">
              Workspace ID
              <input
                className="field"
                value={draft.workspaceId}
                onChange={(e) => onDraft({ ...draft, workspaceId: e.target.value })}
                disabled={busy}
                autoComplete="off"
                data-testid="input-privacy-hold-workspace"
              />
            </label>
            {openedWorkspace && draft.workspaceId.trim() !== openedWorkspace && (
              <button
                type="button"
                className="btn btn-ghost btn-sm justify-self-start"
                disabled={busy}
                onClick={() => onDraft({ ...draft, workspaceId: openedWorkspace })}
              >
                Use the open request's workspace
              </button>
            )}
            <label className="grid gap-2">
              Why it is held
              <textarea
                className="field min-h-24"
                value={draft.reason}
                onChange={(e) => onDraft({ ...draft, reason: e.target.value })}
                minLength={10}
                maxLength={1000}
                disabled={busy}
                data-testid="input-privacy-hold-reason"
              />
            </label>
            <p className="rounded-xl bg-secondary p-3">
              Only privacy staff read this reason. The person whose workspace is held is not shown it.
            </p>
            {place.isError && <ErrorState error={place.error} />}
            <button
              type="submit"
              className="btn btn-primary btn-sm justify-self-start"
              disabled={!workspaceId || reason.length < 10 || busy}
            >
              {place.isPending ? "Placing the hold…" : "Place the hold"}
            </button>
          </form>
        </>
      )}
    </section>
  );
}
