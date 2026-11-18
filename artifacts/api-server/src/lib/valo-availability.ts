/**
 * NFR-001: "99.5% monthly availability for core web/API journeys; separate status for AI and PSP
 * dependencies", accepted with "external synthetic checks; incident log; documented denominator and
 * planned-maintenance treatment". The definitions here are proposals until the owner approves them
 * (docs/valo/availability.md). Nothing here sends a check or stores a result: an external scheduler
 * runs src/scripts/synthetic-checks.ts and keeps its results with the incident log.
 */
export const AVAILABILITY_TARGET = 0.995;
export type AvailabilityGroup = "core" | "ai" | "psp";

/** Public core journeys an outside checker can reach without an account. */
export const CORE_JOURNEYS = [
  { id: "health", path: "/api/healthz", kind: "json" },
  { id: "home page", path: "/", kind: "html" },
  { id: "template library", path: "/library", kind: "html" },
  { id: "catalogue search", path: "/api/public/catalogue?q=invoice&page=1", kind: "json" },
  { id: "sign-in page", path: "/sign-in", kind: "html" },
] as const;
export type JourneyId = (typeof CORE_JOURNEYS)[number]["id"];

/** One synthetic check of one journey, as the external scheduler records it. */
export type CheckResult = { at: string; journey: JourneyId; ok: boolean };
/** A logged incident. Only its group, start and end count here; its record lives with the log. */
export type Incident = { id: string; group: AvailabilityGroup; start: string; end: string | null };
/** Work announced to customers in advance. */
export type Maintenance = { start: string; end: string; announcedAt: string };

/** Planned maintenance counts only when announced 72 hours ahead, for at most 4 hours a month. */
export const MAINTENANCE_NOTICE_MS = 72 * 3_600_000;
export const MAINTENANCE_LIMIT_MS = 4 * 3_600_000;
/** A check is expected every minute; one failure is confirmed by the next check failing too. */
export const CHECK_INTERVAL_MS = 60_000;

type Interval = { start: number; end: number };
const MINUTE = 60_000;
const time = (iso: string) => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) throw Error("AVAILABILITY_INVALID_TIME");
  return ms;
};
const minuteOf = (ms: number) => Math.floor(ms / MINUTE);

/** The calendar month (UTC) named "YYYY-MM", as [start, end). */
export function monthBounds(month: string): Interval {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) throw Error("AVAILABILITY_INVALID_MONTH");
  const start = Date.UTC(Number(match[1]), Number(match[2]) - 1, 1);
  const end = Date.UTC(Number(match[1]), Number(match[2]), 1);
  if (new Date(start).getUTCMonth() !== Number(match[2]) - 1) throw Error("AVAILABILITY_INVALID_MONTH");
  return { start, end };
}

/** Minutes in which planned maintenance applies: announced in time, and within the monthly cap. */
export function plannedMinutes(maintenance: Maintenance[], period: Interval): Set<number> {
  const minutes = new Set<number>();
  let used = 0;
  for (const window of [...maintenance].sort((a, b) => time(a.start) - time(b.start))) {
    const start = Math.max(time(window.start), period.start),
      end = Math.min(time(window.end), period.end);
    if (end <= start || time(window.start) - time(window.announcedAt) < MAINTENANCE_NOTICE_MS) continue;
    const allowed = Math.min(end - start, MAINTENANCE_LIMIT_MS - used);
    for (let m = minuteOf(start); m < minuteOf(start + allowed); m++) minutes.add(m);
    used += allowed;
  }
  return minutes;
}

/**
 * Minutes in which a core journey was down: the minutes of a run of failed checks that the
 * journey's next check confirmed, up to its next successful check (or the end of its data).
 */
export function confirmedDownMinutes(results: CheckResult[], period: Interval): Set<number> {
  const minutes = new Set<number>();
  const byJourney = new Map<string, { at: number; ok: boolean }[]>();
  for (const result of results) {
    const check = { at: time(result.at), ok: result.ok };
    const list = byJourney.get(result.journey);
    if (list) list.push(check);
    else byJourney.set(result.journey, [check]);
  }
  for (const checks of byJourney.values()) {
    checks.sort((a, b) => a.at - b.at);
    for (let i = 0; i < checks.length;) {
      if (checks[i]!.ok || !checks[i + 1] || checks[i + 1]!.ok) {
        i++;
        continue;
      }
      let recovered = i + 1;
      while (recovered < checks.length && !checks[recovered]!.ok) recovered++;
      const end =
        recovered < checks.length ? checks[recovered]!.at : checks[checks.length - 1]!.at + CHECK_INTERVAL_MS;
      const from = Math.max(checks[i]!.at, period.start),
        to = Math.min(end, period.end);
      for (let m = minuteOf(from); m < minuteOf(to); m++) minutes.add(m);
      i = recovered;
    }
  }
  return minutes;
}

/** Minutes with no check of some core journey: the checker was not running, so nothing is known. */
export function unmeasuredMinutes(results: CheckResult[], period: Interval): Set<number> {
  const seen = new Map<string, Set<number>>();
  for (const result of results) {
    const at = time(result.at);
    if (at < period.start || at >= period.end) continue;
    const set = seen.get(result.journey) ?? new Set<number>();
    set.add(minuteOf(at));
    seen.set(result.journey, set);
  }
  const minutes = new Set<number>();
  for (let m = minuteOf(period.start); m < minuteOf(period.end); m++)
    if (CORE_JOURNEYS.some((journey) => !seen.get(journey.id)?.has(m))) minutes.add(m);
  return minutes;
}

/** Every minute an incident touches counts, which errs on the customer's side. */
function incidentMinutes(incidents: Incident[], group: AvailabilityGroup, period: Interval, now: number) {
  const minutes = new Set<number>();
  for (const incident of incidents.filter((i) => i.group === group)) {
    const start = Math.max(time(incident.start), period.start),
      end = Math.min(incident.end ? time(incident.end) : now, period.end);
    for (let m = minuteOf(start); m < Math.ceil(end / MINUTE); m++) minutes.add(m);
  }
  return minutes;
}

export type GroupAvailability = {
  group: AvailabilityGroup;
  /** Minutes the target applies to: the month, less planned maintenance and unmeasured minutes. */
  eligibleMinutes: number;
  downMinutes: number;
  plannedMaintenanceMinutes: number;
  unmeasuredMinutes: number;
  availability: number | null;
  meetsTarget: boolean | null;
};

/**
 * The month's availability for each group. Core: from confirmed check failures and core incidents.
 * AI and PSP: from their incidents only, reported separately and never counted against core.
 * Planned maintenance leaves the denominator; unmeasured core minutes leave it too and are
 * disclosed, never assumed available.
 */
export function monthlyAvailability(input: {
  month: string;
  results: CheckResult[];
  incidents: Incident[];
  maintenance: Maintenance[];
  now?: number;
}): GroupAvailability[] {
  const period = monthBounds(input.month);
  const now = input.now ?? Date.now();
  const planned = plannedMinutes(input.maintenance, period);
  const unmeasured = unmeasuredMinutes(input.results, period);
  const all = minuteOf(period.end) - minuteOf(period.start);
  return (["core", "ai", "psp"] as const).map((group) => {
    const logged = incidentMinutes(input.incidents, group, period, now);
    const down = new Set(logged);
    if (group === "core") for (const m of confirmedDownMinutes(input.results, period)) down.add(m);
    // A logged incident still counts while the checker was not running.
    const unknown = group === "core" ? [...unmeasured].filter((m) => !logged.has(m)) : [];
    const excluded = new Set([...planned, ...unknown]);
    const counted = [...down].filter((m) => !excluded.has(m)).length;
    const eligible = all - excluded.size;
    const availability = eligible > 0 ? (eligible - counted) / eligible : null;
    return {
      group,
      eligibleMinutes: eligible,
      downMinutes: counted,
      plannedMaintenanceMinutes: planned.size,
      unmeasuredMinutes: unknown.filter((m) => !planned.has(m)).length,
      availability,
      meetsTarget: group === "core" && availability !== null ? availability >= AVAILABILITY_TARGET : null,
    };
  });
}

type Fetcher = (url: URL, init: RequestInit) => Promise<Response>;
/**
 * One round of the external synthetic checks: each core journey once, with a 10-second limit. A
 * journey passes only with status 200 and the content type it serves (and JSON that parses).
 */
export async function checkJourneys(base: string, fetcher: Fetcher = fetch, now = () => new Date()) {
  return Promise.all(
    CORE_JOURNEYS.map(async (journey): Promise<CheckResult> => {
      const at = now().toISOString();
      try {
        const response = await fetcher(new URL(journey.path, base), {
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        const type = response.headers.get("content-type") ?? "";
        const body = await response.text();
        let ok = response.status === 200;
        if (journey.kind === "json") {
          ok &&= type.includes("application/json");
          try {
            JSON.parse(body);
          } catch {
            ok = false;
          }
        } else ok &&= type.includes("text/html") && /<html[\s>]/i.test(body);
        return { at, journey: journey.id, ok };
      } catch {
        return { at, journey: journey.id, ok: false }; // No answer within the limit is a failure.
      }
    }),
  );
}
