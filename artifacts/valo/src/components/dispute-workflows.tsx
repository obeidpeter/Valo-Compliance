import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useGetFinanceDispute,
  prepareFinanceDispute,
  controlFinanceDispute,
  useGetOrderDisputeInformation,
  saveOrderDisputeInformation,
  holdFinanceDispute,
  linkFinanceDispute,
  type DisputeActionRecord,
  type FinanceDispute,
} from "@workspace/api-client-react";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { describeError, formatDate } from "@/lib/api";

const DirtyContext = createContext<((id: string, dirty: boolean) => void) | null>(null);
export function useDisputeDirty(dirty: boolean) {
  const register = useContext(DirtyContext),
    id = useId();
  useEffect(() => {
    register?.(id, dirty);
    return () => register?.(id, false);
  }, [register, id, dirty]);
}
export function DisputeFormsBoundary({ children }: { children: ReactNode }) {
  const flags = useRef(new Map<string, boolean>()),
    title = useId();
  const register = useCallback((id: string, dirty: boolean) => {
    if (dirty) flags.current.set(id, true);
    else flags.current.delete(id);
  }, []);
  const nav = useUnsavedNavigation(() => [...flags.current.values()].some(Boolean)),
    ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (nav.blocked && !ref.current?.open) ref.current?.showModal();
    else if (!nav.blocked) ref.current?.close();
  }, [nav.blocked]);
  return (
    <DirtyContext.Provider value={register}>
      {children}
      <dialog
        ref={ref}
        className="max-w-md rounded-2xl border bg-background p-6 text-foreground"
        onCancel={(e) => {
          e.preventDefault();
          nav.stay();
        }}
        aria-labelledby={title}
      >
        <h3 id={title} className="font-display text-xl">
          Unsaved dispute information
        </h3>
        <p className="my-3">Keep editing to save first, or deliberately discard these entries.</p>
        <button autoFocus className="btn btn-primary mr-2" onClick={() => nav.stay()}>
          Keep editing
        </button>
        <button className="btn btn-secondary" onClick={() => nav.proceed()}>
          Discard and leave
        </button>
      </dialog>
    </DirtyContext.Provider>
  );
}
const wrapButton = { maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" } as const;
const money = (value: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(value / 100);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;
const factLabels: Record<string, string> = {
  customer_email: "Verified account email",
  customer_name: "Customer name",
  customer_phone: "Customer phone",
  service_details: "Service or dispute details",
  delivery_address: "Delivery address",
  delivery_date: "Delivery date",
};
function InformationFacts({ row }: { row: Record<string, unknown> }) {
  const facts = record(row.information);
  return (
    <article className="rounded-lg border p-3 text-sm">
      <p className="break-all font-medium">Statement {text(row.id) ?? "Reference unavailable"}</p>
      <p className="my-1 break-all">Selected dispute: {text(row.disputeId) ?? "Not supplied"}</p>
      {text(row.createdAt) && <p className="my-1">Saved {formatDate(String(row.createdAt))}</p>}
      <p className="my-1">Consent version: {text(row.consentVersion) ?? "Not supplied"}</p>
      <dl className="space-y-2">
        {Object.entries(factLabels).map(([key, label]) =>
          text(facts[key]) !== null ? (
            <div key={key}>
              <dt className="font-medium">{label}</dt>
              <dd className="whitespace-pre-wrap break-words">{text(facts[key])}</dd>
            </div>
          ) : null,
        )}
      </dl>
    </article>
  );
}
function ActionFacts({ action }: { action: DisputeActionRecord }) {
  const payload = record(action.payload),
    result = record(action.result);
  const fields: [string, unknown][] = [
    ["Reason / provider message", payload.message],
    ["Merchant response", payload.resolution],
    ["Accepted amount", typeof payload.amountKobo === "number" ? money(payload.amountKobo) : null],
    ["Saved upload reference", payload.uploadedFilename],
    ["Saved evidence reference", payload.evidenceId],
    ["Provider file reference", result.filename],
    ["Provider evidence reference", result.evidenceId],
    ["Receipt checksum", result.attemptChecksum ?? result.checksum],
    ["Canonical observation", result.observation],
    ["Observed provider state", result.status],
    ["Observed merchant response", result.resolution],
    ["Observed refund amount (kobo)", result.refundAmountKobo],
    ["Provider updated time", result.providerUpdatedAt],
    ["Canonical evidence hash", result.canonicalHash],
  ];
  return (
    <dl className="my-2 space-y-2">
      {fields.map(([label, value]) =>
        text(value) !== null ? (
          <div key={label}>
            <dt className="font-medium">{label}</dt>
            <dd className="whitespace-pre-wrap break-all">{text(value)}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}
function FinanceAction({
  action,
  dispute,
  busy,
  run,
}: {
  action: DisputeActionRecord;
  dispute: FinanceDispute;
  busy: boolean;
  run: (fn: () => Promise<unknown>, reset?: boolean) => Promise<void>;
}) {
  const [ack, setAck] = useState(false);
  useDisputeDirty(ack);
  const uncertain = dispute.actions.some((a) =>
    ["dispatching", "unknown", "needs_review"].includes(a.status),
  );
  const actionable = dispute.status === "awaiting-merchant-feedback" && !dispute.held && !uncertain;
  return (
    <li className="rounded-lg border p-3 text-sm">
      <h5 className="font-semibold">
        {action.kind.replaceAll("_", " ")} · {action.status.replaceAll("_", " ")}
      </h5>
      <p className="my-1 break-all">
        Intent {action.id} · Local attempts {action.attempts} · Revision {action.version}
      </p>
      <ActionFacts action={action} />
      {action.status === "unknown" && (
        <p role="status" className="my-2">
          The provider outcome is unknown. This operation cannot be sent again. Fetching canonical state may
          leave it unresolved for manual finance review.
        </p>
      )}
      {action.status === "observed" && (
        <p role="status" className="my-2">
          The canonical record shows a matching financial effect. This is not a receipt for the original
          transmission or a confirmed bank verdict or credit.
        </p>
      )}
      {action.status === "acknowledged" && (
        <p className="my-2">
          A provider acknowledgement is recorded. It does not establish a final bank outcome or a credit
          reaching the customer.
        </p>
      )}
      {action.failure && (
        <p role="status" className="my-2">
          {action.failure.replaceAll("_", " ")}. An unknown result will not be automatically sent again.
        </p>
      )}
      {action.status === "prepared" && (
        <label className="my-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={ack}
            disabled={busy || !dispute.executionEnabled || !actionable}
            onChange={(e) => setAck(e.target.checked)}
          />
          I have reviewed this exact saved intent and authorise this one test provider operation. Preparation
          alone sends nothing.
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {action.status === "prepared" && (
          <>
            <button
              style={wrapButton}
              type="button"
              className="btn btn-secondary"
              disabled={busy || !dispute.executionEnabled || !actionable || !ack}
              onClick={() =>
                void run(() =>
                  controlFinanceDispute(action.id, "execute", {
                    expectedVersion: action.version,
                    acknowledgement: true,
                  }),
                ).then(() => setAck(false))
              }
            >
              Send authorised test action once
            </button>
            <button
              style={wrapButton}
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() =>
                void run(() =>
                  controlFinanceDispute(action.id, "cancel", { expectedVersion: action.version }),
                )
              }
            >
              Cancel unsent intent
            </button>
          </>
        )}
        {action.attempts > 0 && (
          <button
            style={wrapButton}
            type="button"
            className="btn btn-secondary"
            disabled={busy || !dispute.executionEnabled}
            onClick={() =>
              void run(() =>
                controlFinanceDispute(action.id, "reconcile", { expectedVersion: action.version }),
              )
            }
          >
            Fetch canonical state only
          </button>
        )}
      </div>
      {action.status === "prepared" && !actionable && (
        <p className="my-2">
          Dispatch is held while this dispute has a finance hold, an uncertain operation, or is not awaiting
          merchant feedback.
        </p>
      )}
    </li>
  );
}
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
          <dd>{money(d.amountKobo)}</dd>
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
              const value = BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
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
                  {text(r.createdAt) ? " · " + formatDate(String(r.createdAt)) : ""}
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
export function FinanceDisputeLink({ onLinked }: { onLinked: (id: string) => Promise<unknown> }) {
  const [orderId, setOrderId] = useState(""),
    [providerId, setProviderId] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useDisputeDirty(!!(orderId || providerId));
  return (
    <details className="my-4 rounded-xl border p-3">
      <summary className="cursor-pointer py-1 font-semibold">Link an existing test provider dispute</summary>
      <p className="my-3 text-sm">
        Check a canonical provider record against an exact saved order. This does not create a bank dispute.
        Test merchant configuration is required; no live transaction should be supplied.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (busy) return;
          setBusy(true);
          setError("");
          void linkFinanceDispute({ orderId: orderId.trim(), providerId: providerId.trim() })
            .then(async (d) => {
              setOrderId("");
              setProviderId("");
              await onLinked(d.id);
            })
            .catch((e) => setError(describeError(e).message))
            .finally(() => setBusy(false));
        }}
      >
        <label className="block text-sm">
          Saved order ID
          <input
            className="field my-1 w-full"
            required
            pattern="[0-9a-fA-F-]{36}"
            maxLength={36}
            value={orderId}
            disabled={busy}
            onChange={(e) => setOrderId(e.target.value)}
          />
        </label>
        <label className="block text-sm">
          Existing test provider dispute ID
          <input
            className="field my-1 w-full"
            required
            inputMode="numeric"
            pattern="[0-9]{1,40}"
            maxLength={40}
            value={providerId}
            disabled={busy}
            onChange={(e) => setProviderId(e.target.value)}
          />
        </label>
        <button style={wrapButton} className="btn btn-secondary" disabled={busy}>
          {busy ? "Checking canonical record…" : "Check and link canonical dispute"}
        </button>
      </form>
      {error && (
        <p role="alert" className="my-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </details>
  );
}
export function CustomerDisputeInformation({ orderId }: { orderId: string }) {
  const q = useGetOrderDisputeInformation(orderId),
    keys = useRef(new Map<string, string>());
  const [disputeId, setDispute] = useState(""),
    [name, setName] = useState(""),
    [phone, setPhone] = useState(""),
    [details, setDetails] = useState("");
  const [address, setAddress] = useState(""),
    [date, setDate] = useState(""),
    [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useDisputeDirty(!!(disputeId || name || phone || details || address || date || consent));
  if (!q.data || (q.isError && [401, 403].includes(describeError(q.error).status ?? 0)))
    return (
      <div className="my-3 text-sm" role={q.isError ? "alert" : "status"}>
        <p>{q.isError ? describeError(q.error).message : "Loading your dispute information…"}</p>
        {q.isError && (
          <button style={wrapButton} className="btn btn-secondary mt-2" onClick={() => void q.refetch()}>
            Reload saved statements
          </button>
        )}
      </div>
    );
  return (
    <section className="my-4 rounded-xl border p-3">
      <h4 className="font-semibold">Information for an existing bank dispute</h4>
      <p className="my-2 text-sm">{q.data.notice}</p>
      {!q.data.disputes.length ? (
        <p className="my-2 text-sm">
          No existing bank dispute is recorded for this order. You can still save a payment concern for Valo
          below.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (busy || !consent) return;
            setBusy(true);
            setError("");
            setSaved(false);
            const input = {
              disputeId,
              customerName: name.trim(),
              customerPhone: phone.trim(),
              serviceDetails: details.trim(),
              ...(address.trim() ? { deliveryAddress: address.trim() } : {}),
              ...(date ? { deliveryDate: date } : {}),
              consentVersion: "test-dispute-information-v1" as const,
            };
            const fingerprint = JSON.stringify(input);
            if (!keys.current.has(fingerprint)) keys.current.set(fingerprint, crypto.randomUUID());
            void saveOrderDisputeInformation(orderId, {
              ...input,
              requestKey: keys.current.get(fingerprint)!,
            })
              .then(async () => {
                setDispute("");
                setName("");
                setPhone("");
                setDetails("");
                setAddress("");
                setDate("");
                setConsent(false);
                setSaved(true);
                await q.refetch();
              })
              .catch((e) => setError(describeError(e).message))
              .finally(() => setBusy(false));
          }}
        >
          <label className="block text-sm">
            Selected existing bank dispute
            <select
              className="field my-1 w-full"
              value={disputeId}
              required
              disabled={busy}
              onChange={(e) => setDispute(e.target.value)}
            >
              <option value="">Choose the matching dispute</option>
              {q.data.disputes.map((d) => (
                <option key={String(d.id)} value={String(d.id)}>
                  {String(d.id)} — {String(d.status)}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Your actual name
            <input
              className="field my-1 w-full"
              value={name}
              required
              maxLength={150}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Your actual phone number
            <input
              className="field my-1 w-full"
              value={phone}
              required
              minLength={5}
              maxLength={40}
              disabled={busy}
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            What was actually supplied or disputed
            <textarea
              className="field my-1 w-full"
              required
              minLength={10}
              maxLength={2000}
              value={details}
              disabled={busy}
              onChange={(e) => setDetails(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Actual delivery address, only if relevant
            <input
              className="field my-1 w-full"
              value={address}
              maxLength={500}
              disabled={busy}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>
          <label className="block text-sm">
            Actual delivery date, only if known
            <input
              type="date"
              className="field my-1 w-full"
              value={date}
              disabled={busy}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label className="my-3 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={consent}
              disabled={busy}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to finance sharing these exact facts and my verified account email with Paystack for
            this selected dispute.
          </label>
          <button style={wrapButton} className="btn btn-secondary" disabled={busy || !consent}>
            {busy ? "Saving statement…" : "Save statement — not a bank decision"}
          </button>
        </form>
      )}
      {error && (
        <p role="alert" className="my-2 text-destructive">
          {error} Reload the saved statements before repeating an uncertain submission.
        </p>
      )}
      {saved && (
        <p role="status" className="my-2 text-sm">
          Statement saved for this existing dispute. It has not been sent to the provider.
        </p>
      )}
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer py-1">Saved statements</summary>
        {!q.data.information.length ? (
          <p className="my-2">No statements saved.</p>
        ) : (
          <div className="my-2 space-y-3">
            {q.data.information.map((r, i) => (
              <InformationFacts key={text(r.id) ?? i} row={r} />
            ))}
          </div>
        )}
      </details>
    </section>
  );
}
