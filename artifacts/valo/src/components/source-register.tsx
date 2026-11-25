import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  fileSourceRegister,
  getListSourceRegisterQueryKey,
  reviseSourceRegisterEntry,
  useListSourceRegister,
  type SourceRegisterEntry,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/describe-error";
import {
  entryLine,
  fileButton,
  instrumentNames,
  notKnown,
  reasonHint,
  reasonLabel,
  registerHeading,
  registerIntro,
  registerSummary,
  restingLine,
  retiredNote,
  retireWarning,
  versionLine,
  watchLine,
} from "@/lib/source-register";
import { ErrorState } from "./states";

const inputStyle = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base";

/** One entry's correction form: its fields as they stand, and why they change. */
function EntryForm({
  entry,
  jurisdictions,
  onSaved,
}: {
  entry: SourceRegisterEntry;
  jurisdictions: string[];
  onSaved: (message: string) => void;
}) {
  const client = useQueryClient();
  const [authority, setAuthority] = useState(entry.authority ?? "");
  const [jurisdiction, setJurisdiction] = useState(entry.jurisdiction);
  const [instrument, setInstrument] = useState<"" | NonNullable<SourceRegisterEntry["instrument"]>>(
    entry.instrument ?? "",
  );
  const [versionInForce, setVersionInForce] = useState(entry.versionInForce ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(entry.effectiveFrom ?? "");
  const [status, setStatus] = useState(entry.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const id = (field: string) => `register-${entry.sourceId}-${field}`;
  // Retiring an active source stops its daily check and holds what rests on it: say so before saving.
  const retiring = status === "retired" && entry.status !== "retired";
  async function save() {
    setBusy(true);
    setError("");
    try {
      const register = await reviseSourceRegisterEntry(entry.sourceId, {
        baseVersion: entry.version,
        authority: authority.trim() || null,
        jurisdiction,
        instrument: instrument || null,
        versionInForce: versionInForce.trim() || null,
        effectiveFrom: instrument === "official_page" ? null : effectiveFrom || null,
        status,
        reason: reason.trim(),
      });
      client.setQueryData(getListSourceRegisterQueryKey(), register);
      setReason("");
      onSaved(`Saved version ${entry.version + 1} of ${entry.title}.`);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="mt-3 grid gap-3 rounded-lg border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid={"form-register-" + entry.sourceId}
    >
      <label className="text-sm font-medium" htmlFor={id("authority")}>
        Who issues it
        <input
          id={id("authority")}
          className={inputStyle}
          maxLength={200}
          value={authority}
          onChange={(e) => setAuthority(e.target.value)}
        />
      </label>
      <label className="text-sm font-medium" htmlFor={id("jurisdiction")}>
        Where it applies
        <select
          id={id("jurisdiction")}
          className={inputStyle}
          value={jurisdiction}
          onChange={(e) => setJurisdiction(e.target.value)}
        >
          {jurisdictions.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium" htmlFor={id("instrument")}>
        Kind of text
        <select
          id={id("instrument")}
          className={inputStyle}
          value={instrument}
          onChange={(e) => setInstrument(e.target.value as typeof instrument)}
        >
          <option value="">{notKnown}</option>
          {(Object.keys(instrumentNames) as (keyof typeof instrumentNames)[]).map((kind) => (
            <option key={kind} value={kind}>
              {instrumentNames[kind]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm font-medium" htmlFor={id("version")}>
        Version in force
        <input
          id={id("version")}
          className={inputStyle}
          maxLength={200}
          value={versionInForce}
          onChange={(e) => setVersionInForce(e.target.value)}
        />
      </label>
      {instrument !== "official_page" && (
        <label className="text-sm font-medium" htmlFor={id("effective")}>
          In effect from
          <input
            id={id("effective")}
            type="date"
            className={inputStyle}
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
          />
        </label>
      )}
      <fieldset className="text-sm" aria-describedby={retiring ? id("retiring") : undefined}>
        <legend className="font-medium">Status</legend>
        <label className="mr-4 inline-flex items-center gap-2">
          <input
            type="radio"
            name={id("status")}
            checked={status === "active"}
            onChange={() => setStatus("active")}
          />
          Active
        </label>
        <label className="inline-flex items-center gap-2">
          <input
            type="radio"
            name={id("status")}
            checked={status === "retired"}
            onChange={() => setStatus("retired")}
          />
          Retired
        </label>
        {retiring && (
          <p id={id("retiring")} className="mt-2 font-medium" data-testid={"text-retire-" + entry.sourceId}>
            {retireWarning(entry.restingVersions)}
          </p>
        )}
      </fieldset>
      <label className="text-sm font-medium" htmlFor={id("reason")}>
        {reasonLabel}
        <textarea
          id={id("reason")}
          className={inputStyle}
          rows={2}
          minLength={20}
          maxLength={1000}
          aria-describedby={id("reason-help")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <span id={id("reason-help")} className="mt-1 block font-normal text-muted-foreground">
          {reasonHint}
        </span>
      </label>
      <button
        type="submit"
        className="btn btn-primary btn-sm justify-self-start"
        disabled={busy || reason.trim().length < 20}
      >
        {busy ? "Saving…" : "Save a new version"}
      </button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

/**
 * The source register in the staff Content area (docs/architecture/source-register.md, slice 1): the
 * official sources Valo reads, as staff keep them, with each entry's earlier versions and its daily
 * check. Filing and correcting publish nothing and fetch nothing.
 */
export function SourceRegister() {
  const client = useQueryClient();
  const register = useListSourceRegister({ query: { retry: false } });
  const [open, setOpen] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function fileAll() {
    setBusy(true);
    setError("");
    try {
      client.setQueryData(getListSourceRegisterQueryKey(), await fileSourceRegister());
      setMessage("Filed the sources kept in the repository. Complete what each entry does not say yet.");
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="source-register-title">
      <h2 className="font-display text-2xl" id="source-register-title">
        {registerHeading}
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{registerIntro}</p>
      {register.isError ? (
        <ErrorState error={register.error} onRetry={() => void register.refetch()} />
      ) : !register.data ? (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Reading the register…
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm" data-testid="text-register-summary">
            {registerSummary(register.data.entries.length, register.data.unfiled)}
          </p>
          {register.data.unfiled > 0 && (
            <button
              type="button"
              className="btn btn-primary btn-sm mt-3 max-w-full whitespace-normal py-2 text-left"
              disabled={busy}
              onClick={() => void fileAll()}
              data-testid="button-file-register"
            >
              {busy ? "Filing…" : fileButton(register.data.unfiled)}
            </button>
          )}
          <p className="mt-2 text-sm" role="status" aria-live="polite">
            {message}
          </p>
          {error && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <ul className="mt-4 grid gap-3">
            {register.data.entries.map((entry) => (
              <li
                key={entry.sourceId}
                className="rounded-xl border border-border p-3 text-sm"
                data-testid={"register-entry-" + entry.sourceId}
              >
                <p className="font-medium">
                  {entry.title}{" "}
                  <span className="font-mono text-xs text-muted-foreground">{entry.sourceId}</span>
                </p>
                <p className="text-muted-foreground">
                  {entry.authority ?? `Who issues it: ${notKnown.toLowerCase()}`}
                </p>
                <p>{entryLine(entry)}</p>
                <p className="text-muted-foreground">{watchLine(entry.watch)}</p>
                {entry.restingVersions > 0 && (
                  <p className="text-muted-foreground">{restingLine(entry.restingVersions)}</p>
                )}
                {entry.status === "retired" && <p className="font-medium">{retiredNote}</p>}
                <p className="text-muted-foreground">{versionLine(entry)}</p>
                {entry.earlier.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer">Earlier versions</summary>
                    <ul className="mt-1 grid gap-1 text-muted-foreground">
                      {entry.earlier.map((version) => (
                        <li key={version.version}>{versionLine(version)}</li>
                      ))}
                    </ul>
                  </details>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm mt-2"
                  aria-expanded={open === entry.sourceId}
                  onClick={() => {
                    setMessage("");
                    setOpen(open === entry.sourceId ? "" : entry.sourceId);
                  }}
                >
                  {open === entry.sourceId ? "Close" : "Correct this entry"}
                </button>
                {open === entry.sourceId && (
                  <EntryForm
                    key={entry.version}
                    entry={entry}
                    jurisdictions={register.data.jurisdictions}
                    onSaved={(saved) => {
                      setOpen("");
                      setMessage(saved);
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
