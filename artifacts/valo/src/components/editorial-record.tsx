import {
  useGetEditorialRecord,
  getGetEditorialRecordQueryKey,
  type EditorialRecord,
} from "@workspace/api-client-react";
import { ErrorState, Skel } from "@/components/states";
import { formatDateTime, formatDay } from "@/lib/format";

const checks = (c: EditorialRecord["mechanicalChecks"]) =>
  `${c.passed} passed, ${c.failed} failed, ${c.notRun} not run`;

/** ADM-002: a version's publication record, read on demand from the staff content area. */
export function EditorialRecordPanel({ kind, id }: { kind: "content" | "rule"; id: string }) {
  const q = useGetEditorialRecord(kind, id, {
    query: { queryKey: getGetEditorialRecordQueryKey(kind, id), retry: false },
  });
  if (q.isLoading) return <Skel className="mt-3 h-24" />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return <EditorialRecordView record={q.data} />;
}

/** What the stored bundle passes or holds on, who drafted and reviewed it, and what happened to it. */
export function EditorialRecordView({ record }: { record: EditorialRecord }) {
  const held = record.check.decision === "hold";
  return (
    <div
      className="mt-3 grid gap-5 rounded-xl border bg-sidebar p-4 text-sm"
      data-testid={`editorial-record-${record.id}`}
    >
      <p className="text-muted-foreground" data-testid="text-editorial-notice">
        {record.notice}
      </p>
      <section aria-label="Bundle check">
        <h4 className="font-medium">
          {held ? "Held by the bundle check" : "Passes the bundle check"} · checked{" "}
          {formatDateTime(record.check.checkedAt)}
        </h4>
        {record.check.reasons.length > 0 && (
          <ul className="mt-2 grid gap-1" data-testid="list-hold-reasons">
            {record.check.reasons.map((reason) => (
              <li key={reason}>
                <code className="break-all">{reason}</code>
              </li>
            ))}
          </ul>
        )}
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Status</dt>
            <dd>
              {record.status}
              {record.manifestStatus ? ` · manifest ${record.manifestStatus}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Candidate hash</dt>
            <dd>
              <code className="break-all">
                {record.candidateHash ?? "Bundle is not in the current schema"}
              </code>
            </dd>
          </div>
          {record.publishedAt && (
            <div>
              <dt className="text-muted-foreground">Published</dt>
              <dd>{formatDateTime(record.publishedAt)}</dd>
            </div>
          )}
          {record.reviewBy && (
            <div>
              <dt className="text-muted-foreground">Review by</dt>
              <dd>{formatDay(record.reviewBy)}</dd>
            </div>
          )}
          {record.withdrawnReason && (
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Withdrawn or held because</dt>
              <dd>{record.withdrawnReason}</dd>
            </div>
          )}
        </dl>
      </section>
      <section aria-label="Drafting and review runs">
        <h4 className="font-medium">Drafting and review runs</h4>
        {record.draftRun ? (
          <p className="mt-2">
            Draft: {record.draftRun.model} · run <code className="break-all">{record.draftRun.runId}</code> ·
            prompt {record.draftRun.promptVersion}
          </p>
        ) : (
          <p className="mt-2">No drafting run is recorded.</p>
        )}
        {record.reviews.length === 0 && <p className="mt-2">No review runs are recorded.</p>}
        <ul className="mt-2 grid gap-3">
          {record.reviews.map((review) => (
            <li key={`${review.role}:${review.runId}`} className="rounded-lg border p-3">
              <p>
                <strong className="capitalize">{review.role}</strong> review:{" "}
                {review.verdict === "pass" ? "pass" : "hold"} · {review.model} · run{" "}
                <code className="break-all">{review.runId}</code>
              </p>
              {review.receivedOtherVerdict && (
                <p className="mt-1 text-destructive">This review saw the other review's verdict.</p>
              )}
              {review.findings.length > 0 && (
                <ul className="mt-2 list-disc pl-5">
                  {review.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Checks">
        <h4 className="font-medium">Checks</h4>
        <p className="mt-2">Mechanical: {checks(record.mechanicalChecks)}</p>
        <p>Enhanced: {checks(record.enhancedChecks)}</p>
      </section>
      <section aria-label="Safety holds">
        <h4 className="font-medium">Safety holds</h4>
        {record.safetyHolds.length ? (
          <ul className="mt-2 grid gap-2">
            {record.safetyHolds.map((h) => (
              <li key={`${h.createdAt}:${h.reason}`}>
                {h.action === "withdraw" ? "Withdrawn" : "Held"} {formatDateTime(h.createdAt)}: {h.reason} ·{" "}
                {h.phase}
                {h.completedAt ? `, completed ${formatDateTime(h.completedAt)}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2">None.</p>
        )}
      </section>
      <section aria-label="Publication audit">
        <h4 className="font-medium">Publication audit</h4>
        {record.audit.length ? (
          <ol className="mt-2 grid gap-2">
            {record.audit.map((a) => (
              <li key={`${a.at}:${a.action}`}>
                {formatDateTime(a.at)} · {a.action} by {a.actor}:{" "}
                <span className="break-all">{a.reason}</span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2">
            {record.kind === "rule" ? "Rule releases keep their record in the release itself." : "None."}
          </p>
        )}
      </section>
    </div>
  );
}
