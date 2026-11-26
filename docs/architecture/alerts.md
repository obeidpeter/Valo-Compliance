# Alerts that reach a person

Design for the finishing plan's Phase 7 row "Alerts that reach a person", for SEC-008, SEC-005 and
NFR-010. It is a proposal under the owner's delegation of 24 November.

The requirements, verbatim from the specification:
- SEC-008, "Monitoring and response": "Alert on repeated denied access, bulk exports, role changes,
  signature failures and unusual payment/AI activity. Accept: a tabletop incident demonstrates
  containment, evidence preservation, privacy escalation and customer communications."
- SEC-005, "Abuse and quotas": "Start with configurable ceilings: anonymous reads 60/min/IP,
  authenticated reads 120/min/user, AI 5/min, checkout and export creation 10/min/user plus account
  limits. Accept: legitimate errors explain recovery; distributed abuse and financial-cost spikes
  trigger alerts."
- NFR-010, "Operability": "All critical journeys instrumented; alerts have owners and runbooks; no
  private document text in logs. Accept: Synthetic failures verify alerts, redaction and support
  escalation."

The plan's row: "Alerts are written to a file on the worker and no screen reads them. A staff alert
list; signals for abuse spread over many callers, for AI and payment cost, and for bulk data exports;
alerts on error rate, latency and backlogs; the route in each request's log (checked twice); and,
from the security baseline, logs sent to a system of their own, an inventory of them, and refused
input recorded as a security event."

## What there is

- **Readings.** Once a minute the worker takes 17 readings from the database
  (`modules/operations/valo-operations.ts`): the database itself; five backlogs (exports, file
  cleanup, export retention, workspace cleanup, privacy requests past Valo's aim) and paid orders
  without their access; and nine security readings: refusals of the most refused address in ten
  minutes, signature failures, role changes in an hour, callers at the export, payment and AI limits,
  database guard refusals, the most a member of staff read in an hour, and histories whose digests no
  longer match. It also reads the worker's own heartbeat.
- **Alerts.** A reading over its limit, or one that cannot be taken, raises an alert named for it,
  such as `DENIED_ACCESS_DETECTED` or `EXPORTS_BACKLOG`, and the alert clears when the reading falls
  back. Each names its runbook and the roles accountable for it (`ALERT_RUNBOOKS`), as the operating
  runbooks do. The limits are development defaults, not reviewed thresholds.
- **Where they go.** The worker writes each raised and cleared alert to `alerts.json` on its own disk,
  keeping the last 1,000, and tells its supervisor whether any is active. Nothing else reads the file,
  and no screen shows an alert. An alert the database cannot hold (the database being down) is only in
  the file.
- **Logs.** Each request's log line has its time, request id, method, status and duration, but not
  its route. The logs go to the process's output and nowhere else.
- **Not watched.** Refusals spread over many addresses, each under its own limit; the money and AI
  spend of all callers together; data downloads of whole workspaces; the rate of server failures; how
  long requests take; and refused input.

## The parts

### Part 1: alerts kept where staff can read them

- **A journal in the database**, `valo_operational_alerts`: one row for each alert raised or cleared,
  with its code, whether it was raised or cleared, when, the reading and its limit, and the runbook
  and roles named at that time. A row is never changed or removed; a database trigger refuses both,
  as for the other histories.
- **The file is the outbox.** The worker still writes each change to its file first, so an alert is
  kept even while the database is down. After each reading it copies to the database every change the
  database does not yet hold, by the change's own id, and records how far it has copied. A database
  outage is therefore in the journal once the database is back, with the time it began. The copy holds
  no lock on the file while the database takes it, so a slow database keeps no reading waiting. The file
  keeps the last 1,000 changes: a change it drops before the database took it is lost to the journal,
  and the copy counts it and the worker logs the count.
- **The System area lists them.** A system operator sees, in the staff page's System area:
  - each active alert in plain words, when it was raised, the reading and its limit, the runbook to
    follow and the roles accountable;
  - the latest changes, raised and cleared, newest first.

  Emergency system access may read them too: an incident is when it is needed.
- **No message is sent.** Sending an alert by email or another channel is an external message, which
  needs the owner's approval and a provider (the owner's points).
- **Two migrations** add the journal and its guards. The Replit development database takes them by hand
  ([runbook](../valo/migration-operational-alerts.md)); until it does, the System area says that a
  database update is waiting, and the worker keeps the alerts in its file.

### Part 2: signals no reading watches yet

- **Abuse spread over many callers** (SEC-005): refusals of every address together in ten minutes, and
  how many callers a limit refused in ten minutes. A refusal by a limit (429) is counted as a security
  signal of its own, by keyed caller, as refusals of access are now.
  - Built: each 429 is counted as `limit_refusal`. `SPREAD_REFUSALS_DETECTED` when refusals of access
    of every address together come to more than a hundred in ten minutes, and `LIMITED_CALLERS_DETECTED`
    when a limit refused more than ten callers in ten minutes, each caller counted once however often it
    was refused. One address refused more than twenty times still raises `DENIED_ACCESS_DETECTED`.
- **Refused input** (the security baseline, v5.0.0-16.3.3): an answer refusing a request's input (422)
  is counted by keyed caller, and one caller sending much refused input raises an alert.
  - Built: each answer refusing a request's input is counted as `refused_input`: a body that is not
    JSON (400), too large or too complex (413), compressed (415), or details not accepted (422).
    `REFUSED_INPUT_DETECTED` when one address sent more than twenty in ten minutes.
- **Who a refusal is counted for.** A page the web server renders on this machine passes on its
  visitor's address, and each refusal is counted for that visitor, as the read limit counts it; before,
  every page render's refusal would have counted as the web server's. Every other request is counted
  for the address it came from.
- **What a count costs.** Each counted refusal is one write after its answer is sent, into one row per
  address, kind and minute, as the read limit's own count is one write per read. A flood of refusals
  from one address therefore writes as often as it is refused; a ceiling for each address and minute
  can follow if that ever matters more than the count.
- All three alerts fall to the security/privacy incident runbook, and their limits are development
  defaults. **One migration** lets the security signals table take the two new kinds; the Replit
  development database takes it by hand ([runbook](../valo/migration-security-signal-kinds.md)), and until
  it does, those refusals are answered as before and their counts are refused and logged.
- **Money and AI spend** (SEC-005, SEC-008): checkouts and refunds of all workspaces together in an
  hour, by count and amount, and the AI budget's spend in an hour against its allowance.
- **Whole-workspace downloads** (SEC-008's bulk exports): data downloads of whole workspaces, and staff
  copies of a workspace's data, in an hour.

### Part 3: failures, time and backlogs

- **Each request counted.** The API counts its requests by minute: how many, how many failed with a
  server error, and how long they took, in fixed buckets of time that add up across processes. Each
  process writes its minute's counts once, outside any transaction.
  - Built as `valo_request_minutes`: one row a minute, with the requests, the unexpected failures, and
    how many took at most 100, 250 and 500 milliseconds, 1, 2.5, 5 and 10 seconds. Each count holds every
    shorter one, so the counts of every process add up, and the table refuses counts that do not hold
    together. It holds no address, identity or request content.
  - Only the API's own requests count: not the health check, nor the identity provider's proxy. A
    failure is an answer the error handler gives to an unexpected error; a 503 Valo means to give, such
    as while a database update waits, is not one.
  - Each API process keeps its counts in memory and writes its finished minutes once a minute, in one
    statement, outside any transaction; the minute under way is written as the process stops. Counts the
    database cannot take wait for the next write, an hour of minutes at most; an older one is dropped and
    counted as dropped. A failing write is logged once, until one succeeds again. Minutes older than a
    week are removed, at most once an hour (a development default). Production, which answers only the
    health check, counts nothing.
- **Alerts on them**: a server failure rate over a limit, with enough requests to mean something, and
  a 95th percentile time over NFR-003's second.
  - Built over the last ten minutes, and only once there are a hundred requests or more; fewer read as
    nothing. `REQUEST_FAILURES_DETECTED` when more than 10 in 1,000 failed unexpectedly, and
    `REQUEST_TIME_DETECTED` when the time 95 in 100 took at most is over 1,000 milliseconds, read to the
    counts' fixed times (10,001 means longer than ten seconds). Both are NFR-003's own limits: "p95 ≤1s
    … <1% unexpected 5xx". Both fall to the site runbook.
- **More backlogs**: reminder emails waiting past their time, and the scheduled jobs' queue.
  - Built: `REMINDERS_BACKLOG` for a reminder still pending fifteen minutes past its time (a held one is
    held on purpose), and `JOB_QUEUE_BACKLOG` for a scheduled job still waiting ten minutes past its
    start. Both fall to the worker's runbook.
- **The route in each request's log**: the route's pattern, such as `/workspace/documents/:id`, never
  the values in its address.
  - Built: the line written as a request ends names the route it matched, such as
    `/api/admin/privacy-cases/:id`, or `unmatched`. Every router is mounted on a fixed path, so the part
    before the route holds no value; any part that is not a fixed word or a named parameter makes the
    whole route `unrecognised`, so no value is written.
- **One migration** adds the counts' table. The Replit development database takes it by hand
  ([runbook](../valo/migration-request-minutes.md)); until it does, the API logs once that its counts
  wait, and the two request readings cannot be taken, which raises their own alerts.

### Part 4: the logs themselves

- **An inventory** (the security baseline, v5.0.0-16.1.1): what each part logs, where it goes, who can
  read it and for how long it is kept: the request logs, the worker's alert file, the journal, the
  security signals, the request counts and the histories.
- **A system of their own** (v5.0.0-16.4.3): logs leave the machine that wrote them only once the owner
  chooses where they go, which may cost money (the owner's points).

## What does not change

- The readings, their limits, their runbooks and the supervisor's signal stay as they are; the journal
  adds where alerts are kept, not when they are raised.
- No alert is sent anywhere outside Valo.

## Slices

| Slice | What | State |
| --- | --- | --- |
| 1 | Part 1: the journal, the copy from the file, and the System area's list | Built |
| 2 | Part 3: request counts, failure and time alerts, more backlogs, the route in each request's log | Built |
| 3a | Part 2: spread-out abuse and refused input | Built |
| 3b | Part 2: money and AI spend, whole-workspace downloads and staff copies | Not built |
| 4 | Part 4: the log inventory, and the security baseline updated | Not built |

## The owner's points

1. **Who is told, and how.** The list waits for someone to open it. An alert that reaches a person who
   is not looking needs a message: an email, a text or a pager. Each is an external message, which
   needs the owner's approval and a provider.
2. **The limits.** Every limit is a development default. Reviewed thresholds need the traffic of a
   staging or production service to set them against.
3. **Where logs go.** A system of their own for logs is a hosted service the owner chooses, and may
   cost money.
4. **Who else sees alerts.** System operators see them all. Whether the finance and privacy staff
   named accountable for some should see those in their own areas is the owner's decision.
