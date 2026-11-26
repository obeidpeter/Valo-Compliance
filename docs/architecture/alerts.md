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
- **Refused input** (the security baseline, v5.0.0-16.3.3): an answer refusing a request's input (422)
  is counted by keyed caller, and one caller sending much refused input raises an alert.
- **Money and AI spend** (SEC-005, SEC-008): checkouts and refunds of all workspaces together in an
  hour, by count and amount, and the AI budget's spend in an hour against its allowance.
- **Whole-workspace downloads** (SEC-008's bulk exports): data downloads of whole workspaces, and staff
  copies of a workspace's data, in an hour.

### Part 3: failures, time and backlogs

- **Each request counted.** The API counts its requests by minute: how many, how many failed with a
  server error, and how long they took, in fixed buckets of time that add up across processes. Each
  process writes its minute's counts once, outside any transaction.
- **Alerts on them**: a server failure rate over a limit, with enough requests to mean something, and
  a 95th percentile time over NFR-003's second.
- **More backlogs**: reminder emails waiting past their time, and the scheduled jobs' queue.
- **The route in each request's log**: the route's pattern, such as `/workspace/documents/:id`, never
  the values in its address.

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
| 2 | Part 3: request counts, failure and time alerts, more backlogs, the route in each request's log | Not built |
| 3 | Part 2: spread-out abuse, refused input, money and AI spend, whole-workspace downloads | Not built |
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
