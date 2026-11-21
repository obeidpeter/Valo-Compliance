import test from "node:test";
import assert from "node:assert/strict";
import {
  CORE_JOURNEYS,
  checkJourneys,
  monthlyAvailability,
  type CheckResult,
  type JourneyId,
} from "./valo-availability";

const MONTH = "2026-12"; // 31 days: 44,640 minutes.
const START = Date.UTC(2026, 11, 1);
const MINUTES = 31 * 24 * 60;
/** A check's time, five seconds into its minute. */
const at = (minute: number) => new Date(START + minute * 60_000 + 5_000).toISOString();
/** The start of a minute, for incidents and maintenance windows. */
const boundary = (minute: number) => new Date(START + minute * 60_000).toISOString();

/** A check of every journey every minute, all passing except the failures given. */
function checks(failures: Partial<Record<JourneyId, number[]>> = {}): CheckResult[] {
  const failing = new Map(
    Object.entries(failures).map(([journey, minutes]) => [journey, new Set(minutes)] as const),
  );
  const results: CheckResult[] = [];
  for (let minute = 0; minute < MINUTES; minute++)
    for (const journey of CORE_JOURNEYS)
      results.push({ at: at(minute), journey: journey.id, ok: !failing.get(journey.id)?.has(minute) });
  return results;
}
const range = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);

test("monthly core availability counts confirmed failures, leaves out announced maintenance and meets 99.5% at its edge", () => {
  const core = (input: Parameters<typeof monthlyAvailability>[0]) =>
    monthlyAvailability(input).find((g) => g.group === "core")!;
  // A single failed check is not an outage; two in a row are, until the next success.
  const single = core({ month: MONTH, results: checks({ health: [100] }), incidents: [], maintenance: [] });
  assert.equal(single.downMinutes, 0);
  assert.equal(single.availability, 1);
  const confirmed = core({
    month: MONTH,
    results: checks({ "catalogue search": [200, 201, 202] }),
    incidents: [],
    maintenance: [],
  });
  assert.equal(confirmed.downMinutes, 3);
  assert.equal(confirmed.eligibleMinutes, MINUTES);
  // 99.5% of 44,640 minutes allows 223 down minutes; one more misses the target.
  const edge = core({
    month: MONTH,
    results: checks({ "home page": range(1000, 223) }),
    incidents: [],
    maintenance: [],
  });
  assert.equal(edge.downMinutes, 223);
  assert.equal(edge.meetsTarget, true);
  const over = core({
    month: MONTH,
    results: checks({ "home page": range(1000, 224) }),
    incidents: [],
    maintenance: [],
  });
  assert.equal(over.meetsTarget, false);
  // Maintenance announced 72 hours ahead leaves the denominator; announced late, its failures count.
  const failing = checks({ "sign-in page": range(3000, 120) });
  const window = { start: boundary(3000), end: boundary(3120) };
  const announced = core({
    month: MONTH,
    results: failing,
    incidents: [],
    maintenance: [{ ...window, announcedAt: new Date(START + 3000 * 60_000 - 80 * 3_600_000).toISOString() }],
  });
  assert.equal(announced.downMinutes, 0);
  assert.equal(announced.plannedMaintenanceMinutes, 120);
  assert.equal(announced.eligibleMinutes, MINUTES - 120);
  const late = core({
    month: MONTH,
    results: failing,
    incidents: [],
    maintenance: [{ ...window, announcedAt: new Date(START + 3000 * 60_000 - 10 * 3_600_000).toISOString() }],
  });
  assert.equal(late.plannedMaintenanceMinutes, 0);
  assert.equal(late.downMinutes, 120);
  // At most four hours a month count as planned, however much was announced.
  const long = core({
    month: MONTH,
    results: checks(),
    incidents: [],
    maintenance: [
      {
        start: boundary(5000),
        end: boundary(5600),
        announcedAt: new Date(START - 7 * 24 * 3_600_000).toISOString(),
      },
    ],
  });
  assert.equal(long.plannedMaintenanceMinutes, 240);
});

test("minutes without checks are disclosed and left out, but a logged incident in them still counts", () => {
  const gap = new Set(range(600, 60));
  const results = checks().filter((r) => !gap.has(Math.floor((Date.parse(r.at) - START) / 60_000)));
  const [core] = monthlyAvailability({ month: MONTH, results, incidents: [], maintenance: [] });
  assert.equal(core!.unmeasuredMinutes, 60);
  assert.equal(core!.eligibleMinutes, MINUTES - 60);
  assert.equal(core!.downMinutes, 0);
  // The checker was down, but the outage is known: those 30 minutes count.
  const [withIncident] = monthlyAvailability({
    month: MONTH,
    results,
    incidents: [{ id: "INC-synthetic-1", group: "core", start: boundary(610), end: boundary(640) }],
    maintenance: [],
  });
  assert.equal(withIncident!.unmeasuredMinutes, 30);
  assert.equal(withIncident!.downMinutes, 30);
});

test("AI and payment provider outages are reported separately and never count against core availability", () => {
  const groups = monthlyAvailability({
    month: MONTH,
    results: checks(),
    incidents: [
      { id: "INC-synthetic-ai", group: "ai", start: boundary(100), end: boundary(220) },
      { id: "INC-synthetic-psp", group: "psp", start: boundary(300), end: boundary(330) },
    ],
    maintenance: [],
  });
  assert.deepEqual(
    groups.map((g) => [g.group, g.downMinutes, g.meetsTarget]),
    [
      ["core", 0, true],
      ["ai", 120, null],
      ["psp", 30, null],
    ],
  );
  assert.equal(groups[0]!.availability, 1);
});

test("a journey check passes only with status 200 and the content it serves", async () => {
  const answers: Record<string, () => Response | Promise<Response>> = {
    "/api/healthz": () => Response.json({ status: "ok" }),
    "/": () =>
      new Response("<!doctype html><html><body></body></html>", { headers: { "content-type": "text/html" } }),
    "/library": () => new Response("Service unavailable", { status: 503 }),
    "/api/public/catalogue": () =>
      new Response("<html>not json</html>", { headers: { "content-type": "text/html" } }),
    "/sign-in": () => Promise.reject(new Error("timeout")),
  };
  const results = await checkJourneys(
    "https://valo.example.invalid",
    async (url) => answers[url.pathname]!(),
    () => new Date(START),
  );
  assert.deepEqual(Object.fromEntries(results.map((r) => [r.journey, r.ok])), {
    health: true,
    "home page": true,
    "template library": false,
    "catalogue search": false,
    "sign-in page": false,
  });
  assert.ok(results.every((r) => r.at === new Date(START).toISOString()));
});
