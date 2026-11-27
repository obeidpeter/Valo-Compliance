import { pool } from "@workspace/db";

/**
 * NFR-003, NFR-010 (docs/architecture/alerts.md, part 3): the API counts its requests by the minute they
 * began in: how many, how many failed unexpectedly, and how many took at most each of these times, in
 * milliseconds. The counts are cumulative, so the counts of every process add up in the database.
 */
export const REQUEST_TIME_BOUNDS = [100, 250, 500, 1000, 2500, 5000, 10000] as const;
const COLUMNS = [
  "within_100ms",
  "within_250ms",
  "within_500ms",
  "within_1s",
  "within_2500ms",
  "within_5s",
  "within_10s",
] as const;
const MINUTE_MS = 60_000;
/** At most this many minutes wait for the database; an older one is dropped, and counted as dropped. */
export const UNWRITTEN_MINUTES_KEPT = 60;
/** Minutes older than this are removed from the database, at most once an hour. */
export const REQUEST_MINUTES_KEPT_DAYS = 7;

export type MinuteCounts = { requests: number; failures: number; within: number[] };
type Query = (text: string, values: unknown[]) => Promise<unknown>;

/** One process's counts, by the minute each request began in, until they are written. */
export class RequestCounts {
  private readonly minutes = new Map<number, MinuteCounts>();
  /** Minutes dropped because the database could not take them for an hour. */
  dropped = 0;

  /** Counts one request that began at `at`, took `ms` milliseconds and failed or not. */
  count(at: number, ms: number, failed: boolean) {
    const minute = at - (at % MINUTE_MS);
    let counts = this.minutes.get(minute);
    if (!counts) {
      counts = { requests: 0, failures: 0, within: REQUEST_TIME_BOUNDS.map(() => 0) };
      this.minutes.set(minute, counts);
      // With no writer taking them, the oldest minute goes, so the counts never outgrow an hour.
      if (this.minutes.size > UNWRITTEN_MINUTES_KEPT + 1) {
        this.minutes.delete(Math.min(...this.minutes.keys()));
        this.dropped++;
      }
    }
    counts.requests++;
    if (failed) counts.failures++;
    REQUEST_TIME_BOUNDS.forEach((bound, index) => {
      if (ms <= bound) counts.within[index]!++;
    });
  }

  /** Takes the counts of every minute before `now`'s, or of every minute when `all` is set. */
  take(now: number, all = false) {
    const current = now - (now % MINUTE_MS);
    const taken = [...this.minutes].filter(([minute]) => all || minute < current);
    for (const [minute] of taken) this.minutes.delete(minute);
    return taken.sort(([a], [b]) => a - b);
  }

  /** Puts back counts the database could not take, keeping at most an hour of minutes. */
  restore(taken: [number, MinuteCounts][]) {
    for (const [minute, counts] of taken) {
      const held = this.minutes.get(minute);
      if (!held) this.minutes.set(minute, counts);
      else {
        held.requests += counts.requests;
        held.failures += counts.failures;
        held.within = held.within.map((n, index) => n + counts.within[index]!);
      }
    }
    const oldest = [...this.minutes.keys()].sort((a, b) => a - b);
    for (const minute of oldest.slice(0, Math.max(0, oldest.length - UNWRITTEN_MINUTES_KEPT))) {
      this.minutes.delete(minute);
      this.dropped++;
    }
  }

  /** How many minutes wait to be written. */
  get waiting() {
    return this.minutes.size;
  }
}

/** This process's counts, which the API's requests add to. */
export const requestCounts = new RequestCounts();

/**
 * Adds minutes' counts to the database in one statement, outside any transaction: a minute another
 * process wrote too is added to, never replaced.
 */
export async function writeRequestMinutes(
  taken: [number, MinuteCounts][],
  query: Query = (text, values) => pool.query(text, values),
) {
  if (taken.length === 0) return;
  const width = 3 + COLUMNS.length;
  const values = taken.flatMap(([minute, counts]) => [
    new Date(minute).toISOString(),
    counts.requests,
    counts.failures,
    ...counts.within,
  ]);
  const rows = taken
    .map(
      (_, row) =>
        `(${Array.from({ length: width }, (_, column) => `$${row * width + column + 1}`).join(",")})`,
    )
    .join(",");
  await query(
    `INSERT INTO valo_request_minutes (minute, requests, failures, ${COLUMNS.join(", ")}) VALUES ${rows}
     ON CONFLICT (minute) DO UPDATE SET requests = valo_request_minutes.requests + excluded.requests,
       failures = valo_request_minutes.failures + excluded.failures,
       ${COLUMNS.map((column) => `${column} = valo_request_minutes.${column} + excluded.${column}`).join(", ")}`,
    values,
  );
}

/**
 * Writes every finished minute's counts; `all` writes the current minute's too, as a process does
 * before it stops. Counts the database cannot take are kept for the next write. It never throws.
 */
export async function writeRequestCounts(
  options: { counts?: RequestCounts; query?: Query; now?: number; all?: boolean } = {},
) {
  const counts = options.counts ?? requestCounts;
  const taken = counts.take(options.now ?? Date.now(), options.all);
  try {
    await writeRequestMinutes(taken, options.query);
    return { written: taken.length, waiting: counts.waiting, dropped: counts.dropped } as const;
  } catch (error) {
    counts.restore(taken);
    return { written: 0, waiting: counts.waiting, dropped: counts.dropped, error } as const;
  }
}

/** Removes minutes older than a week; they have served the alerts that read the last ten minutes. */
export async function removeOldRequestMinutes(query: Query = (text, values) => pool.query(text, values)) {
  await query(`DELETE FROM valo_request_minutes WHERE minute < now() - make_interval(days => $1::int)`, [
    REQUEST_MINUTES_KEPT_DAYS,
  ]);
}

type Log = { warn(fields: object): void; info(fields: object): void };

/**
 * Writes this process's finished minutes once a minute, and removes old minutes at most once an hour.
 * The timer never keeps the process alive, and a write still under way skips the next turn. A failing
 * write is logged once, by the error's class and code, until a write succeeds again. `stop` writes every
 * minute left, the current one too, as the process stops.
 */
export function startRequestCountWriter(
  log: Log,
  counts: RequestCounts = requestCounts,
  query: Query = (text, values) => pool.query(text, values),
) {
  let failing = false,
    running: Promise<void> | null = null,
    removedAt = 0;
  const turn = (all: boolean) =>
    (running ??= (async () => {
      const result = await writeRequestCounts({ counts, all, query });
      if ("error" in result) {
        if (!failing)
          log.warn({
            event: "operations.request_counts_unwritten",
            waiting: result.waiting,
            err: result.error,
          });
        failing = true;
      } else if (failing) {
        failing = false;
        log.info({ event: "operations.request_counts_written", dropped: result.dropped });
      }
      if (Date.now() - removedAt >= 3_600_000) {
        removedAt = Date.now();
        await removeOldRequestMinutes(query).catch((error: unknown) =>
          log.warn({ event: "operations.request_minutes_not_removed", err: error }),
        );
      }
    })().finally(() => {
      running = null;
    }));
  const timer = setInterval(() => void turn(false), MINUTE_MS);
  timer.unref();
  return async function stop() {
    clearInterval(timer);
    await running;
    await turn(true);
  };
}
