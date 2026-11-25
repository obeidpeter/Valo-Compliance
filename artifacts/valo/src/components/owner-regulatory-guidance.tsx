import { useState } from "react";
import {
  decideOwnerGuidance,
  liftOwnerGuidanceHold,
  refreshOwnerGuidance,
  useListOwnerGuidance,
} from "@workspace/api-client-react";
import { formatDay } from "@/lib/format";
import { describeError } from "@/lib/describe-error";
import { changeLabel } from "@/lib/library-change";
import { heldLine, liftHint, liftLabel, liftedMessage } from "@/lib/library-holds";
import {
  actionEvidenceLabel,
  appliesToLabel,
  ownerMissingScope,
  recordLegend,
  relatedTemplateLine,
  relatedTemplatesLabel,
} from "@/lib/guidance-record";
import { PlainText } from "./resource-parts";
import { ErrorState } from "./states";

export function OwnerRegulatoryGuidance() {
  const [page, setPage] = useState(1);
  const result = useListOwnerGuidance({ page }, { query: { retry: false } });
  const [selected, setSelected] = useState("");
  const [approval, setApproval] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  // Signing a version that follows an earlier release says what changed
  // (docs/architecture/guidance-currency.md, slice 3).
  const [changeNote, setChangeNote] = useState("");
  // A Content editor's hold on the published version, which only the owner lifts
  // (docs/architecture/library-holds.md, slice 2).
  const [liftReason, setLiftReason] = useState("");
  const item = result.data?.items.find((row) => row.itemId === selected);
  const needsChange = !!item && item.state === "draft" && item.previousRelease !== null;
  // A draft is signed only once its sources are checked with nothing unresolved, and it says whom it
  // applies to (docs/architecture/guidance-record.md).
  const signable =
    !!item && item.state === "draft" && !item.holds.length && !!item.checkId && item.appliesTo !== null;
  const key = item ? [item.itemId, item.digest, item.checkId].join("/") : "";
  function select(id: string) {
    setSelected(id);
    setApproval("");
    setChangeNote("");
    setLiftReason("");
    setNotice("");
    setError("");
  }
  async function decide(action: "publish" | "withdraw") {
    if (!item || approval !== key || (action === "withdraw" && !item.live)) return;
    const revision = action === "withdraw" ? item.live! : item;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await decideOwnerGuidance(item.itemId, {
        action,
        digest: revision.digest,
        version: revision.version,
        confirmed: true,
        checkId: action === "publish" ? item.checkId : null,
        ...(action === "publish" && needsChange ? { change: changeNote.trim() } : {}),
      });
      setApproval("");
      setChangeNote("");
      await result.refetch();
      setNotice(`Version ${saved.version} ${saved.state}.`);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function liftHold() {
    if (!item?.live || !item.libraryHold) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await liftOwnerGuidanceHold(item.itemId, {
        version: item.live.version,
        digest: item.live.digest,
        reason: liftReason.trim(),
      });
      setLiftReason("");
      await result.refetch();
      setNotice(liftedMessage);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function refreshSources() {
    if (!item || busy) return;
    setBusy(true);
    setApproval("");
    setNotice("");
    setError("");
    try {
      const check = await refreshOwnerGuidance(item.itemId, { version: item.version, digest: item.digest });
      await result.refetch();
      setNotice(
        check.holds.length
          ? "Source check complete. Review the unresolved claims below."
          : "Official sources checked.",
      );
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="owner-guidance-heading">
      <h2 className="font-display text-2xl" id="owner-guidance-heading">
        Regulatory source sign-off
      </h2>
      {result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : (
        <>
          <label className="mt-4 block text-sm font-medium">
            Regulatory draft
            <select
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
              value={selected}
              onChange={(e) => select(e.target.value)}
              disabled={busy}
            >
              <option value="">Choose an article</option>
              {result.data?.items.map((row) => (
                <option key={row.itemId} value={row.itemId}>
                  {row.title} · {row.state}
                </option>
              ))}
            </select>
          </label>
          {(page > 1 || result.data?.hasMore) && (
            <div className="mt-2 flex gap-2">
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy || page === 1}
                onClick={() => {
                  select("");
                  setPage(page - 1);
                }}
              >
                Previous
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy || !result.data?.hasMore}
                onClick={() => {
                  select("");
                  setPage(page + 1);
                }}
              >
                Next
              </button>
            </div>
          )}
          {item && (
            <div className="mt-5 space-y-4">
              <h3 className="font-display text-xl">{item.title}</h3>
              <p>
                Version {item.version} · {item.state}
              </p>
              <PlainText
                text={item.body}
                className="grid gap-3"
                sourceUrls={item.sources.map((s) => s.url)}
              />
              <section aria-label={recordLegend} className="grid gap-1" data-testid="owner-guidance-record">
                <h4 className="font-semibold">{recordLegend}</h4>
                <p className="font-medium">{appliesToLabel}</p>
                <p>{item.appliesTo ?? "Not given yet."}</p>
                {item.actionEvidence && (
                  <>
                    <p className="font-medium">{actionEvidenceLabel}</p>
                    <p>{item.actionEvidence}</p>
                  </>
                )}
                {item.relatedTemplates.length > 0 && (
                  <>
                    <p className="font-medium">{relatedTemplatesLabel}</p>
                    <ul className="list-disc pl-5">
                      {item.relatedTemplates.map((template) => (
                        <li key={template.number}>{relatedTemplateLine(template)}</li>
                      ))}
                    </ul>
                  </>
                )}
                {item.state === "draft" && item.appliesTo === null && (
                  <p role="note" data-testid="text-owner-record-missing">
                    {ownerMissingScope}
                  </p>
                )}
              </section>
              {item.sources.length > 0 && (
                <section aria-label="Official sources">
                  <h4 className="font-semibold">Official sources</h4>
                  <ul className="list-disc pl-5">
                    {item.sources.map((s, i) => (
                      <li key={`${s.url}/${i}`}>
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                          {s.title}
                        </a>{" "}
                        · {s.locator}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {item.checkedAt && (
                <p>
                  Sources checked <time dateTime={item.checkedAt}>{formatDay(item.checkedAt)}</time>.
                </p>
              )}
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => void refreshSources()}>
                Check official sources
              </button>
              {item.holds.length > 0 && (
                <section aria-label="Unresolved source checks">
                  <h4 className="font-semibold">Unresolved source checks</h4>
                  <ul className="list-disc pl-5">
                    {item.holds.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </section>
              )}
              {item.live && item.libraryHold && (
                <section aria-label="Hold on the published version" className="grid gap-2">
                  <p className="font-medium text-destructive" data-testid="text-owner-held">
                    {heldLine(item.live.version, item.libraryHold)}
                  </p>
                  <label className="font-medium" htmlFor="owner-lift-reason">
                    {liftLabel}
                  </label>
                  <p id="owner-lift-reason-help" className="text-muted-foreground">
                    {liftHint}
                  </p>
                  <textarea
                    id="owner-lift-reason"
                    className="field min-h-24"
                    aria-describedby="owner-lift-reason-help"
                    minLength={20}
                    maxLength={1000}
                    disabled={busy}
                    value={liftReason}
                    onChange={(e) => setLiftReason(e.target.value)}
                  />
                  <button
                    className="btn btn-ghost justify-self-start"
                    disabled={busy || liftReason.trim().length < 20}
                    onClick={() => void liftHold()}
                  >
                    Lift the hold
                  </button>
                </section>
              )}
              {(signable || item.live) && (
                <>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={approval === key}
                      onChange={(e) => setApproval(e.target.checked ? key : "")}
                    />
                    I have checked this article version and its official sources and authorise the selected
                    action.
                  </label>
                  {needsChange && signable && (
                    <div className="grid gap-1">
                      <label className="font-medium" htmlFor="owner-change-note">
                        {changeLabel}
                      </label>
                      <p id="owner-change-note-help" className="text-muted-foreground">
                        Version {item.previousRelease} was released before. Readers see this note on the
                        article's page. In 20 to 1,000 characters.
                      </p>
                      <textarea
                        id="owner-change-note"
                        className="field min-h-24"
                        aria-describedby="owner-change-note-help"
                        minLength={20}
                        maxLength={1000}
                        disabled={busy}
                        value={changeNote}
                        onChange={(e) => setChangeNote(e.target.value)}
                      />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    {signable && (
                      <button
                        className="btn btn-primary"
                        disabled={busy || approval !== key || (needsChange && changeNote.trim().length < 20)}
                        onClick={() => void decide("publish")}
                      >
                        Sign off and publish this version
                      </button>
                    )}
                    {item.live && (
                      <button
                        className="btn btn-ghost"
                        disabled={busy || approval !== key}
                        onClick={() => void decide("withdraw")}
                      >
                        Withdraw published version {item.live.version}
                      </button>
                    )}
                  </div>
                </>
              )}
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
