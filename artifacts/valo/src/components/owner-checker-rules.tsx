import { useState, type ReactNode } from "react";
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
import { FIGURE_LABELS } from "@/lib/result-words";
import { ErrorState } from "./states";

function sourceState(source: OwnerRuleSource) {
  if (!source.watched) return "Not watched by the daily source check yet.";
  if (!source.checkedAt) return "Watched. Waiting for its first check.";
  if (source.failure)
    return `The last check, ${formatDateTime(source.checkedAt)}, could not read it (${source.failure}).`;
  if (source.current) return `Checked ${formatDateTime(source.checkedAt)}.`;
  return `Last checked ${formatDateTime(source.checkedAt)}. No copy checked within the last day holds its passage.`;
}

const label = (value: string | null) => value ?? "Not shown";
const list = (items: string[], empty: string) => (items.length ? items.join("; ") : empty);

/** The evidence the owner reads before confirming one check (decision 0020, point 4). */
function checkEvidence(id: OwnerRuleCheckId, rule: OwnerRuleItem): ReactNode {
  if (id === "controlling_text")
    return rule.sources.map((s, i) => (
      <details key={i} className="mt-1">
        <summary className="cursor-pointer">
          {s.title}: {s.recordedLocator ?? s.locator}
        </summary>
        {s.passage ? (
          <p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3 text-sm">{s.passage}</p>
        ) : (
          <p className="mt-1 text-sm">Today's copy does not hold this passage.</p>
        )}
      </details>
    ));
  if (id === "amendments")
    return rule.sources.map((s, i) => (
      <div key={i} className="mt-1 text-sm">
        <p className="font-medium">{s.title}</p>
        {s.amendments ? (
          <ul className="list-disc pl-5">
            <li>
              Searched for later amendments{" "}
              {s.amendments.searchedAt ? formatDay(s.amendments.searchedAt) : "never"}:{" "}
              {list(s.amendments.places, "no place recorded")}.
            </li>
            <li>Amending texts read: {list(s.amendments.read, "none")}.</li>
            <li>Not yet read: {list(s.amendments.notRead, "none")}.</li>
            <li>Open questions: {list(s.amendments.open, "none")}.</li>
            <li>What the record does not cover: {s.amendments.limits}</li>
          </ul>
        ) : (
          <p>No amendment record is held for this text.</p>
        )}
      </div>
    ));
  if (id === "effective_dates")
    return (
      <ul className="mt-1 list-disc pl-5 text-sm">
        {rule.sources.map((s, i) => (
          <li key={i}>
            {s.title}: in force from {s.effectiveFrom ? formatDay(s.effectiveFrom) : "an unknown date"}.
          </li>
        ))}
        <li>
          The rule: from {formatDay(rule.validFrom)}
          {rule.validTo ? ` to ${formatDay(rule.validTo)}` : ", with no end date"}.
        </li>
      </ul>
    );
  if (id === "exceptions")
    return (
      <ul className="mt-1 list-disc pl-5 text-sm">
        <li>What it covers: {rule.scope}</li>
        <li>Its limits: {rule.limitations}</li>
        <li>What it assumes: {list(rule.assumptions, "nothing recorded")}.</li>
        <li>Each passage's own exceptions are in its text, under the first check.</li>
      </ul>
    );
  return <p className="mt-1 text-sm">{rule.jurisdiction}</p>;
}

/**
 * Requirements-checker rules on the development owner's sign-off (decision 0020). The owner reads a
 * prepared rule, its official sources, the evidence for each of the five checks and its scenarios,
 * confirms each check, and signs the exact version shown; or withdraws a released version.
 */
export function OwnerCheckerRules() {
  const result = useListOwnerRules({ query: { retry: false } });
  const [selected, setSelected] = useState("");
  const [checks, setChecks] = useState<OwnerRuleCheckId[]>([]);
  const [approval, setApproval] = useState("");
  // docs/architecture/rule-changes.md: why a released version is withdrawn, or what changed in the
  // version that replaces it.
  const [changeReason, setChangeReason] = useState("");
  const [withdrawReason, setWithdrawReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const item = result.data?.items.find((row) => row.ruleId === selected);
  const key = item ? [item.ruleId, item.version, item.manifestHash].join("/") : "";
  function reset() {
    setChecks([]);
    setApproval("");
    setChangeReason("");
    setWithdrawReason("");
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
      setChangeReason("");
      setWithdrawReason("");
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
        ...(rule.live && { reason: changeReason.trim() }),
      });
      return `Version ${saved.version} is released. The requirements check uses it from now on.`;
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
        reason: withdrawReason.trim(),
      });
      return `Version ${saved.version} is withdrawn. The requirements check no longer uses it.`;
    });
  const allChecked = item ? item.checks.every((c) => checks.includes(c.id)) : false;
  const signable = Boolean(item && !item.holds.length);
  const reasoned = (text: string) => text.trim().length >= 20;
  return (
    <section className="surface mt-8 p-5 sm:p-7" aria-labelledby="owner-rules-heading">
      <h2 className="font-display text-2xl" id="owner-rules-heading">
        Requirements check: rule sign-off
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
                {item.reason === null || item.nextStep === null ? (
                  <div>
                    <dt className="font-semibold">What it tells the customer</dt>
                    <dd>
                      It depends on their answers. Each scenario below shows what the requirements check would
                      tell the customer, and the next step it would suggest.
                    </dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt className="font-semibold">What it tells the customer</dt>
                      <dd>{item.reason}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold">Next step it suggests</dt>
                      <dd>{item.nextStep}</dd>
                    </div>
                  </>
                )}
                {/* docs/architecture/results.md: where the customer is sent, and each figure, as signed. */}
                <div>
                  <dt className="font-semibold">Official page it links</dt>
                  <dd>
                    {item.officialRoute ? (
                      <a
                        href={item.officialRoute.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline"
                      >
                        {item.officialRoute.authority}
                      </a>
                    ) : (
                      "None. The result links the Corporate Affairs Commission's service page."
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold">Fees, deadlines, rates and thresholds</dt>
                  <dd>
                    {item.figures?.length ? (
                      <ul className="space-y-1">
                        {item.figures.map((figure, index) => (
                          <li key={index}>
                            {FIGURE_LABELS[figure.kind]}: {figure.words} ({figure.source})
                          </li>
                        ))}
                      </ul>
                    ) : (
                      "None recorded. The customer is told to confirm them with the authority."
                    )}
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
                <ul className="mt-2 space-y-3">
                  {item.scenarios.map((s) => (
                    <li key={s.id} className="rounded-lg border border-border p-3 text-sm">
                      <p className="font-medium">
                        {s.id}
                        {s.critical ? " (critical)" : ""}
                      </p>
                      <p>
                        Expected: {label(s.expectedLabel)}. Result: {label(s.actualLabel)}
                        {s.passed ? "." : " · does not match."}
                      </p>
                      {s.actualReason !== null && (
                        <p className="mt-1">What the customer is told: {s.actualReason}</p>
                      )}
                      {s.actualNextStep !== null && <p>Next step: {s.actualNextStep}</p>}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm">
                  It would change the result for {formatCount(item.changedProfiles)} of the{" "}
                  {formatCount(item.profilesRun)} most recent saved checks.
                </p>
              </section>
              {item.holds.length > 0 && (
                <section aria-label="What holds this rule">
                  <h4 className="font-semibold">What holds this rule</h4>
                  <ul className="list-disc pl-5">
                    {item.holds.map((h) => (
                      <li key={h}>{h}</li>
                    ))}
                  </ul>
                </section>
              )}
              <fieldset className="space-y-3">
                <legend className="font-semibold">The five checks for version {item.version}</legend>
                {item.checks.map((c) => (
                  <div key={c.id}>
                    {signable ? (
                      <label className="flex items-start gap-2">
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
                    ) : (
                      <p>{c.label}</p>
                    )}
                    <div className="ml-6">{checkEvidence(c.id, item)}</div>
                  </div>
                ))}
                {signable && (
                  <>
                    {item.live && (
                      <div className="grid gap-1">
                        <label className="text-sm font-medium" htmlFor="owner-rule-change-reason">
                          What changed in this version?
                        </label>
                        <p id="owner-rule-change-reason-help" className="text-sm text-muted-foreground">
                          Version {item.version} replaces released version {item.live.version}. Valo records
                          what you write with the release, in 20 to 1,000 characters.
                        </p>
                        <textarea
                          id="owner-rule-change-reason"
                          className="field min-h-24"
                          aria-describedby="owner-rule-change-reason-help"
                          minLength={20}
                          maxLength={1000}
                          required
                          disabled={busy}
                          value={changeReason}
                          onChange={(e) => setChangeReason(e.target.value)}
                        />
                      </div>
                    )}
                    <label className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        disabled={busy || !allChecked}
                        checked={approval === key}
                        onChange={(e) => setApproval(e.target.checked ? key : "")}
                      />
                      I have read this rule version, its sources, the evidence for each check and its
                      scenarios, and I sign it for release.
                    </label>
                    <button
                      className="btn btn-primary"
                      disabled={
                        busy ||
                        !allChecked ||
                        approval !== key ||
                        (Boolean(item.live) && !reasoned(changeReason))
                      }
                      onClick={() => void sign(item)}
                    >
                      Sign and release version {item.version}
                    </button>
                  </>
                )}
              </fieldset>
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
                  {approval === "withdraw/" + key && (
                    <div className="grid gap-1">
                      <label className="text-sm font-medium" htmlFor="owner-rule-withdraw-reason">
                        Why is this rule withdrawn?
                      </label>
                      <p id="owner-rule-withdraw-reason-help" className="text-sm text-muted-foreground">
                        The requirements check stops using version {item.live.version} at once. Valo records
                        what you write with the withdrawal, in 20 to 1,000 characters.
                      </p>
                      <textarea
                        id="owner-rule-withdraw-reason"
                        className="field min-h-24"
                        aria-describedby="owner-rule-withdraw-reason-help"
                        minLength={20}
                        maxLength={1000}
                        required
                        disabled={busy}
                        value={withdrawReason}
                        onChange={(e) => setWithdrawReason(e.target.value)}
                      />
                    </div>
                  )}
                  <button
                    className="btn btn-ghost"
                    disabled={busy || approval !== "withdraw/" + key || !reasoned(withdrawReason)}
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
