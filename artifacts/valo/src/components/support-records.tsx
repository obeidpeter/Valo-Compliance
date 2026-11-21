import { formatDateTime } from "@/lib/format";

/** Only mount with the support area's server-authorised response. Native
 * disclosures keep the complete message available without hiding fields behind
 * an arbitrary union of columns from different request types. */
export function SupportRecords({ records }: { records: Record<string, unknown>[] }) {
  const text = (v: unknown) =>
    v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  return (
    <ul className="mt-6 grid min-w-0 gap-4" aria-label="Saved support requests" data-testid="support-records">
      {records.map((r, index) => {
        const id = text(r.id) || String(index),
          kind = text(r.kind),
          key = `${kind}-${id}`;
        const type =
          kind === "public_access_request"
            ? "Account-access request"
            : kind === "workspace_request"
              ? "Workspace request"
              : "Support request";
        const reference = `VALO-${kind === "public_access_request" ? "ACCESS-" : ""}${id}`;
        const fields: [string, unknown][] = [
          ["Category", r.category],
          ["Topic", r.topic],
          ["Contact email", r.contactEmail],
          ["Workspace ID", r.workspaceId],
          [
            "Sharing consent",
            typeof r.sharingConsent === "boolean" ? (r.sharingConsent ? "Given" : "Not given") : undefined,
          ],
          ["Consent version", r.consentVersion],
          ["Notice version", r.noticeVersion],
        ];
        return (
          <li key={key} className="surface min-w-0 p-5 sm:p-6" data-testid={`support-record-${key}`}>
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-display text-xl">{type}</h2>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{reference}</p>
              </div>
              <span className="pill pill-ochre">
                {text(r.status ?? r.dispatchStatus ?? "Status not returned").replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-3 text-sm [overflow-wrap:anywhere]">
              {text(r.category ?? r.topic) || "Category not recorded"}
            </p>
            {r.createdAt !== undefined && (
              <p className="mt-1 text-xs text-muted-foreground">
                Received {formatDateTime(text(r.createdAt))}
              </p>
            )}
            <details className="mt-4 min-w-0 border-t border-border pt-4">
              <summary
                className="cursor-pointer rounded-sm text-sm font-medium text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4"
                data-testid={`support-details-${key}`}
              >
                View full request
              </summary>
              <div className="mt-4 grid min-w-0 gap-5">
                <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                  {fields
                    .filter(([, value]) => value !== undefined && value !== null)
                    .map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-xs text-muted-foreground">{label}</dt>
                        <dd className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{text(value)}</dd>
                      </div>
                    ))}
                </dl>
                {(["message", "scope"] as const).map(
                  (field) =>
                    r[field] !== undefined &&
                    r[field] !== null && (
                      <section
                        key={field}
                        className="min-w-0"
                        aria-label={field === "message" ? "Customer message" : "Request scope"}
                      >
                        <h3 className="text-sm font-medium">
                          {field === "message" ? "Customer message" : "Scope and request"}
                        </h3>
                        <p
                          className="mt-2 whitespace-pre-wrap text-sm leading-relaxed [overflow-wrap:anywhere]"
                          data-testid={`support-${field}-${key}`}
                        >
                          {text(r[field])}
                        </p>
                      </section>
                    ),
                )}
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
