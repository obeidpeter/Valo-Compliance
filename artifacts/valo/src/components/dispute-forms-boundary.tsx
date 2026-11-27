import { createContext, useCallback, useContext, useEffect, useId, useRef, type ReactNode } from "react";
import type { DisputeActionRecord } from "@workspace/api-client-react";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { formatDateTime, formatNaira } from "@/lib/format";

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

export const wrapButton = { maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" } as const;
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
export const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : null;

const factLabels: Record<string, string> = {
  customer_email: "Verified account email",
  customer_name: "Customer name",
  customer_phone: "Customer phone",
  service_details: "Service or dispute details",
  delivery_address: "Delivery address",
  delivery_date: "Delivery date",
};

export function InformationFacts({ row }: { row: Record<string, unknown> }) {
  const facts = record(row.information);
  return (
    <article className="rounded-lg border p-3 text-sm">
      <p className="break-all font-medium">Statement {text(row.id) ?? "Reference unavailable"}</p>
      <p className="my-1 break-all">Selected dispute: {text(row.disputeId) ?? "Not supplied"}</p>
      {text(row.createdAt) && <p className="my-1">Saved {formatDateTime(String(row.createdAt))}</p>}
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

export function ActionFacts({ action }: { action: DisputeActionRecord }) {
  const payload = record(action.payload),
    result = record(action.result);
  const fields: [string, unknown][] = [
    ["Reason / provider message", payload.message],
    ["Merchant response", payload.resolution],
    ["Accepted amount", typeof payload.amountKobo === "number" ? formatNaira(payload.amountKobo) : null],
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
