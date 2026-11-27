# Availability (NFR-001): proposed definition, not yet measured

NFR-001 asks for "99.5% monthly availability for core web/API journeys; separate status for AI
and PSP dependencies", accepted with "external synthetic checks; incident log; documented
denominator and planned-maintenance treatment".

**Status.** Everything below is a proposal: the owner approves or changes it before launch.
Nothing measures production availability yet. Until a reviewed launch, production answers only
`/api/healthz`, and no external checker runs. The calculation and the check runner exist and are
tested (`artifacts/api-server/src/lib/valo-availability.ts` and its tests).

## Core journeys

| Journey | Request | Passes when |
| --- | --- | --- |
| health | `GET /api/healthz` | 200 with JSON |
| home page | `GET /` | 200 with an HTML page |
| template library | `GET /library` | 200 with an HTML page |
| catalogue search | `GET /api/public/catalogue?q=invoice&page=1` | 200 with JSON |
| sign-in page | `GET /sign-in` | 200 with an HTML page |

Signed-in journeys, such as saving a draft or exporting it, would need a synthetic account in
production, which is an owner decision. Until then they count only through logged incidents.

## How the month is counted

- **Checks.** Every journey once a minute, from outside the application host, each with a
  10-second limit.
- **Down.** A failed check that the journey's next check confirms starts an outage, which lasts
  until the journey's next successful check. One failed check alone is not an outage. Every minute
  that a logged core incident touches also counts as down.
- **Denominator.** The calendar month in UTC, less planned maintenance, and less the minutes in
  which some journey has no check and no incident is logged (the checker was not running). Those
  unmeasured minutes are reported with the figure and are never assumed available.
- **Planned maintenance.** It counts only when customers were told at least 72 hours ahead, and for
  at most four hours a month. Maintenance announced later, or beyond four hours, counts as downtime
  when checks fail during it.
- **Target.** 99.5% of the counted minutes: 223 down minutes in a 31-day month meet it, 224 do not.

## AI and payment provider status

AI drafting and the payment provider each get their own figure, from the incidents logged against
them. Their outages never change the core figure.

## Incident log

Each entry records an id, the group (core, AI or payment provider), the start and end in UTC, the
journeys affected, whether it was planned maintenance and when that was announced, what customers
saw, the cause and the follow-up. The calculation reads only the id, group, start and end. The log
is kept in the owner's private operations store, not in this public repository, because entries can
describe customers or security matters.

## Running the checks

```sh
VALO_SYNTHETIC_CHECK_URL=https://<deployed origin> pnpm --filter @workspace/api-server exec tsx src/scripts/synthetic-checks.ts
```

This prints one JSON line per journey and sends no account, cookie or customer data. An external
scheduler runs it every minute and keeps the lines. `monthlyAvailability` then computes the month's
figures from those lines, the incident log and the announced maintenance windows.

## Decisions the owner needs to make

- Approve or change this definition.
- Choose where the checks run (outside the application host) and where their results and the
  incident log are kept. A monitoring service would be a new processor and may cost money.
- Decide whether a synthetic account may exercise signed-in journeys in production.
