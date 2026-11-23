import { useState } from "react";
import {
  controlFinanceDispute,
  linkFinanceDispute,
  type DisputeActionRecord,
  type FinanceDispute,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { ActionFacts, useDisputeDirty, wrapButton } from "./dispute-forms-boundary";

export function FinanceAction({
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
