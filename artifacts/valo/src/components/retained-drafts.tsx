import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListRetainedDraftsQueryKey,
  loadRetainedDrafts,
  useListRetainedDrafts,
  type RetainedDraft,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/describe-error";
import { formatCount, formatDateTime, formatDay } from "@/lib/format";
import { fileRecordButton, recordFiled, recordStates, recordWaiting } from "@/lib/guidance-record";
import { ErrorState } from "./states";

const GROUPS: { kinds: RetainedDraft["kind"][]; label: string }[] = [
  { kinds: ["template", "premium_template"], label: "Templates" },
  { kinds: ["practical_guide"], label: "Practical guides" },
  { kinds: ["industry_introduction"], label: "Industry introductions" },
  { kinds: ["industry_pack"], label: "Industry packs" },
  { kinds: ["regulatory_article"], label: "Regulatory guides" },
];

function where(item: RetainedDraft) {
  switch (item.state) {
    case "not_in_library":
      return "Not filed yet";
    case "draft":
      return `Draft, version ${formatCount(item.version ?? 1)}`;
    case "published":
      return `Published, version ${formatCount(item.liveVersion ?? 1)}`;
    case "withdrawn":
      return "Withdrawn";
    case "replaced":
      return "Replaced";
  }
}

function sourceCheck(item: RetainedDraft) {
  const check = item.sourceCheck;
  if (item.kind !== "regulatory_article") return null;
  if (!check) return "Sources not checked yet";
  const holds = check.holds === 0 ? "no holds" : `${formatCount(check.holds)} holds`;
  const current = check.validThrough ? `, current until ${formatDay(check.validThrough)}` : "";
  return `Sources checked ${formatDateTime(check.checkedAt)}: ${holds}${current}`;
}

/**
 * The drafts written for Valo and kept in the repository, and where each stands here. Filing saves
 * those not here yet as private drafts, under the editor who files them, to preview and publish in
 * the list below. Filing publishes nothing; a regulatory guide also waits for the owner's source
 * check.
 */
export function RetainedDrafts() {
  const client = useQueryClient();
  const status = useListRetainedDrafts({ query: { retry: false } });
  const formTextWaiting =
    status.data?.items.filter((item) => item.formText === "proposed" && item.itemId !== null).length ?? 0;
  // Filed templates whose latest version lacks what it is for, its limits and how it was written.
  const detailsWaiting =
    status.data?.items.filter((item) => item.details === "proposed" && item.itemId !== null).length ?? 0;
  // Filed regulatory guides whose latest version does not say whom they apply to, while their drafts do
  // (docs/architecture/guidance-record.md).
  const recordsWaiting =
    status.data?.items.filter((item) => item.record === "proposed" && item.itemId !== null).length ?? 0;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function fileAll(load: "missing" | "form_text" | "details" | "record" = "missing") {
    setBusy(true);
    setError("");
    setMessage("");
    let filed = 0;
    try {
      // Each request files a few; ask again until none is left, or none more could be filed.
      for (let round = 0; round < 20; round++) {
        const result = await loadRetainedDrafts({ load });
        filed += result.loaded.length;
        client.setQueryData(getListRetainedDraftsQueryKey(), result.status);
        setMessage(`Filed ${formatCount(filed)} so far…`);
        if (result.remaining === 0 || result.loaded.length === 0) break;
      }
      await client.invalidateQueries({ queryKey: ["listManualLibrary"] });
      setMessage(
        load === "form_text"
          ? `Filed the form text of ${formatCount(filed)} ${filed === 1 ? "template" : "templates"} as a new draft version. Each is private until it is published.`
          : load === "details"
            ? `Filed the proposed details of ${formatCount(filed)} ${filed === 1 ? "template" : "templates"} as a new draft version. Each is private until it is published.`
            : load === "record"
              ? recordFiled(filed, formatCount(filed))
              : `Filed ${formatCount(filed)} ${filed === 1 ? "draft" : "drafts"}. Each is private until it is published.`,
      );
    } catch (e) {
      setError(describeError(e).message);
      if (filed) setMessage(`Filed ${formatCount(filed)} before the error.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="retained-drafts-title">
      <h2 className="font-display text-2xl" id="retained-drafts-title">
        Drafts ready to file
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        The 108 drafts written for Valo: 40 templates, 12 practical guides, 20 industry introductions, 6
        industry packs and 30 regulatory guides. Filing saves each one not here yet as a private draft, to
        preview and publish below. Filing publishes nothing. A regulatory guide is published only after the
        owner checks its sources.
      </p>
      {status.isError ? (
        <ErrorState error={status.error} onRetry={() => void status.refetch()} />
      ) : !status.data ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Reading the drafts…
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm" data-testid="text-retained-summary">
            {formatCount(status.data.notInLibrary)} not filed yet · {formatCount(status.data.published)}{" "}
            published · {formatCount(status.data.shown)} on the site now
          </p>
          {status.data.notInLibrary > 0 ? (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-3"
              disabled={busy}
              onClick={() => void fileAll()}
              data-testid="button-file-retained"
            >
              {busy
                ? "Filing…"
                : `File the ${formatCount(status.data.notInLibrary)} ${status.data.notInLibrary === 1 ? "draft" : "drafts"} not filed yet`}
            </button>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">Every draft is filed.</p>
          )}
          {formTextWaiting > 0 && (
            <div className="mt-3 grid gap-1">
              <p className="text-sm">
                {formatCount(formTextWaiting)}{" "}
                {formTextWaiting === 1 ? "filed template has" : "filed templates have"} form text proposed for
                {formTextWaiting === 1 ? " its" : " their"} fill-in form and not filed yet. Filing saves it
                with a new draft version, keeping the text and file of the latest one.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm justify-self-start"
                disabled={busy}
                onClick={() => void fileAll("form_text")}
                data-testid="button-file-form-text"
              >
                {busy ? "Filing…" : "File the proposed form text"}
              </button>
            </div>
          )}
          {detailsWaiting > 0 && (
            <div className="mt-3 grid gap-1">
              <p className="text-sm">
                {formatCount(detailsWaiting)}{" "}
                {detailsWaiting === 1 ? "filed template does" : "filed templates do"} not yet say what{" "}
                {detailsWaiting === 1 ? "it is" : "they are"} for, {detailsWaiting === 1 ? "its" : "their"}{" "}
                limits and how {detailsWaiting === 1 ? "it was" : "they were"} written, which a template needs
                before it is published. Filing saves the details proposed for each with a new draft version,
                keeping the text, file and form text of the latest one.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm justify-self-start"
                disabled={busy}
                onClick={() => void fileAll("details")}
                data-testid="button-file-details"
              >
                {busy ? "Filing…" : "File the proposed details"}
              </button>
            </div>
          )}
          {recordsWaiting > 0 && (
            <div className="mt-3 grid gap-1">
              <p className="text-sm">{recordWaiting(recordsWaiting, formatCount(recordsWaiting))}</p>
              <button
                type="button"
                className="btn btn-ghost btn-sm justify-self-start"
                disabled={busy}
                onClick={() => void fileAll("record")}
                data-testid="button-file-record"
              >
                {busy ? "Filing…" : fileRecordButton}
              </button>
            </div>
          )}
          <p className="mt-2 text-sm" role="status" aria-live="polite">
            {message}
          </p>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="mt-4 grid gap-2">
            {GROUPS.map((group) => {
              const items = status.data.items.filter((item) => group.kinds.includes(item.kind));
              const waiting = items.filter((item) => item.state === "not_in_library").length;
              return (
                <details key={group.label} className="rounded-xl border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">
                    {group.label} ({formatCount(items.length)}):{" "}
                    {formatCount(items.filter((item) => item.state === "published").length)} published,{" "}
                    {formatCount(waiting)} not filed yet
                  </summary>
                  <ul className="mt-3 grid gap-2 text-sm">
                    {items.map((item) => (
                      <li key={item.retainedId} className="grid gap-0.5 border-t border-border pt-2">
                        <span>
                          <span className="font-mono text-xs text-muted-foreground">{item.retainedId}</span>{" "}
                          {item.title}
                          {item.kind === "premium_template" && " (premium)"}
                        </span>
                        <span className="text-muted-foreground">
                          {where(item)}
                          {item.shown
                            ? " · on the site"
                            : item.state === "published"
                              ? " · not on the site"
                              : ""}
                        </span>
                        {sourceCheck(item) && (
                          <span className="text-muted-foreground">{sourceCheck(item)}</span>
                        )}
                        {item.formText && (
                          <span className="text-muted-foreground">
                            {item.formText === "filed"
                              ? "Form text for its fill-in form: filed with the latest version"
                              : "Form text for its fill-in form: proposed, not filed yet"}
                          </span>
                        )}
                        {item.details && item.state !== "not_in_library" && (
                          <span className="text-muted-foreground">
                            {item.details === "filed"
                              ? "What it is for, its limits and how it was written: filed with the latest version"
                              : "What it is for, its limits and how it was written: proposed, not filed yet"}
                          </span>
                        )}
                        {item.record && item.state !== "not_in_library" && (
                          <span className="text-muted-foreground">{recordStates[item.record]}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
