import { useRef, useState } from "react";
import {
  useGetSourceControls,
  useActOnSourceControls,
  type SourceControlAction,
} from "@workspace/api-client-react";
import { ErrorState, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatDateTime, formatDay } from "@/lib/format";
import { EditorialRecordPanel } from "@/components/editorial-record";
export function SourceSafetyControls({ area }: { area: "content" | "system" }) {
  const [page, setPage] = useState(1),
    [reason, setReason] = useState(""),
    [source, setSource] = useState(""),
    [record, setRecord] = useState<string | null>(null);
  const q = useGetSourceControls({ area, page }, { query: { retry: false, refetchInterval: 15000 } });
  const mutation = useActOnSourceControls();
  const retry = useRef<{ body: string; key: string } | null>(null);
  const [saved, setSaved] = useState("");
  const valid = reason.trim().length >= 20 && !mutation.isPending;
  const act = (
    choice:
      | Omit<Extract<SourceControlAction, { action: "watch_source" }>, "requestKey" | "reason">
      | Omit<
          Extract<SourceControlAction, { action: "hold_version" | "withdraw_version" }>,
          "requestKey" | "reason"
        >
      | Omit<
          Extract<SourceControlAction, { action: "pause_service" | "resume_service" }>,
          "requestKey" | "reason"
        >,
  ) => {
    if (!valid) return;
    const body = JSON.stringify({ ...choice, reason: reason.trim() });
    if (retry.current?.body !== body) retry.current = { body, key: crypto.randomUUID() };
    mutation.mutate(
      { data: { ...choice, reason: reason.trim(), requestKey: retry.current.key } as SourceControlAction },
      {
        onSuccess: () => {
          retry.current = null;
          setSaved("Action saved. Current readers and dispatch guards now use this safety state.");
          void q.refetch();
        },
      },
    );
  };
  return (
    <section
      className="mt-6 rounded-2xl border p-5"
      aria-label="Source and safety controls"
      data-testid="source-safety-controls"
    >
      <h2 className="font-display text-2xl">
        {area === "content" ? "Source checks and version safety" : "Service safety pauses"}
      </h2>
      {q.isLoading ? (
        <Skel className="mt-4 h-24" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <p className="mt-3 text-sm text-muted-foreground">{q.data.notice}</p>
          <label className="mt-5 block text-sm font-medium" htmlFor={`safety-reason-${area}`}>
            Reason for this action (at least 20 characters)
          </label>
          <textarea
            id={`safety-reason-${area}`}
            value={reason}
            maxLength={1000}
            onChange={(e) => {
              setReason(e.target.value);
              setSaved("");
            }}
            className="mt-2 min-h-24 w-full rounded-lg border bg-background p-3"
          />
          {mutation.error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {describeError(mutation.error).message}
            </p>
          )}
          {saved && (
            <p role="status" className="mt-3 text-sm">
              {saved}
            </p>
          )}
          {area === "system" ? (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {(["ai", "checkout"] as const).map((service) => {
                const flag = q.data.services.find(
                    (s) => s.key === (service === "ai" ? "all_ai" : "checkout"),
                  ),
                  paused = flag?.enabled === false;
                return (
                  <div key={service} className="rounded-xl border p-4">
                    <h3 className="font-medium">{service === "ai" ? "AI assistance" : "New checkout"}</h3>
                    <p className="my-3 text-sm">
                      {paused ? "Safety pause on" : "Safety pause off"}. Financial and release permissions
                      still apply.
                    </p>
                    <button
                      className="btn btn-ghost"
                      disabled={!valid}
                      onClick={() => act({ action: paused ? "resume_service" : "pause_service", service })}
                    >
                      {paused ? "Remove safety pause" : "Pause service"}
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <div className="mt-6 flex flex-wrap items-end gap-3">
                <label className="grid min-w-0 gap-2 text-sm" htmlFor="source-watch-choice">
                  Official source to monitor
                  <select
                    id="source-watch-choice"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="min-w-0 max-w-full rounded-lg border bg-background p-2"
                  >
                    <option value="">Select a registered official source</option>
                    {q.data.sourceChoices.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id}: {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="btn btn-ghost"
                  disabled={!valid || !source}
                  onClick={() => act({ action: "watch_source", sourceId: source })}
                >
                  Start daily checks
                </button>
              </div>
              <h3 className="mt-7 font-medium">Version safety</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                A hold or withdrawal applies to this exact version. Releasing a replacement still requires the
                normal editorial checks.
              </p>
              <ul className="mt-3 divide-y">
                {q.data.versions.map((v) => (
                  <li
                    key={`${v.kind}:${v.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-4"
                  >
                    <div>
                      <p className="font-medium">
                        {v.key} · version {v.version} · {v.kind === "rule" ? "Rule" : "Content"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {v.safetyHeld ? "Safety held" : v.status}
                        {v.reviewBy ? ` · Review by ${formatDay(v.reviewBy)}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="btn btn-ghost btn-sm"
                        aria-expanded={record === `${v.kind}:${v.id}`}
                        onClick={() =>
                          setRecord((open) => (open === `${v.kind}:${v.id}` ? null : `${v.kind}:${v.id}`))
                        }
                      >
                        Publication record
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!valid || v.safetyHeld}
                        onClick={() =>
                          act({ action: "hold_version", kind: v.kind, id: v.id, version: v.version })
                        }
                      >
                        Hold version
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        disabled={!valid || v.safetyHeld}
                        onClick={() =>
                          act({ action: "withdraw_version", kind: v.kind, id: v.id, version: v.version })
                        }
                      >
                        Withdraw version
                      </button>
                    </div>
                    {record === `${v.kind}:${v.id}` && (
                      <div className="basis-full">
                        <EditorialRecordPanel kind={v.kind} id={v.id} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {!q.data.versions.length && <p className="mt-3 text-sm">No version records on this page.</p>}
              <div className="mt-3 flex items-center gap-3">
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={page === 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </button>
                <span className="text-sm">Page {page}</span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={!q.data.hasMore}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
              <h3 className="mt-7 font-medium">Daily source checks</h3>
              <ul className="mt-3 grid gap-3">
                {q.data.sources.map((s) => (
                  <li key={s.sourceId} className="rounded-xl border p-3 text-sm">
                    <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                      {s.sourceId}
                    </a>{" "}
                    ·{" "}
                    {s.stoppedAt
                      ? `Stopped ${formatDateTime(s.stoppedAt)}: the source register retired it`
                      : s.failureCode
                        ? "Check unavailable"
                        : s.checkedAt
                          ? `Checked ${formatDateTime(s.checkedAt)}`
                          : "First check pending"}
                    {!s.stoppedAt && (
                      <p className="mt-1 text-muted-foreground">
                        Next check: {formatDateTime(s.nextCheckAt)}. Successful retrieval does not approve
                        legal claims.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
              <h3 className="mt-7 font-medium">Correction review queue</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Most recent 50 review records. Paid reviews and external messages remain held.
              </p>
              <ul className="mt-3 grid gap-3">
                {q.data.review.map((r) => (
                  <li key={r.id} className="rounded-xl border p-3 text-sm">
                    <strong>
                      {r.targetKey}, version {r.targetVersion}
                    </strong>
                    <p className="mt-1">{r.reason}</p>
                    <p className="mt-1 text-muted-foreground">{r.status.replaceAll("_", " ")}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : null}
    </section>
  );
}
