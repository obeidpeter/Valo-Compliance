import { useRef, useState } from "react";
import {
  useGetStaffRoleAdministration,
  verifyStaffRoleTarget,
  changeStaffRole,
  type StaffRoleChangeInput,
  type StaffRoleAssignment,
} from "@workspace/api-client-react";
import { describeError } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
const roles = ["content", "support", "finance", "system", "privacy"] as const;
export function StaffRoleAdministration() {
  const [identityId, setIdentityId] = useState(""),
    [role, setRole] = useState<StaffRoleAssignment["role"]>("support");
  const params = /^user_[A-Za-z0-9_-]+$/.test(identityId) ? { identityId } : undefined;
  const q = useGetStaffRoleAdministration(params, { query: { retry: false, refetchInterval: 15000 } });
  const [action, setAction] = useState<"grant" | "revoke">("grant"),
    [mode, setMode] = useState<"permanent" | "break_glass">("break_glass");
  const [minutes, setMinutes] = useState("15"),
    [reason, setReason] = useState(""),
    [incident, setIncident] = useState("");
  const [verified, setVerified] = useState<Awaited<ReturnType<typeof verifyStaffRoleTarget>> | null>(null);
  const [ackFor, setAckFor] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [pending, setPending] = useState<StaffRoleChangeInput | null>(null),
    sending = useRef(false);
  const existing = q.data?.assignments.find((r) => r.identityId === identityId && r.role === role);
  const expectedVersion = existing?.version ?? 0;
  const instructions = {
    identityId,
    role,
    action,
    expectedVersion,
    reason: reason.trim(),
    ...(action === "grant"
      ? {
          grantMode: mode,
          ...(mode === "break_glass"
            ? { durationMinutes: Number(minutes), incidentReference: incident.trim() }
            : {}),
        }
      : {}),
  };
  const fingerprint = JSON.stringify(instructions),
    confirmed = ackFor === fingerprint;
  const effective = (r: StaffRoleAssignment) =>
    r.active && (!r.expiresAt || Date.parse(r.expiresAt) > Date.now());
  async function verify() {
    if (busy || pending) return;
    setBusy(true);
    setError("");
    setVerified(null);
    try {
      setVerified(await verifyStaffRoleTarget({ identityId }));
    } catch (e) {
      setError(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (sending.current || (!pending && !confirmed)) return;
    sending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    const body =
      pending ??
      ({ ...instructions, requestKey: crypto.randomUUID(), acknowledgement: true } as StaffRoleChangeInput);
    setPending(body);
    try {
      const receipt = await changeStaffRole(body);
      setPending(null);
      setAckFor("");
      setReason("");
      setVerified(null);
      setNotice(`Role change saved: ${receipt.action} ${receipt.role}. Audit reference ${receipt.id}.`);
      await q.refetch();
    } catch (e) {
      const detail = describeError(e);
      setError(
        detail.message +
          (detail.status && detail.status < 500
            ? " Review the current assignment before creating a new change."
            : " The saved outcome may be unknown. Retry the exact same request below; no automatic retry occurs."),
      );
      if (detail.status && detail.status < 500) setPending(null);
      await q.refetch();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  if (q.isLoading) return <p role="status">Loading staff permissions…</p>;
  if (q.isError)
    return (
      <section className="mt-6 rounded-xl border p-4">
        <h2 className="font-semibold">Staff permission administration</h2>
        <p role="alert" className="my-3">
          {describeError(q.error).message}
        </p>
        <button className="btn btn-secondary" onClick={() => void q.refetch()}>
          Reload staff permissions
        </button>
      </section>
    );
  if (!q.data) return null;
  return (
    <section className="mt-6 space-y-5 rounded-xl border p-4" aria-labelledby="staff-role-heading">
      <h2 id="staff-role-heading" className="font-display text-2xl">
        Staff permission administration
      </h2>
      <p className="text-sm">{q.data.notice}</p>
      <p className="text-sm">
        Only a permanent system administrator with recent MFA can change these assignments. You cannot grant
        or renew your own permissions. Emergency access cannot administer roles.
      </p>
      {error && (
        <p role="alert" className="rounded-lg border p-3 text-sm">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border p-3 text-sm">
          {notice}
        </p>
      )}
      <form
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <fieldset className="contents" disabled={busy || !!pending}>
          <label className="text-sm">
            Managed identity ID
            <input
              className="field my-1 w-full"
              value={identityId}
              onChange={(e) => {
                setIdentityId(e.target.value);
                setVerified(null);
              }}
              required
              maxLength={128}
              placeholder="user_…"
            />
          </label>
          <label className="text-sm">
            Permission
            <select
              className="field my-1 w-full"
              value={role}
              onChange={(e) => setRole(e.target.value as typeof role)}
            >
              {roles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Change
            <select
              className="field my-1 w-full"
              value={action}
              onChange={(e) => setAction(e.target.value as typeof action)}
            >
              <option value="grant">Grant or replace assignment</option>
              <option value="revoke">Revoke assignment</option>
            </select>
          </label>
          {action === "grant" && (
            <>
              <label className="text-sm">
                Duration policy
                <select
                  className="field my-1 w-full"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as typeof mode)}
                >
                  <option value="break_glass">Emergency access with expiry</option>
                  <option value="permanent">Permanent assignment</option>
                </select>
              </label>
              {mode === "break_glass" && (
                <>
                  <label className="text-sm">
                    Minutes until expiry
                    <input
                      type="number"
                      min={5}
                      max={60}
                      className="field my-1 w-full"
                      value={minutes}
                      required
                      onChange={(e) => setMinutes(e.target.value)}
                    />
                  </label>
                  <label className="text-sm">
                    Incident reference
                    <input
                      className="field my-1 w-full"
                      value={incident}
                      required
                      minLength={5}
                      maxLength={200}
                      onChange={(e) => setIncident(e.target.value)}
                    />
                  </label>
                </>
              )}
              <div className="sm:col-span-2">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={!/^user_[A-Za-z0-9_-]+$/.test(identityId)}
                  onClick={() => void verify()}
                >
                  Verify selected identity
                </button>
                {verified?.identityId === identityId && (
                  <p className="my-2 break-all text-sm" role="status">
                    Verified target: {verified.label} · {verified.identityId}. The server checks this account
                    again before saving.
                  </p>
                )}
              </div>
            </>
          )}
          <p className="sm:col-span-2 text-sm">
            Current assignment:{" "}
            {existing
              ? `${effective(existing) ? "active" : "inactive or expired"}, ${existing.grantMode.replaceAll("_", " ")}, revision ${existing.version}${existing.expiresAt ? `, expires ${formatDateTime(existing.expiresAt)}` : ""}`
              : "No saved assignment for this identity and permission."}
          </p>
          <label className="sm:col-span-2 text-sm">
            Reason for the change
            <textarea
              className="field my-1 w-full"
              required
              minLength={20}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <label className="sm:col-span-2 flex gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setAckFor(e.target.checked ? fingerprint : "")}
            />
            I reviewed this exact identity, permission, current revision, duration and reason, and authorise
            this role change.
          </label>
        </fieldset>
        <div className="sm:col-span-2 flex flex-wrap gap-2">
          <button
            className="btn btn-primary"
            disabled={
              busy ||
              (!pending &&
                (!confirmed ||
                  reason.trim().length < 20 ||
                  (action === "grant" && verified?.identityId !== identityId) ||
                  (action === "revoke" && !existing?.active)))
            }
          >
            {pending ? "Retry exact saved role change" : "Save authorised role change"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void q.refetch()}
          >
            Check saved role changes
          </button>
        </div>
      </form>
      <div>
        <h3 className="font-semibold">Current assignments</h3>
        <p className="my-2 text-sm">
          {params
            ? "Assignments for the exact identity entered above, including inactive or expired permissions. Revocation does not require the target account to be available."
            : "Latest 250 assignments. Enter an exact managed identity ID above to retrieve all of its saved permissions, including older assignments."}
        </p>
        <ul className="mt-2 space-y-2">
          {q.data.assignments.map((r) => (
            <li key={r.id} className="rounded-lg border p-3 text-sm">
              <p className="break-all">
                {r.identityId} · {r.role} · {effective(r) ? "active" : "inactive or expired"}
              </p>
              <p>
                {r.grantMode.replaceAll("_", " ")}
                {r.expiresAt ? ` until ${formatDateTime(r.expiresAt)}` : ""} · revision {r.version}
              </p>
              <button
                className="btn btn-ghost btn-sm mt-2"
                disabled={busy || !!pending}
                onClick={() => {
                  setIdentityId(r.identityId);
                  setRole(r.role);
                  setAction("revoke");
                  setVerified(null);
                  setAckFor("");
                }}
              >
                Review this assignment
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h3 className="font-semibold">Recent role-change alerts</h3>
        <p className="my-2 text-sm">
          Append-only history, newest first. Role changes require review as part of incident monitoring; no
          external message is sent by this screen.
        </p>
        <ul className="space-y-2">
          {q.data.changes.map((c) => (
            <li key={c.id} className="rounded-lg border p-3 text-sm">
              <p className="break-all">
                {c.action} {c.role} · {c.targetIdentityId}
              </p>
              <p>
                {formatDateTime(c.createdAt)} · {c.reason}
              </p>
              <p className="break-all">
                Actor {c.actorId} · audit {c.id}
              </p>
              {c.incidentReference && <p>Incident {c.incidentReference}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
