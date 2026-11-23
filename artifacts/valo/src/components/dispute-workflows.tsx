import { useRef, useState } from "react";
import { useGetFinanceDispute, prepareFinanceDispute, holdFinanceDispute } from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { formatDateTime, formatNaira } from "@/lib/format";
import { InformationFacts, text, useDisputeDirty, wrapButton } from "./dispute-forms-boundary";
import { FinanceAction } from "./finance-dispute-action";

export { DisputeFormsBoundary, useDisputeDirty } from "./dispute-forms-boundary";
export { FinanceDisputeLink } from "./finance-dispute-action";
export { CustomerDisputeInformation } from "./customer-dispute-information";

export function FinanceDisputeCard({ id }: { id: string }) {
  const q = useGetFinanceDispute(id, { query: { refetchInterval: 30000 } });
  const [kind, setKind] = useState<"upload_receipt" | "submit_evidence" | "merchant_decision">(
    "upload_receipt",
  );
  const [resolution, setResolution] = useState<"" | "merchant-accepted" | "declined">("");
  const [amount, setAmount] = useState(""),
    [message, setMessage] = useState(""),
    [informationId, setInformationId] = useState("");
  const [holdReason, setHoldReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const keys = useRef(new Map<string, string>());
  useDisputeDirty(
    !!(message || amount || informationId || holdReason || kind !== "upload_receipt" || resolution),
  );
  async function run(fn: () => Promise<unknown>, reset = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      if (reset) {
        setMessage("");
        setAmount("");
        setInformationId("");
        setKind("upload_receipt");
        setResolution("");
        setNotice("Immutable intent saved. No provider operation has been sent.");
      }
      await q.refetch();
    } catch (e) {
      setError(
        describeError(e).message +
          " Reload the saved record before repeating an action whose outcome is unclear.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!q.data || (q.isError && [401, 403].includes(describeError(q.error).status ?? 0)))
    return (
      <div className="my-3 text-sm" role={q.isError ? "alert" : "status"}>
        <p>{q.isError ? describeError(q.error).message : "Loading scoped dispute…"}</p>
        {q.isError && (
          <button style={wrapButton} className="btn btn-secondary mt-2" onClick={() => void q.refetch()}>
            Reload dispute record
          </button>
        )}
      </div>
    );
  const d = q.data,
    uncertain = d.actions.some((a) => ["dispatching", "unknown", "needs_review"].includes(a.status));
  const canPrepare = !d.held && !uncertain && d.status === "awaiting-merchant-feedback";
  const selected = d.information.find((row) => String(row.id) === informationId);
  return (
    <article className="rounded-xl border p-4" aria-label={`Finance dispute ${d.providerId}`}>
      <h4 className="break-all font-semibold">Order {d.orderReference}</h4>
      <dl className="my-3 space-y-1 text-sm">
        <div>
          <dt className="font-medium">Canonical provider dispute</dt>
          <dd className="break-all">{d.providerId}</dd>
        </div>
        <div>
          <dt className="font-medium">Original payment</dt>
          <dd>{formatNaira(d.amountKobo)}</dd>
        </div>
        <div>
          <dt className="font-medium">Verified category</dt>
          <dd>{d.category ?? "Not yet classified"}</dd>
        </div>
        <div>
          <dt className="font-medium">Recorded template access</dt>
          <dd>{d.entitlementStatus ?? "Not recorded"}</dd>
        </div>
      </dl>
      <p className="my-2 text-sm">
        Provider state: {d.status}; reported resolution: {d.resolution ?? "not supplied"}. Neither is a
        confirmed bank outcome. Saved drafts and past downloads remain the customer’s work.
      </p>
      <p className="my-2 text-sm">{d.policy}</p>
      <p className="my-2 text-sm text-muted-foreground">
        Every action requires an active finance role and fresh MFA, checked by the server. No private draft
        bodies are available here.
      </p>
      {!d.executionEnabled && (
        <p role="status" className="my-2 text-sm font-semibold">
          Development merchant execution is disabled. You can prepare and review an intent; nothing will be
          uploaded or submitted.
        </p>
      )}
      <button
        style={wrapButton}
        type="button"
        className="btn btn-secondary my-3"
        disabled={busy}
        onClick={() => void q.refetch()}
      >
        Reload saved dispute record
      </button>
      {q.isError && (
        <p role="alert" className="my-2 text-sm">
          The latest refresh failed. {describeError(q.error).message}
        </p>
      )}
      <form
        className="my-4 border-y py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || holdReason.trim().length < 10) return;
          void run(async () => {
            await holdFinanceDispute(id, {
              expectedVersion: d.controlVersion,
              held: !d.held,
              reason: holdReason.trim(),
            });
            setHoldReason("");
          });
        }}
      >
        <p className="mb-2 text-sm font-medium">
          {d.held ? "Finance hold is active" : "No finance hold"} · Control revision {d.controlVersion}
        </p>
        <label className="block text-sm">
          Reason for changing the finance hold
          <textarea
            className="field my-1 w-full"
            required
            minLength={10}
            maxLength={1500}
            value={holdReason}
            disabled={busy}
            onChange={(e) => setHoldReason(e.target.value)}
          />
        </label>
        <p className="my-2 text-sm">
          A hold prevents new provider mutations. Releasing it does not send an action or restore template
          access.
        </p>
        <button
          style={wrapButton}
          className="btn btn-secondary"
          disabled={busy || holdReason.trim().length < 10}
        >
          {d.held ? "Release finance hold" : "Place finance hold"}
        </button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy || !canPrepare || message.trim().length < 10) return;
          let amountKobo = 0;
          if (kind === "merchant_decision") {
            if (!resolution) {
              setError("Choose an explicit merchant response.");
              return;
            }
            if (resolution === "merchant-accepted") {
              const match = /^(0|[1-9][0-9]{0,7})(?:\.([0-9]{1,2}))?$/.exec(amount);
              if (!match) {
                setError("Enter a positive NGN amount with at most two decimal places.");
                return;
              }
              const value = BigInt(match[1]!) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
              if (value <= 0n || value > BigInt(d.amountKobo)) {
                setError(
                  "The amount must be positive and cannot exceed the original payment. Existing reservations are also checked by the server.",
                );
                return;
              }
              amountKobo = Number(value);
            }
          }
          const input = {
            kind,
            message: message.trim(),
            ...(kind === "submit_evidence" ? { informationId } : {}),
            ...(kind === "merchant_decision"
              ? { resolution: resolution as "merchant-accepted" | "declined", amountKobo }
              : {}),
          };
          const fingerprint = JSON.stringify(input);
          if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
          void run(
            () => prepareFinanceDispute(id, { ...input, requestKey: keys.current.get(fingerprint)! }),
            true,
          );
        }}
      >
        <h5 className="mb-2 font-semibold">Prepare an immutable operation</h5>
        <label className="block text-sm">
          Operation
          <select
            className="field my-1 w-full"
            value={kind}
            disabled={busy}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="upload_receipt">Upload existing order receipt</option>
            <option value="submit_evidence">Submit customer-consented structured evidence</option>
            <option value="merchant_decision">Prepare merchant decision</option>
          </select>
        </label>
        {kind === "submit_evidence" && (
          <>
            <label className="block text-sm">
              Exact saved customer statement
              <select
                className="field my-1 w-full"
                required
                value={informationId}
                disabled={busy}
                onChange={(e) => setInformationId(e.target.value)}
              >
                <option value="">Choose a consented statement</option>
                {d.information.map((r) => (
                  <option key={String(r.id)} value={String(r.id)}>
                    {String(r.id)}
                  </option>
                ))}
              </select>
            </label>
            {!d.information.length && (
              <p className="my-2 text-sm">
                No customer-consented statements are saved. The customer must supply facts for this existing
                dispute; finance cannot invent them.
              </p>
            )}
            {selected && <InformationFacts row={selected} />}
          </>
        )}
        {kind === "merchant_decision" && (
          <>
            <label className="block text-sm">
              Merchant response
              <select
                className="field my-1 w-full"
                required
                value={resolution}
                disabled={busy}
                onChange={(e) => setResolution(e.target.value as typeof resolution)}
              >
                <option value="">Choose a response</option>
                <option value="merchant-accepted">Accept full or partial claim</option>
                <option value="declined">Decline with acknowledged evidence</option>
              </select>
            </label>
            {resolution === "merchant-accepted" && (
              <label className="block text-sm">
                Amount to accept in NGN
                <input
                  className="field my-1 w-full"
                  inputMode="decimal"
                  maxLength={12}
                  required
                  value={amount}
                  disabled={busy}
                  onChange={(e) => setAmount(e.target.value)}
                />
              </label>
            )}
          </>
        )}
        <label className="block text-sm">
          Accurate reason / provider message
          <textarea
            className="field my-1 w-full"
            required
            minLength={10}
            maxLength={1500}
            value={message}
            disabled={busy}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        <p className="my-2 text-sm">
          No invented delivery facts. Declines need an acknowledged receipt filename; fraud claims
          additionally need customer-consented structured evidence. Preparation sends nothing.
        </p>
        <button
          style={wrapButton}
          className="btn btn-secondary"
          disabled={busy || !canPrepare || message.trim().length < 10}
        >
          Prepare immutable intent only
        </button>
        {!canPrepare && (
          <p className="my-2 text-sm">
            Preparation is held while a prior action is uncertain, a finance hold is active, or the provider
            is not awaiting merchant feedback.
          </p>
        )}
      </form>
      {error && (
        <p role="alert" className="my-2 text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="my-2 text-sm">
          {notice}
        </p>
      )}
      {!d.actions.length ? (
        <p className="my-3 text-sm">No merchant operations prepared for this dispute.</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {d.actions.map((a) => (
            <FinanceAction
              key={`${a.id}:${a.version}:${d.controlVersion}:${d.held}`}
              action={a}
              dispute={d}
              busy={busy}
              run={run}
            />
          ))}
        </ul>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer py-1">Exact consented information and transition history</summary>
        <h5 className="my-3 font-semibold">Customer-consented statements</h5>
        {!d.information.length ? (
          <p>No statements saved.</p>
        ) : (
          <div className="space-y-3">
            {d.information.map((r, i) => (
              <InformationFacts key={text(r.id) ?? i} row={r} />
            ))}
          </div>
        )}
        <h5 className="my-3 font-semibold">Recorded transitions</h5>
        {!d.history?.length ? (
          <p>No transitions recorded.</p>
        ) : (
          <ol className="space-y-2">
            {d.history.map((r, i) => (
              <li key={text(r.id) ?? i} className="border-l pl-3">
                <p>
                  {text(r.status) ?? text(r.action) ?? "Recorded action"}
                  {text(r.createdAt) ? " · " + formatDateTime(String(r.createdAt)) : ""}
                </p>
                {text(r.reason) && <p className="whitespace-pre-wrap break-words">{text(r.reason)}</p>}
                {text(r.actionId) && (
                  <p className="break-all text-xs text-muted-foreground">Intent {text(r.actionId)}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </details>
    </article>
  );
}
