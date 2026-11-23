import { useState } from "react";
import {
  decideOwnerRule,
  useListOwnerRules,
  watchOwnerRuleSources,
  type OwnerRuleCheckId,
  type OwnerRuleItem,
  type OwnerRuleSource,
} from "@workspace/api-client-react";
import { formatCount, formatDateTime, formatDay } from "@/lib/format";
import { describeError } from "@/lib/describe-error";
import { ErrorState } from "./states";

function sourceState(source: OwnerRuleSource) {
  if (!source.watched) return "Not watched by the daily source check yet.";
  if (!source.checkedAt) return "Watched. Waiting for its first check.";
  if (source.failure)
    return `The last check, ${formatDateTime(source.checkedAt)}, could not read it (${source.failure}).`;
  if (source.current) return `Checked ${formatDateTime(source.checkedAt)}.`;
  return `Last checked ${formatDateTime(source.checkedAt)}. No copy checked within the last day holds this passage.`;
}

const label = (value: string | null) => value ?? "Not shown";

/**
 * Requirements-checker rules on the development owner's sign-off (decision 0020). The owner reads a
 * prepared rule, its official sources and its scenarios, confirms each of the five checks, and signs
 * the exact version shown; or withdraws a released version.
 */
export function OwnerCheckerRules() {
  const result = useListOwnerRules({ query: { retry: false } });
  const [selected, setSelected] = useState("");
  const [checks, setChecks] = useState<OwnerRuleCheckId[]>([]);
  const [approval, setApproval] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const item = result.data?.items.find((row) => row.ruleId === selected);
  const key = item ? [item.ruleId, item.version, item.manifestHash].join("/") : "";
  function reset() {
    setChecks([]);
    setApproval("");
    setNotice("");
    setError("");
  }
  async function act(run: () => Promise<string>) {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const done = await run();
      setChecks([]);
      setApproval("");
      await result.refetch();
      setNotice(done);
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  const watch = (rule: OwnerRuleItem) =>
    act(async () => {
      await watchOwnerRuleSources(rule.ruleId, { watch: "official_sources" });
      return "The daily source check now watches these sources. It reads a newly watched source within a few minutes; reopen this page then.";
    });
  const sign = (rule: OwnerRuleItem) =>
    act(async () => {
      const saved = await decideOwnerRule(rule.ruleId, {
        action: "sign",
        version: rule.version,
        manifestHash: rule.manifestHash,
        confirmedChecks: checks,
        confirmed: true,
      });
      return `Version ${saved.version} is released. The checker uses it from now on.`;
    });
  const withdraw = (rule: OwnerRuleItem) =>
    act(async () => {
      if (!rule.live) return "";
      const saved = await decideOwnerRule(rule.ruleId, {
        action: "withdraw",
        version: rule.live.version,
        manifestHash: rule.live.manifestHash,
        confirmedChecks: [],
        confirmed: true,
      });
      return `Version ${saved.version} is withdrawn. The checker no longer uses it.`;
    });
  const allChecked = item ? item.checks.every((c) => checks.includes(c.id)) : false;
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="owner-rules-heading">
      <h2 className="font-display text-2xl" id="owner-rules-heading">
        Checker rule sign-off
      </h2>
      {result.isError ? (
        <ErrorState error={result.error} onRetry={() => result.refetch()} />
      ) : result.isPending ? (
        <p className="mt-4">Loading the prepared rules…</p>
      ) : !result.data.items.length ? (
        <p className="mt-4">
          No rule is prepared for your sign-off yet. A prepared rule appears here once it is added to Valo.
        </p>
      ) : (
        <>
          <label className="mt-4 block text-sm font-medium">
            Prepared rule
            <select
              className="mt-1 block w-full rounded-lg border border-border bg-background p-2"
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                reset();
              }}
              disabled={busy}
            >
              <option value="">Choose a rule</option>
              {result.data.items.map((row) => (
                <option key={row.ruleId} value={row.ruleId}>
                  {row.title} · version {row.version}
                  {row.live ? ` (version ${row.live.version} released)` : ""}
                </option>
              ))}
            </select>
          </label>
          {item && (
            <div className="mt-5 space-y-4">
              <h3 className="font-display text-xl">{item.title}</h3>
              <p>
                Version {item.version} to sign.{" "}
                {item.live ? `Version ${item.live.version} is released now.` : "No version is released yet."}
              </p>
              <dl className="grid gap-2">
                <div>
                  <dt className="font-semibold">When it applies</dt>
                  <dd>{item.appliesWhen}</dd>
                </div>
                <div>
                  <dt className="font-semibold">What it tells the customer</dt>
                  <dd>{item.reason}</dd>
                </div>
                <div>
                  <dt className="font-semibold">Next step it suggests</dt>
                  <dd>{item.nextStep}</dd>
                </div>
                <div>
                  <dt className="font-semibold">In force</dt>
                  <dd>
                    From {formatDay(item.validFrom)}
                    {item.validTo ? ` to ${formatDay(item.validTo)}` : ", with no end date"}
                  </dd>
                </div>
              </dl>
              <p className="text-sm text-muted-foreground">Shown with it: {item.disclosure}.</p>
              <section aria-label="Official sources">
                <h4 className="font-semibold">Official sources</h4>
                <ul className="mt-2 space-y-3">
                  {item.sources.map((s, i) => (
                    <li key={`${s.title}/${i}`}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                          {s.title}
                        </a>
                      ) : (
                        s.title
                      )}{" "}
                      · {s.locator}
                      <blockquote className="mt-1 border-l-2 border-border pl-3">{s.quote}</blockquote>
                      <p className="text-sm">{sourceState(s)}</p>
                    </li>
                  ))}
                </ul>
                {item.sources.some((s) => !s.watched) && (
                  <button
                    className="btn btn-ghost btn-sm mt-3"
                    disabled={busy}
                    onClick={() => void watch(item)}
                  >
                    Watch these sources
                  </button>
                )}
              </section>
              <section aria-label="Scenarios">
                <h4 className="font-semibold">Scenarios</h4>
                <table className="mt-2 w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th scope="col">Scenario</th>
                      <th scope="col">Expected</th>
                      <th scope="col">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {item.scenarios.map((s) => (
                      <tr key={s.id}>
                        <td>
                          {s.id}
                          {s.critical ? " (critical)" : ""}
                        </td>
                        <td>{label(s.expectedLabel)}</td>
                        <td>
                          {label(s.actualLabel)}
                          {s.passed ? "" : " · does not match"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-sm">
                  It would change the result for {formatCount(item.changedProfiles)} of the{" "}
                  {formatCount(item.profilesRun)} most recent saved checks.
                </p>
              </section>
              {item.holds.length > 0 ? (
                <section aria-label="What holds this rule">
                  <h4 className="font-semibold">What holds this rule</h4>
                  <ul className="list-disc pl-5">
                    {item.holds.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </section>
              ) : (
                <fieldset className="space-y-2">
                  <legend className="font-semibold">Confirm each check for version {item.version}</legend>
                  {item.checks.map((c) => (
                    <label key={c.id} className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={busy}
                        checked={checks.includes(c.id)}
                        onChange={(e) =>
                          setChecks(e.target.checked ? [...checks, c.id] : checks.filter((x) => x !== c.id))
                        }
                      />
                      {c.label}
                    </label>
                  ))}
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={busy || !allChecked}
                      checked={approval === key}
                      onChange={(e) => setApproval(e.target.checked ? key : "")}
                    />
                    I have read this rule version, its sources and its scenarios, and I sign it for release.
                  </label>
                  <button
                    className="btn btn-primary"
                    disabled={busy || !allChecked || approval !== key}
                    onClick={() => void sign(item)}
                  >
                    Sign and release version {item.version}
                  </button>
                </fieldset>
              )}
              {item.live && (
                <div className="space-y-2">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={approval === "withdraw/" + key}
                      onChange={(e) => setApproval(e.target.checked ? "withdraw/" + key : "")}
                    />
                    I want to withdraw released version {item.live.version}. Releasing the rule again takes a
                    new version and a new sign-off.
                  </label>
                  <button
                    className="btn btn-ghost"
                    disabled={busy || approval !== "withdraw/" + key}
                    onClick={() => void withdraw(item)}
                  >
                    Withdraw version {item.live.version}
                  </button>
                </div>
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
