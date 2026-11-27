import { useState } from "react";
import {
  checkReviewedGuide,
  useListReviewedGuides,
  type ReviewedGuideClaimKind,
  type ReviewedGuideItem,
  type ReviewedGuideSource,
} from "@workspace/api-client-react";
import { formatDateTime, formatDay } from "@/lib/format";
import { describeError } from "@/lib/describe-error";
import { ErrorState } from "./states";

const KIND_LABELS: Record<ReviewedGuideClaimKind, string> = {
  source_statement: "What the law says",
  interpretation: "Valo's reading of the law",
  optional_practice: "A practice the guide suggests",
};

/** Where a source's copy stands, in the owner's words. */
function sourceState(source: ReviewedGuideSource) {
  const checked = source.checkedAt
    ? `The daily source check last read it ${formatDateTime(source.checkedAt)}.`
    : "The daily source check has not read it yet.";
  switch (source.state) {
    case "holds":
      return `${checked} Its copy holds the passage and every quotation from it.`;
    case "quote_missing":
      return `${checked} Its copy holds the passage, but not every quotation from it.`;
    case "passage_missing":
      return `${checked} Its copy no longer holds the passage.`;
    case "changed":
      return `${checked} Its official file has changed since this guide was prepared.`;
    case "not_current":
      return `${checked} Its copy was not checked within the last day, or the last check failed.`;
    case "unreadable":
      return `${checked} Its stored copy could not be read.`;
    case "no_copy":
      return "No copy of it is recorded for this guide.";
  }
}

function lastCheckWords(item: ReviewedGuideItem) {
  if (!item.lastCheck) return "You have not checked this guide's sources yet.";
  if (item.lastCheck.counts)
    return `You checked its sources ${formatDateTime(item.lastCheck.checkedAt)}. Its reviews can be admitted, and the guide released, until ${formatDateTime(item.lastCheck.countsUntil)}.`;
  return `You last checked its sources ${formatDateTime(item.lastCheck.checkedAt)}. That check no longer counts, so check them again before its reviews or its release.`;
}

/**
 * Guides on the reviewed route (docs/architecture/reviewed-route.md, part 2; decision 0018). The
 * development owner reads a prepared guide's whole text, each sentence with the passage it rests on,
 * and where each of its sources' copies stands today, then confirms the check of that exact guide. Its
 * two reviews are admitted, and the guide released, only within a day of that check.
 */
export function OwnerReviewedGuides() {
  const result = useListReviewedGuides({ query: { retry: false } });
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const item = result.data?.items.find((row) => row.versionId === selected);
  const key = item ? `${item.versionId}/${item.candidateHash}` : "";
  async function act(run: () => Promise<string>) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const done = await run();
      setConfirmed("");
      setNotice(done);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const checkAgain = () =>
    act(async () => {
      await result.refetch();
      return "Its sources are checked again against today's copies. Nothing was recorded.";
    });
  const record = (guide: ReviewedGuideItem) =>
    act(async () => {
      const saved = await checkReviewedGuide(guide.versionId, { confirmCandidateHash: guide.candidateHash });
      await result.refetch();
      return `Your check of ${guide.title} is recorded, ${formatDateTime(saved.checkedAt)}. Its reviews can be admitted, and the guide released, for one day from then.`;
    });
  const sourceTitle = (guide: ReviewedGuideItem, id: string) =>
    guide.sources.find((s) => s.id === id)?.title ?? id;
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="reviewed-guides-heading">
      <h2 className="font-display text-2xl" id="reviewed-guides-heading">
        Guides on the reviewed route
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        A guide's two reviews are admitted, and the guide released, only within a day of your check of its
        official sources. Read its text and the passages its sentences rest on, then confirm your check.
      </p>
      {result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : result.isPending ? (
        <p className="mt-4">Loading the prepared guides…</p>
      ) : !result.data.items.length ? (
        <p className="mt-4">
          No guide is awaiting its reviews. A guide appears here once it is prepared for them.
        </p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-medium">
            Prepared guide
            <select
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setConfirmed("");
                setNotice("");
                setError("");
              }}
              disabled={busy}
            >
              <option value="">Choose a guide</option>
              {result.data.items.map((row) => (
                <option key={row.versionId} value={row.versionId}>
                  {row.guideId}: {row.title} · version {row.version}
                  {row.saved ? " (reviewed, waiting for your check)" : ""}
                </option>
              ))}
            </select>
          </label>
          {item && (
            <div className="mt-5 space-y-4">
              <h3 className="font-display text-xl">{item.title}</h3>
              <p>
                {item.guideId}, version {item.version}. Prepared {formatDateTime(item.preparedAt)}. It must be
                reviewed and released by {formatDay(item.reviewBy)}.
                {item.saved
                  ? " Its two reviews have run, and it waits for your check before its release."
                  : ""}
              </p>
              <p data-testid="text-reviewed-guide-last-check">{lastCheckWords(item)}</p>
              <details className="rounded-lg border border-border p-3">
                <summary className="cursor-pointer font-medium">Its whole text</summary>
                <div className="mt-2 space-y-2">
                  {item.text.map((part, index) => (
                    <p key={index} className="whitespace-pre-wrap">
                      {part}
                    </p>
                  ))}
                </div>
              </details>
              <div>
                <h4 className="font-semibold">Its sentences and the passages they rest on</h4>
                <ol className="mt-2 list-decimal space-y-3 pl-5">
                  {item.claims.map((claim, index) => (
                    <li key={index}>
                      <p>{claim.text}</p>
                      <p className="text-sm text-muted-foreground">
                        {KIND_LABELS[claim.kind]}. {sourceTitle(item, claim.sourceId)}, {claim.locator}: “
                        {claim.quote}”
                      </p>
                      {claim.held && (
                        <p className="text-sm font-medium">
                          Today's copy of its source does not hold these words.
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h4 className="font-semibold">Its official sources</h4>
                <ul className="mt-2 space-y-3">
                  {item.sources.map((source) => (
                    <li key={source.id}>
                      <a href={source.url} target="_blank" rel="noopener noreferrer" className="underline">
                        {source.title}
                      </a>
                      <p className="text-sm">{sourceState(source)}</p>
                      <details className="mt-1">
                        <summary className="cursor-pointer text-sm">The passage this guide rests on</summary>
                        <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm">
                          {source.passage}
                        </p>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
              {item.holds.length ? (
                <div data-testid="list-reviewed-guide-holds">
                  <h4 className="font-semibold">What holds it</h4>
                  <ul className="mt-1 list-disc space-y-1 pl-5">
                    {item.holds.map((hold, index) => (
                      <li key={index}>{hold}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p>
                  Nothing holds it. Today's copies of its sources hold every passage and quotation it rests
                  on.
                </p>
              )}
              <button className="btn btn-ghost" disabled={busy} onClick={() => void checkAgain()}>
                Check official sources again
              </button>
              <fieldset className="space-y-3 rounded-lg border border-border p-4">
                <legend className="px-1 font-semibold">Your check</legend>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    disabled={busy || item.holds.length > 0}
                    checked={confirmed === key}
                    onChange={(e) => setConfirmed(e.target.checked ? key : "")}
                  />
                  I have read this guide's whole text and the passages its sentences rest on, and I check its
                  official sources for its release.
                </label>
                <button
                  className="btn btn-primary"
                  disabled={busy || item.holds.length > 0 || confirmed !== key}
                  onClick={() => void record(item)}
                >
                  Confirm my check of {item.guideId}
                </button>
              </fieldset>
            </div>
          )}
        </>
      )}
      {notice && (
        <p className="mt-3" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="mt-3" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
