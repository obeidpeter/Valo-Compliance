import { mkdir, open, readFile, rename, unlink, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { assertApplicationRuntime, runtimeEnvironment } from "../../platform/valo-runtime-activation";
import { workerReadiness, type WorkerHeartbeat } from "../../platform/valo-worker-health";
import { quotaLimit, type QuotaBucket } from "../../lib/valo-quota-policy";
import { PRIVACY_REQUEST_AIM_DAYS } from "../../lib/valo-privacy-state";
import { COMMERCIAL_SETTINGS } from "../commercial-settings";
export const operationsDirectory = resolve("generated-artifacts/valo-operations");
/** Live windows of the named quota buckets that reached their limit, as configured: one caller using all
 * of it. */
const atQuotaLimit = (buckets: readonly QuotaBucket[]) =>
  `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_rate_buckets WHERE expires_at > now() AND (${buckets
    .map((bucket) => `(bucket='${bucket}' AND used_count >= ${quotaLimit(bucket)})`)
    .join(" OR ")}) LIMIT 10001) bounded`;
export const readinessQueries = {
  database: "SELECT 1 AS value",
  exports:
    "SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_export_jobs WHERE status IN ('queued','running') LIMIT 10001) bounded",
  cleanup:
    "SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_export_objects WHERE state='cleanup' AND next_cleanup_at<=now() LIMIT 10001) bounded",
  exportRetention: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_file_assets a
    JOIN valo_export_jobs j ON j.id=a.job_id AND j.workspace_id=a.workspace_id
    WHERE j.status='ready' AND a.retention_at<=now() LIMIT 10001) bounded`,
  workspaceCleanup: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_workspace_export_attempts a
    JOIN valo_workspace_exports j ON j.id=a.job_id AND j.workspace_id=a.workspace_id
    WHERE (a.status='cleanup' OR j.status IN ('cancelled','expired'))
      AND (a.next_cleanup_at<=now() OR a.cleanup_error_code IS NOT NULL) LIMIT 10001) bounded`,
  // PRV-003 (docs/architecture/privacy-requests.md, slice 3): privacy requests still open after the date
  // Valo aims to finish them by. That date is Valo's own aim, not a time limit set by law.
  privacyRequests: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_privacy_cases
    WHERE status NOT IN ('fulfilled','rejected','cancelled')
      AND created_at < now() - interval '${PRIVACY_REQUEST_AIM_DAYS} days' LIMIT 10001) bounded`,
  payments: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_orders o WHERE o.status='verified_success' AND
    (NOT EXISTS(SELECT 1 FROM valo_entitlements e WHERE e.order_id=o.id AND e.workspace_id=o.workspace_id)
    OR NOT EXISTS(SELECT 1 FROM valo_purchase_outbox r WHERE r.order_id=o.id AND r.workspace_id=o.workspace_id AND r.kind='purchase_receipt')) LIMIT 10001) bounded`,
  // docs/architecture/alerts.md, part 3: reminder emails waiting more than fifteen minutes past their time,
  // and scheduled jobs waiting more than ten minutes past their start.
  reminders: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_reminder_outbox WHERE status='pending'
    AND COALESCE(next_attempt_at, scheduled_at) < now() - interval '15 minutes' LIMIT 10001) bounded`,
  jobQueue: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_jobs.job WHERE state IN ('created','retry')
    AND start_after < now() - interval '10 minutes' LIMIT 10001) bounded`,
  // docs/architecture/messages.md, part 1: messages to customers still waiting fifteen minutes past their
  // time, or still marked as being sent fifteen minutes after their attempt's lease ended. One held is
  // held on purpose, by the pause or for want of a sender.
  messages: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_messages
    WHERE (status='queued' AND COALESCE(next_attempt_at, created_at) < now() - interval '15 minutes')
      OR (status='sending' AND lease_until < now() - interval '15 minutes') LIMIT 10001) bounded`,
  // Messages that failed in the last day: offered five times and not taken, or past the time a retry
  // could be told from a second message.
  failedMessages: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_messages
    WHERE status='failed' AND updated_at > now() - interval '1 day' LIMIT 10001) bounded`,
  // NFR-003, by the API's request counts of the last ten minutes, once there are a hundred requests or more
  // to mean something (fewer read as nothing): how many in 1,000 failed unexpectedly, and the time 95 in
  // 100 of them took at most, in milliseconds, by the counts' fixed times (10001: longer than ten seconds).
  requestFailures: `SELECT (CASE WHEN COALESCE(sum(requests), 0) < 100 THEN 0
    ELSE floor(1000 * sum(failures)::numeric / sum(requests)) END)::int AS value
    FROM valo_request_minutes WHERE minute >= date_trunc('minute', now()) - interval '10 minutes'`,
  requestTime: `SELECT (CASE WHEN COALESCE(sum(requests), 0) < 100 THEN 0
    ${[
      ["within_100ms", 100],
      ["within_250ms", 250],
      ["within_500ms", 500],
      ["within_1s", 1000],
      ["within_2500ms", 2500],
      ["within_5s", 5000],
      ["within_10s", 10000],
    ]
      .map(([column, bound]) => `WHEN 100 * sum(${column}) >= 95 * sum(requests) THEN ${bound}`)
      .join(" ")} ELSE 10001 END)::int AS value
    FROM valo_request_minutes WHERE minute >= date_trunc('minute', now()) - interval '10 minutes'`,
  // SEC-008's security signals. Refusals by the most refused address in ten minutes:
  deniedAccess: `SELECT COALESCE(max(total), 0)::int AS value FROM (SELECT sum(count) AS total
    FROM valo_security_signals WHERE kind='denied_access' AND window_started_at > now() - interval '10 minutes'
    GROUP BY subject_hash) per_subject`,
  signatureFailures: `SELECT COALESCE(sum(count), 0)::int AS value FROM valo_security_signals
    WHERE kind='signature_failure' AND window_started_at > now() - interval '10 minutes'`,
  // docs/architecture/alerts.md, part 2 (SEC-005): abuse spread over many callers, each under its own
  // limit. Refusals of every address together in ten minutes:
  spreadRefusals: `SELECT COALESCE(sum(count), 0)::int AS value FROM valo_security_signals
    WHERE kind='denied_access' AND window_started_at > now() - interval '10 minutes'`,
  // How many callers, by keyed address, a limit refused (429) in ten minutes:
  limitedCallers: `SELECT count(DISTINCT subject_hash)::int AS value FROM valo_security_signals
    WHERE kind='limit_refusal' AND window_started_at > now() - interval '10 minutes'`,
  // The security baseline, v5.0.0-16.3.3: the refused input of the address that sent the most in ten
  // minutes (400, 413, 415 or 422).
  refusedInput: `SELECT COALESCE(max(total), 0)::int AS value FROM (SELECT sum(count) AS total
    FROM valo_security_signals WHERE kind='refused_input' AND window_started_at > now() - interval '10 minutes'
    GROUP BY subject_hash) per_subject`,
  roleChanges:
    "SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_staff_role_changes WHERE created_at > now() - interval '1 hour' LIMIT 10001) bounded",
  // Read as each sample is taken, so each counts callers at the ceilings the settings give.
  get bulkExports() {
    return atQuotaLimit(["export-create"]);
  },
  get paymentActivity() {
    return atQuotaLimit(["checkout-create", "checkout-create-day", "refund-create", "refund-create-day"]);
  },
  get aiActivity() {
    return atQuotaLimit(["customer-ai"]);
  },
  // docs/architecture/alerts.md, part 2 (SEC-005, SEC-008): money, the drafting assistant's use and
  // whole-workspace copies, of every workspace together, over the last hour. Checkouts begun, and what
  // they come to in whole naira:
  checkouts: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_orders
    WHERE created_at > now() - interval '1 hour' LIMIT 10001) bounded`,
  checkoutAmount: `SELECT (COALESCE(sum(amount_kobo), 0) / 100)::bigint AS value FROM valo_orders
    WHERE created_at > now() - interval '1 hour'`,
  // Refunds asked for, and what the refunds authorised come to in whole naira:
  refunds: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_refund_requests
    WHERE created_at > now() - interval '1 hour' LIMIT 10001) bounded`,
  refundAmount: `SELECT (COALESCE(sum(amount_kobo), 0) / 100)::bigint AS value FROM valo_refund_requests
    WHERE authorised_at > now() - interval '1 hour'`,
  // How much of the drafting assistant's daily allowance in all the drafts of the last hour used, in
  // hundredths of it: the owner's setting in effect, or its default. With no allowance, any draft is all.
  aiSpend: `SELECT (CASE WHEN allowance <= 0 THEN (CASE WHEN used > 0 THEN 100 ELSE 0 END)
      ELSE floor(100 * used::numeric / allowance) END)::int AS value
    FROM (SELECT (SELECT count(*) FROM valo_ai_drafts WHERE budget_reserved
        AND created_at > now() - interval '1 hour') AS used,
      COALESCE((public.valo_commercial_setting('drafting_daily_in_all'))::int,
        ${COMMERCIAL_SETTINGS.drafting_daily_in_all.defaultValue}) AS allowance) spend`,
  // Whole-workspace data downloads asked for, and copies of a workspace's data prepared by privacy staff
  // for an export request:
  workspaceDownloads: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_workspace_exports
    WHERE created_at > now() - interval '1 hour' LIMIT 10001) bounded`,
  staffCopies: `SELECT count(*)::int AS value FROM (SELECT 1 FROM valo_privacy_events
    WHERE action='application_export_prepared' AND created_at > now() - interval '1 hour' LIMIT 10001) bounded`,
  // ADM-009 (docs/architecture/audit-trail.md). Application requests a database guard refused in ten
  // minutes: the application never sends a change a guard refuses, so each is a fault or an attempt to
  // change a history.
  guardRefusals: `SELECT COALESCE(sum(count), 0)::int AS value FROM valo_security_signals
    WHERE kind='guard_refusal' AND window_started_at > now() - interval '10 minutes'`,
  // The most distinct things one staff member read in the last hour, by the access history.
  privilegedReading: `SELECT COALESCE(max(objects), 0)::int AS value FROM (SELECT count(DISTINCT object) AS objects
    FROM valo_staff_access_audit WHERE created_at > now() - interval '1 hour' AND object <> 'unrecorded'
    GROUP BY actor_id) per_actor`,
  // How many histories' digests the latest hourly count found no longer matching their rows
  // (valo-history-digests.ts). With no count under two hours old the reading is unavailable.
  historyIntegrity: `SELECT COALESCE((SELECT CASE WHEN checked_at > now() - interval '2 hours'
    THEN cardinality(mismatched) ELSE -1 END FROM valo_history_checks ORDER BY checked_at DESC LIMIT 1), -1)::int AS value`,
} as const;
/** Each security reading and the subject its alerts are named after. */
const SECURITY_METRICS = [
  ["deniedAccess", "DENIED_ACCESS"],
  ["signatureFailures", "SIGNATURE_FAILURES"],
  ["spreadRefusals", "SPREAD_REFUSALS"],
  ["limitedCallers", "LIMITED_CALLERS"],
  ["refusedInput", "REFUSED_INPUT"],
  ["roleChanges", "ROLE_CHANGES"],
  ["bulkExports", "BULK_EXPORTS"],
  ["paymentActivity", "PAYMENT_ACTIVITY"],
  ["aiActivity", "AI_ACTIVITY"],
  ["checkouts", "CHECKOUTS"],
  ["checkoutAmount", "CHECKOUT_AMOUNT"],
  ["refunds", "REFUNDS"],
  ["refundAmount", "REFUND_AMOUNT"],
  ["aiSpend", "AI_SPEND"],
  ["workspaceDownloads", "WORKSPACE_DOWNLOADS"],
  ["staffCopies", "STAFF_COPIES"],
  ["guardRefusals", "GUARD_REFUSALS"],
  ["privilegedReading", "PRIVILEGED_READING"],
  ["historyIntegrity", "HISTORY_INTEGRITY"],
] as const;
/** Each reading of the API's own service (NFR-003) and the subject its alerts are named after. */
const SERVICE_METRICS = [
  ["requestFailures", "REQUEST_FAILURES"],
  ["requestTime", "REQUEST_TIME"],
] as const;
/** The reading of messages that failed (docs/architecture/messages.md) and the subject its alerts are named after. */
const MESSAGE_METRICS = [["failedMessages", "FAILED_MESSAGES"]] as const;
type Metric = { status: "ok" | "unavailable"; value: number | null; elapsedMs: number };
export type OperationalSample = {
  checkedAt: string;
  scope: "development-project-local" | "production-rehearsal-local";
  database: Metric;
  exports: Metric;
  cleanup: Metric;
  exportRetention: Metric;
  workspaceCleanup: Metric;
  privacyRequests: Metric;
  reminders: Metric;
  jobQueue: Metric;
  messages: Metric;
  failedMessages: Metric;
  payments: Metric;
  requestFailures: Metric;
  requestTime: Metric;
  deniedAccess: Metric;
  signatureFailures: Metric;
  spreadRefusals: Metric;
  limitedCallers: Metric;
  refusedInput: Metric;
  roleChanges: Metric;
  bulkExports: Metric;
  paymentActivity: Metric;
  aiActivity: Metric;
  checkouts: Metric;
  checkoutAmount: Metric;
  refunds: Metric;
  refundAmount: Metric;
  aiSpend: Metric;
  workspaceDownloads: Metric;
  staffCopies: Metric;
  guardRefusals: Metric;
  privilegedReading: Metric;
  historyIntegrity: Metric;
  worker: { status: "healthy" | "stale" | "unavailable"; ageMs: number | null };
  limits: {
    exports: number;
    cleanup: number;
    exportRetention: number;
    workspaceCleanup: number;
    privacyRequests: number;
    reminders: number;
    jobQueue: number;
    messages: number;
    failedMessages: number;
    workerAgeMs: number;
    requestFailures: number;
    requestTime: number;
    deniedAccess: number;
    signatureFailures: number;
    spreadRefusals: number;
    limitedCallers: number;
    refusedInput: number;
    roleChanges: number;
    bulkExports: number;
    paymentActivity: number;
    aiActivity: number;
    checkouts: number;
    checkoutAmount: number;
    refunds: number;
    refundAmount: number;
    aiSpend: number;
    workspaceDownloads: number;
    staffCopies: number;
    guardRefusals: number;
    privilegedReading: number;
    historyIntegrity: number;
  };
};
async function atomicJson(file: string, value: unknown) {
  const temp = file + "." + randomUUID() + ".tmp";
  const fd = await open(temp, "wx", 0o600);
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
  } finally {
    await fd.close();
  }
  try {
    await rename(temp, file);
  } finally {
    // After a successful rename the temporary file is already gone; otherwise this is best-effort cleanup.
    await unlink(temp).catch(() => {});
  }
}
export async function recordWorkerHeartbeat(health: WorkerHeartbeat, directory = operationsDirectory) {
  assertApplicationRuntime();
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await atomicJson(join(directory, "worker.json"), {
    ...health,
    at: new Date().toISOString(),
    pid: process.pid,
  });
}
export async function collectOperationalSample(
  query: (sql: string) => Promise<{ rows: { value: unknown }[] }>,
  directory = operationsDirectory,
): Promise<OperationalSample> {
  assertApplicationRuntime();
  const metrics = await Promise.all(
    Object.entries(readinessQueries).map(async ([key, sql]) => {
      const start = performance.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          query(sql),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(Error("PROBE_TIMEOUT")), 2000);
          }),
        ]);
        const value = Number(result.rows[0]?.value);
        if (!Number.isSafeInteger(value) || value < 0) throw Error("INVALID_METRIC");
        return [key, { status: "ok", value, elapsedMs: Math.round(performance.now() - start) }] as const;
      } catch {
        return [
          key,
          { status: "unavailable", value: null, elapsedMs: Math.round(performance.now() - start) },
        ] as const;
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  let worker: OperationalSample["worker"] = { status: "unavailable", ageMs: null };
  try {
    const raw = await readFile(join(directory, "worker.json"), "utf8");
    if (raw.length > 1000) throw Error("INVALID_HEARTBEAT");
    const heartbeat = JSON.parse(raw),
      at = Date.parse(heartbeat.at),
      ageMs = Date.now() - at;
    if (!Number.isFinite(at) || ageMs < 0 || !Number.isSafeInteger(heartbeat.pid))
      throw Error("INVALID_HEARTBEAT");
    process.kill(heartbeat.pid, 0);
    worker = { status: ageMs > 90000 ? "stale" : workerReadiness(heartbeat), ageMs };
  } catch {
    /* Absence, malformed data or a dead worker is not a healthy heartbeat. */
  }
  return {
    ...Object.fromEntries(metrics),
    checkedAt: new Date().toISOString(),
    scope: runtimeEnvironment() === "production" ? "production-rehearsal-local" : "development-project-local",
    worker,
    limits: {
      exports: 100,
      cleanup: 0,
      exportRetention: 0,
      workspaceCleanup: 0,
      // Any privacy request still open after the date Valo aims to finish it by.
      privacyRequests: 0,
      // Any reminder email or scheduled job waiting past its time.
      reminders: 0,
      jobQueue: 0,
      // Any message to a customer waiting past its time, and any that failed in the last day.
      messages: 0,
      failedMessages: 0,
      workerAgeMs: 90000,
      // NFR-003's own: fewer than 1 in 100 requests failing unexpectedly, and 95 in 100 within a second.
      requestFailures: 10,
      requestTime: 1000,
      // Development defaults, not reviewed thresholds: more than 20 refusals of one address in ten
      // minutes, and any signature failure, role change or caller at a quota limit, raise an alert.
      deniedAccess: 20,
      signatureFailures: 0,
      // Development defaults too (docs/architecture/alerts.md, part 2): more than a hundred refusals of
      // every address together in ten minutes, more than ten callers refused by a limit, and more than
      // twenty refused inputs from one address, raise an alert.
      spreadRefusals: 100,
      limitedCallers: 10,
      refusedInput: 20,
      roleChanges: 0,
      bulkExports: 0,
      paymentActivity: 0,
      aiActivity: 0,
      // Development defaults too, against no measured traffic (docs/architecture/alerts.md, part 2): in an
      // hour, more than fifty checkouts begun or a million naira; more than five refunds asked for or a
      // hundred thousand naira authorised; more than a quarter of the drafting assistant's daily
      // allowance; more than ten whole-workspace downloads asked for; and more than five copies of a
      // workspace's data prepared by privacy staff raise an alert.
      checkouts: 50,
      checkoutAmount: 1_000_000,
      refunds: 5,
      refundAmount: 100_000,
      aiSpend: 25,
      workspaceDownloads: 10,
      staffCopies: 5,
      // Development defaults too: any refusal by a database guard, and a staff member reading more than
      // a hundred distinct records or lists in an hour, raise an alert.
      guardRefusals: 0,
      privilegedReading: 100,
      // Any history whose digest no longer matches its rows.
      historyIntegrity: 0,
    },
  } as OperationalSample;
}
/**
 * NFR-010: every alert names its accountable roles and the runbook to follow, as
 * docs/valo/operating-runbooks.md names them. They are role assignments, not named or staffed
 * responders. Keyed by what the alert is about; a test drives every alert this module raises.
 */
export const ALERT_RUNBOOKS = {
  DATABASE: { runbook: "Site/database unavailable", accountable: "Engineering lead" },
  WORKER: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  EXPORTS: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  CLEANUP: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  EXPORT_RETENTION: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  WORKSPACE_CLEANUP: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  PRIVACY_REQUESTS: { runbook: "Deletion and recovery", accountable: "Engineering + privacy owner" },
  REMINDERS: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  JOB_QUEUE: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  MESSAGES: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  FAILED_MESSAGES: { runbook: "Broken export / AI outage", accountable: "Engineering" },
  PAYMENTS: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  REQUEST_FAILURES: { runbook: "Site/database unavailable", accountable: "Engineering lead" },
  REQUEST_TIME: { runbook: "Site/database unavailable", accountable: "Engineering lead" },
  DENIED_ACCESS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  SIGNATURE_FAILURES: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  SPREAD_REFUSALS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  LIMITED_CALLERS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  REFUSED_INPUT: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  ROLE_CHANGES: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  BULK_EXPORTS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  PAYMENT_ACTIVITY: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  AI_ACTIVITY: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  CHECKOUTS: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  CHECKOUT_AMOUNT: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  REFUNDS: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  REFUND_AMOUNT: { runbook: "Payment/entitlement failure", accountable: "Finance + engineering" },
  AI_SPEND: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  WORKSPACE_DOWNLOADS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  STAFF_COPIES: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  GUARD_REFUSALS: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  PRIVILEGED_READING: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
  HISTORY_INTEGRITY: { runbook: "Security/privacy incident", accountable: "Incident lead + privacy owner" },
} as const;
const alertSubject = (code: string) => code.replace(/_(BACKLOG|DETECTED|PROBE_UNAVAILABLE|UNAVAILABLE)$/, "");
export function alertRunbook(code: string) {
  const subject = alertSubject(code);
  return Object.hasOwn(ALERT_RUNBOOKS, subject)
    ? ALERT_RUNBOOKS[subject as keyof typeof ALERT_RUNBOOKS]
    : null;
}
/**
 * What each alert is about, in plain words for the staff who read it (docs/architecture/alerts.md, part
 * 1): what it says when raised, and what Valo reads for it, for when that reading cannot be taken.
 */
export const ALERT_WORDS = {
  DATABASE: { raised: "The database cannot be reached", reading: "the database" },
  WORKER: { raised: "The background worker is not running or is late", reading: "the background worker" },
  EXPORTS: {
    raised: "More exports are waiting than the worker is keeping up with",
    reading: "the export queue",
  },
  CLEANUP: { raised: "Files are waiting to be removed past their time", reading: "file removal" },
  EXPORT_RETENTION: { raised: "Expired files are waiting to be retired", reading: "expired files" },
  WORKSPACE_CLEANUP: {
    raised: "Whole-workspace downloads are waiting to be cleared away",
    reading: "whole-workspace downloads",
  },
  PRIVACY_REQUESTS: {
    raised: "A privacy request is open past the date Valo aims to finish it by",
    reading: "privacy requests",
  },
  REMINDERS: { raised: "Reminder emails are waiting past their time", reading: "reminder emails" },
  JOB_QUEUE: { raised: "Scheduled jobs are waiting past their start", reading: "the job queue" },
  MESSAGES: {
    raised: "Messages to customers are waiting past their time",
    reading: "the messages waiting to be sent",
  },
  FAILED_MESSAGES: {
    raised: "A message to a customer failed in the last day",
    reading: "the messages that failed",
  },
  PAYMENTS: { raised: "A paid order is missing its access or its receipt", reading: "paid orders" },
  REQUEST_FAILURES: {
    raised: "Too many requests failed unexpectedly, counted in 1,000 over ten minutes",
    reading: "the request counts",
  },
  REQUEST_TIME: {
    raised: "Requests are slow: the time 95 in 100 took at most, in milliseconds over ten minutes",
    reading: "the request times",
  },
  DENIED_ACCESS: { raised: "One address is being refused again and again", reading: "refused requests" },
  SIGNATURE_FAILURES: {
    raised: "A message from the payment or email provider failed its signature check",
    reading: "the providers' signatures",
  },
  SPREAD_REFUSALS: {
    raised: "Requests from many addresses together are being refused",
    reading: "refused requests from every address",
  },
  LIMITED_CALLERS: { raised: "Many callers were refused by a limit", reading: "callers refused by a limit" },
  REFUSED_INPUT: {
    raised: "One address is sending input Valo refuses, again and again",
    reading: "refused input",
  },
  ROLE_CHANGES: { raised: "A staff role was changed in the last hour", reading: "staff role changes" },
  BULK_EXPORTS: { raised: "A caller reached the export limit", reading: "the export limit" },
  PAYMENT_ACTIVITY: { raised: "A caller reached a payment limit", reading: "the payment limits" },
  AI_ACTIVITY: {
    raised: "A caller reached the drafting assistant's limit",
    reading: "the drafting assistant's limit",
  },
  CHECKOUTS: { raised: "More checkouts began in the last hour than usual", reading: "checkouts begun" },
  CHECKOUT_AMOUNT: {
    raised: "Checkouts begun in the last hour came to more than usual, in naira",
    reading: "what checkouts came to",
  },
  REFUNDS: { raised: "More refunds were asked for in the last hour than usual", reading: "refund requests" },
  REFUND_AMOUNT: {
    raised: "Refunds authorised in the last hour came to more than usual, in naira",
    reading: "what refunds came to",
  },
  AI_SPEND: {
    raised:
      "The drafting assistant used more of its daily allowance in the last hour than usual, in hundredths of it",
    reading: "the drafting assistant's use",
  },
  WORKSPACE_DOWNLOADS: {
    raised: "More whole-workspace downloads were asked for in the last hour than usual",
    reading: "requests for whole-workspace downloads",
  },
  STAFF_COPIES: {
    raised: "Privacy staff prepared more copies of a workspace's data in the last hour than usual",
    reading: "staff copies of workspace data",
  },
  GUARD_REFUSALS: {
    raised: "The database refused a change to a record it protects",
    reading: "the database's refusals",
  },
  PRIVILEGED_READING: { raised: "A member of staff read more records than usual", reading: "staff reading" },
  HISTORY_INTEGRITY: {
    raised: "A history no longer matches its hourly count",
    reading: "the histories' counts",
  },
} as const satisfies Record<keyof typeof ALERT_RUNBOOKS, { raised: string; reading: string }>;
/** An alert's title, in plain words, or null for a code this module never raises. */
export function alertTitle(code: string) {
  const subject = alertSubject(code);
  if (!Object.hasOwn(ALERT_WORDS, subject)) return null;
  const words = ALERT_WORDS[subject as keyof typeof ALERT_WORDS];
  return code.endsWith("_PROBE_UNAVAILABLE") ? `Valo cannot read ${words.reading}` : words.raised;
}
/** The reading each alert's subject is raised on, where it has one. */
const SUBJECT_READINGS: Partial<
  Record<keyof typeof ALERT_RUNBOOKS, Exclude<keyof OperationalSample["limits"], "workerAgeMs"> | "payments">
> = {
  EXPORTS: "exports",
  CLEANUP: "cleanup",
  EXPORT_RETENTION: "exportRetention",
  WORKSPACE_CLEANUP: "workspaceCleanup",
  PRIVACY_REQUESTS: "privacyRequests",
  REMINDERS: "reminders",
  JOB_QUEUE: "jobQueue",
  MESSAGES: "messages",
  FAILED_MESSAGES: "failedMessages",
  PAYMENTS: "payments",
  REQUEST_FAILURES: "requestFailures",
  REQUEST_TIME: "requestTime",
  DENIED_ACCESS: "deniedAccess",
  SIGNATURE_FAILURES: "signatureFailures",
  SPREAD_REFUSALS: "spreadRefusals",
  LIMITED_CALLERS: "limitedCallers",
  REFUSED_INPUT: "refusedInput",
  ROLE_CHANGES: "roleChanges",
  BULK_EXPORTS: "bulkExports",
  PAYMENT_ACTIVITY: "paymentActivity",
  AI_ACTIVITY: "aiActivity",
  CHECKOUTS: "checkouts",
  CHECKOUT_AMOUNT: "checkoutAmount",
  REFUNDS: "refunds",
  REFUND_AMOUNT: "refundAmount",
  AI_SPEND: "aiSpend",
  WORKSPACE_DOWNLOADS: "workspaceDownloads",
  STAFF_COPIES: "staffCopies",
  GUARD_REFUSALS: "guardRefusals",
  PRIVILEGED_READING: "privilegedReading",
  HISTORY_INTEGRITY: "historyIntegrity",
};
/** An alert's reading in a sample and the limit it is measured against, where it has them. */
function measure(sample: OperationalSample, code: string) {
  const name = SUBJECT_READINGS[alertSubject(code) as keyof typeof ALERT_RUNBOOKS];
  if (!name) return { reading: null, threshold: null };
  const metric = sample[name];
  return {
    reading: metric.status === "ok" ? metric.value : null,
    threshold: name === "payments" ? 0 : sample.limits[name],
  };
}
type Alert = {
  id: string;
  /** Its place in the journal, counted from the journal's first change. */
  sequence: number;
  at: string;
  code: string;
  state: "active" | "resolved";
  reading?: number | null;
  threshold?: number | null;
  runbook?: string | null;
  accountable?: string | null;
};
/** One change in the journal: an alert raised or cleared. */
export type AlertChange = Alert;
type AlertState = {
  sequence: number;
  /** The last change the database's journal holds (docs/architecture/alerts.md, part 1). */
  published: number;
  active: string[];
  events: Alert[];
  sample?: OperationalSample;
};
/** The journal as a file written before its changes were numbered and copied may hold it. */
type StoredAlertState = Omit<AlertState, "published" | "events"> & {
  published?: number;
  events: (Omit<Alert, "sequence"> & { sequence?: number })[];
};
/** Copies changes to the database's journal; it must take a change it already holds without harm. */
export type AlertPublisher = (changes: AlertChange[]) => Promise<void>;
/** Internal only. Atomic bounded project-local journal, not a production monitor/audit archive. */
const pendingAlertWrites = new Map<string, Promise<void>>();
/**
 * Runs `work` holding the journal's lock: one at a time in this process, in the order asked, and across
 * processes by the lock file. Local contention waits in FIFO order instead of consuming the interprocess
 * lock's bounded retry window.
 */
async function underAlertLock<T>(directory: string, work: () => Promise<T>) {
  const key = join(directory, "."),
    previous = pendingAlertWrites.get(key) ?? Promise.resolve();
  const result = previous.then(() => underAlertFileLock(directory, work));
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  pendingAlertWrites.set(key, tail);
  try {
    return await result;
  } finally {
    if (pendingAlertWrites.get(key) === tail) pendingAlertWrites.delete(key);
  }
}
async function underAlertFileLock<T>(directory: string, work: () => Promise<T>) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const lock = join(directory, "alerts.lock");
  let acquired = false;
  for (let n = 0; n < 200 && !acquired; n++) {
    try {
      const fd = await open(lock, "wx", 0o600);
      await fd.writeFile(String(process.pid));
      await fd.close();
      acquired = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      try {
        if (Date.now() - (await stat(lock)).mtimeMs > 5000) {
          const pid = Number(await readFile(lock, "utf8"));
          let alive = false;
          if (Number.isSafeInteger(pid) && pid > 0)
            try {
              process.kill(pid, 0);
              alive = true;
            } catch {
              // Expected: signal 0 throws when the lock holder no longer exists.
            }
          if (!alive) await unlink(lock);
        }
      } catch {
        // Expected race: another process released or replaced the lock; retry below.
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  if (!acquired) throw Error("INTERNAL_ALERT_LOCK_UNAVAILABLE");
  try {
    return await work();
  } finally {
    await unlink(lock);
  }
}
/** The journal as the file holds it, or an empty one where there is no file yet. */
async function readAlertState(file: string): Promise<AlertState> {
  let stored: StoredAlertState = { sequence: 0, published: 0, active: [], events: [] };
  try {
    stored = JSON.parse(await readFile(file, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw Error("INTERNAL_ALERT_HISTORY_UNREADABLE");
  }
  // A journal written before changes were numbered: number its changes by their place, the last being
  // the journal's count. None of them has been copied yet.
  return {
    ...stored,
    published: stored.published ?? 0,
    events: stored.events.map((event, index) => ({
      ...event,
      sequence: event.sequence ?? stored.sequence - (stored.events.length - 1 - index),
    })),
  };
}
export async function recordOperationalAlerts(sample: OperationalSample, directory = operationsDirectory) {
  assertApplicationRuntime();
  return underAlertLock(directory, () =>
    recordOperationalAlertsLocked(sample, join(directory, "alerts.json")),
  );
}
async function recordOperationalAlertsLocked(sample: OperationalSample, file: string) {
  let state = await readAlertState(file);
  const active: string[] = [];
  if (sample.database.status !== "ok" || sample.database.value !== 1) active.push("DATABASE_UNAVAILABLE");
  if (sample.worker.status !== "healthy") active.push("WORKER_UNAVAILABLE");
  for (const name of [
    "exports",
    "cleanup",
    "exportRetention",
    "workspaceCleanup",
    "privacyRequests",
    "reminders",
    "jobQueue",
    "messages",
    "payments",
  ] as const) {
    const code =
      name === "workspaceCleanup"
        ? "WORKSPACE_CLEANUP"
        : name === "exportRetention"
          ? "EXPORT_RETENTION"
          : name === "privacyRequests"
            ? "PRIVACY_REQUESTS"
            : name === "jobQueue"
              ? "JOB_QUEUE"
              : name.toUpperCase();
    const metric = sample[name];
    if (metric.status !== "ok") active.push(code + "_PROBE_UNAVAILABLE");
    else if (metric.value! > (name === "payments" ? 0 : sample.limits[name])) active.push(code + "_BACKLOG");
  }
  for (const [name, subject] of [...SERVICE_METRICS, ...MESSAGE_METRICS, ...SECURITY_METRICS]) {
    const metric = sample[name];
    if (metric.status !== "ok") active.push(subject + "_PROBE_UNAVAILABLE");
    else if (metric.value! > sample.limits[name]) active.push(subject + "_DETECTED");
  }
  const events: Alert[] = [];
  for (const code of new Set([...state.active, ...active])) {
    if (state.active.includes(code) === active.includes(code)) continue;
    const owner = alertRunbook(code);
    events.push({
      id: randomUUID(),
      sequence: state.sequence + events.length + 1,
      at: sample.checkedAt,
      code,
      state: active.includes(code) ? "active" : "resolved",
      ...measure(sample, code),
      runbook: owner?.runbook ?? null,
      accountable: owner?.accountable ?? null,
    });
  }
  state = {
    sequence: state.sequence + events.length,
    published: state.published,
    active,
    events: [...state.events, ...events].slice(-1000),
    sample,
  };
  await atomicJson(file, state);
  return {
    active: state.active,
    owners: state.active.map((code) => ({
      code,
      runbook: alertRunbook(code)?.runbook ?? null,
      accountable: alertRunbook(code)?.accountable ?? null,
    })),
    emitted: events.length,
    sequence: state.sequence,
  };
}
/**
 * Copies every change the database's journal does not yet hold (docs/architecture/alerts.md, part 1).
 * The file is read and marked under its lock, but the copying is done without it, so a slow or absent
 * database never keeps another reading waiting on the file. A change copied twice does no harm: the
 * publisher takes a change it already holds as it is. When the database cannot take them, they stay
 * in the file for the next copy, and the result says how many and why. The file keeps the last 1,000
 * changes, so a change it no longer holds before the database took it is lost to the journal; the
 * result counts those too.
 */
export async function copyAlertChanges(publish: AlertPublisher, directory = operationsDirectory) {
  assertApplicationRuntime();
  const file = join(directory, "alerts.json");
  const { pending, lost } = await underAlertLock(directory, async () => {
    const state = await readAlertState(file);
    const pending = state.events.filter((event) => event.sequence > state.published);
    return { pending, lost: pending.length ? pending[0]!.sequence - state.published - 1 : 0 };
  });
  if (pending.length === 0) return { copied: 0, behind: 0, lost } as const;
  try {
    await publish(pending);
  } catch (error) {
    return { copied: 0, behind: pending.length, lost, error } as const;
  }
  const last = pending.at(-1)!.sequence;
  await underAlertLock(directory, async () => {
    const state = await readAlertState(file);
    // Another reading may have written the file since; only the count of copied changes moves on.
    if (state.published < last) await atomicJson(file, { ...state, published: last });
  });
  return { copied: pending.length, behind: 0, lost } as const;
}
