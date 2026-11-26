import { useGetOperationalAlerts, type OperationalAlert } from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { formatCount, formatDateTime } from "@/lib/format";

/** What the alert's reading found against its limit, where it has a limit. */
function measured(alert: OperationalAlert) {
  if (alert.threshold === null) return null;
  const limit = `limit ${formatCount(alert.threshold)}`;
  return alert.reading === null
    ? `No reading could be taken; ${limit}`
    : `Reading ${formatCount(alert.reading)}; ${limit}`;
}

function Owners({ alert }: { alert: OperationalAlert }) {
  if (!alert.runbook && !alert.accountable) return null;
  return (
    <p>
      {alert.runbook && <>Runbook: {alert.runbook}</>}
      {alert.runbook && alert.accountable && " · "}
      {alert.accountable && <>Accountable: {alert.accountable}</>}
    </p>
  );
}

/**
 * SEC-008, NFR-010 (docs/architecture/alerts.md, part 1): the alerts the worker raised and cleared, for
 * the system operators who answer them, emergency access included. The list waits for someone to open
 * it: no alert is sent anywhere.
 */
export function OperationalAlerts() {
  // The worker takes its readings once a minute, so the list is read again as often.
  const q = useGetOperationalAlerts({ query: { retry: false, refetchInterval: 60000 } });
  const alerts = q.data;
  return (
    <section className="mt-6 space-y-4 rounded-xl border p-4" aria-labelledby="operational-alerts-heading">
      <h2 id="operational-alerts-heading" className="font-display text-2xl">
        Alerts
      </h2>
      <p className="text-sm">
        Read only. Once a minute the worker takes its readings, raises an alert for any over its limit or that
        it cannot take, and clears the alert when the reading is back. No alert is sent anywhere: this list is
        where they are kept.
      </p>
      {q.isLoading && <p role="status">Loading the alerts…</p>}
      {q.isError && (
        <div>
          <p role="alert" className="my-3">
            {describeError(q.error).message}
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => void q.refetch()}>
            Try again
          </button>
        </div>
      )}
      {alerts && (
        <>
          <h3 className="font-semibold">Active now</h3>
          {alerts.active.length === 0 ? (
            <p>No alert is active.</p>
          ) : (
            <ul className="space-y-2" aria-label="Active alerts">
              {alerts.active.map((alert) => (
                <li key={alert.id} className="rounded-lg border p-3 text-sm">
                  <p className="font-semibold">{alert.title}</p>
                  <p>Raised {formatDateTime(alert.at)}</p>
                  {measured(alert) && <p>{measured(alert)}</p>}
                  <Owners alert={alert} />
                </li>
              ))}
            </ul>
          )}
          <h3 className="font-semibold">Latest changes</h3>
          {alerts.changes.length === 0 ? (
            <p>No alert has been raised yet.</p>
          ) : (
            <ul className="space-y-2" aria-label="Latest alert changes">
              {alerts.changes.map((change) => (
                <li key={change.id} className="rounded-lg border p-3 text-sm">
                  <p>
                    <span className="font-semibold">{change.state === "active" ? "Raised" : "Cleared"}</span>{" "}
                    {formatDateTime(change.at)}: {change.title}
                  </p>
                  {measured(change) && <p>{measured(change)}</p>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
