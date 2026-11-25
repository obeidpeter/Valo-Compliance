import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  addSourceRegisterEntry,
  fileSourceRegister,
  getListSourceRegisterQueryKey,
  reviseSourceRegisterEntry,
  useListSourceRegister,
  type SourceRegister as RegisterData,
  type SourceRegisterEntry,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/describe-error";
import {
  addButton,
  addedByStaff,
  addedMessage,
  addHeading,
  entryLine,
  fileButton,
  hostsHint,
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
  watchNowLabel,
} from "@/lib/source-register";
import { ErrorState } from "./states";

const inputStyle = "mt-1 block w-full rounded-lg border border-border bg-background p-2 text-base";

type Instrument = "" | NonNullable<SourceRegisterEntry["instrument"]>;
/** The fields every version of an entry gives, as typed into a form. */
type Fields = {
  authority: string;
  jurisdiction: string;
  instrument: Instrument;
  versionInForce: string;
  effectiveFrom: string;
};
/** The fields as the register's routes take them. An official page has no day it took effect. */
const sent = (fields: Fields) => ({
  authority: fields.authority.trim() || null,
  jurisdiction: fields.jurisdiction,
  instrument: fields.instrument || null,
  versionInForce: fields.versionInForce.trim() || null,
  effectiveFrom: fields.instrument === "official_page" ? null : fields.effectiveFrom || null,
});

/** Who issues a source, where it applies, the kind of text, the version in force and its day. */
function VersionFields({
  prefix,
  value,
  onChange,
  jurisdictions,
}: {
  prefix: string;
  value: Fields;
  onChange: (next: Fields) => void;
  jurisdictions: string[];
}) {
  const id = (field: string) => `${prefix}-${field}`;
  return (
    <>
      <label className="text-sm font-medium" htmlFor={id("authority")}>
        Who issues it
        <input
          id={id("authority")}
          className={inputStyle}
          maxLength={200}
          value={value.authority}
          onChange={(e) => onChange({ ...value, authority: e.target.value })}
        />
      </label>
      <label className="text-sm font-medium" htmlFor={id("jurisdiction")}>
        Where it applies
        <select
          id={id("jurisdiction")}
          className={inputStyle}
          value={value.jurisdiction}
          onChange={(e) => onChange({ ...value, jurisdiction: e.target.value })}
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
          value={value.instrument}
          onChange={(e) => onChange({ ...value, instrument: e.target.value as Instrument })}
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
          value={value.versionInForce}
          onChange={(e) => onChange({ ...value, versionInForce: e.target.value })}
        />
      </label>
      {value.instrument !== "official_page" && (
        <label className="text-sm font-medium" htmlFor={id("effective")}>
          In effect from
          <input
            id={id("effective")}
            type="date"
            className={inputStyle}
            value={value.effectiveFrom}
            onChange={(e) => onChange({ ...value, effectiveFrom: e.target.value })}
          />
        </label>
      )}
    </>
  );
}

/** Why a version is recorded, with its hint. */
function ReasonField({
  prefix,
  value,
  onChange,
}: {
  prefix: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const id = (field: string) => `${prefix}-${field}`;
  return (
    <label className="text-sm font-medium" htmlFor={id("reason")}>
      {reasonLabel}
      <textarea
        id={id("reason")}
        className={inputStyle}
        rows={2}
        minLength={20}
        maxLength={1000}
        aria-describedby={id("reason-help")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span id={id("reason-help")} className="mt-1 block font-normal text-muted-foreground">
        {reasonHint}
      </span>
    </label>
  );
}

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
  const [fields, setFields] = useState<Fields>({
    authority: entry.authority ?? "",
    jurisdiction: entry.jurisdiction,
    instrument: entry.instrument ?? "",
    versionInForce: entry.versionInForce ?? "",
    effectiveFrom: entry.effectiveFrom ?? "",
  });
  const [status, setStatus] = useState(entry.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prefix = `register-${entry.sourceId}`;
  const id = (field: string) => `${prefix}-${field}`;
  // Retiring an active source stops its daily check and holds what rests on it: say so before saving.
  const retiring = status === "retired" && entry.status !== "retired";
  async function save() {
    setBusy(true);
    setError("");
    try {
      const register = await reviseSourceRegisterEntry(entry.sourceId, {
        baseVersion: entry.version,
        ...sent(fields),
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
      <VersionFields prefix={prefix} value={fields} onChange={setFields} jurisdictions={jurisdictions} />
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
      <ReasonField prefix={prefix} value={reason} onChange={setReason} />
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
 * The form for a source staff add (docs/architecture/source-register.md, slice 2): its title, its https
 * address on a host the guidance policy lists, its fields and why, and whether its daily check starts.
 */
function AddSourceForm({
  register,
  onAdded,
}: {
  register: RegisterData;
  onAdded: (message: string) => void;
}) {
  const client = useQueryClient();
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [fields, setFields] = useState<Fields>({
    authority: "",
    jurisdiction: "Nigeria",
    instrument: "",
    versionInForce: "",
    effectiveFrom: "",
  });
  const [reason, setReason] = useState("");
  const [watch, setWatch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prefix = "register-new";
  const id = (field: string) => `${prefix}-${field}`;
  async function add() {
    setBusy(true);
    setError("");
    try {
      const before = new Set(register.entries.map((entry) => entry.sourceId));
      const next = await addSourceRegisterEntry({
        title: title.trim(),
        url: url.trim(),
        ...sent(fields),
        reason: reason.trim(),
        watch,
      });
      client.setQueryData(getListSourceRegisterQueryKey(), next);
      const added = next.entries.find((entry) => !before.has(entry.sourceId));
      onAdded(added ? addedMessage(added.title, added.sourceId) : "Added the source to the register.");
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
        void add();
      }}
      data-testid="form-register-new"
    >
      <label className="text-sm font-medium" htmlFor={id("title")}>
        Title
        <input
          id={id("title")}
          className={inputStyle}
          maxLength={300}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      <label className="text-sm font-medium" htmlFor={id("url")}>
        Address
        <input
          id={id("url")}
          type="url"
          className={inputStyle}
          maxLength={2000}
          aria-describedby={id("url-help")}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <span id={id("url-help")} className="mt-1 block font-normal text-muted-foreground">
          {hostsHint(register.hosts)}
        </span>
      </label>
      <VersionFields
        prefix={prefix}
        value={fields}
        onChange={setFields}
        jurisdictions={register.jurisdictions}
      />
      <ReasonField prefix={prefix} value={reason} onChange={setReason} />
      <label className="inline-flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" checked={watch} onChange={(e) => setWatch(e.target.checked)} />
        {watchNowLabel}
      </label>
      <button
        type="submit"
        className="btn btn-primary btn-sm justify-self-start"
        disabled={busy || !title.trim() || !url.trim() || reason.trim().length < 20}
      >
        {busy ? "Adding…" : addButton}
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
 * The source register in the staff Content area (docs/architecture/source-register.md): the official
 * sources Valo reads, as staff keep them, with each entry's earlier versions and its daily check. Filing,
 * adding and correcting publish nothing; an added source is fetched only by the daily check.
 */
export function SourceRegister() {
  const client = useQueryClient();
  const register = useListSourceRegister({ query: { retry: false } });
  const [open, setOpen] = useState("");
  const [adding, setAdding] = useState(false);
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
          <button
            type="button"
            className="btn btn-ghost btn-sm mt-2"
            aria-expanded={adding}
            onClick={() => {
              setMessage("");
              setAdding(!adding);
            }}
          >
            {adding ? "Close" : addHeading}
          </button>
          {adding && (
            <AddSourceForm
              register={register.data}
              onAdded={(added) => {
                setAdding(false);
                setMessage(added);
              }}
            />
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
                  {entry.origin === "staff" && (
                    <span className="ml-2 text-xs text-muted-foreground">{addedByStaff}</span>
                  )}
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
