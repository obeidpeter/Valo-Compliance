# Log inventory

The security baseline's v5.0.0-16.1.1 asks for an inventory of the logging at each layer: what is
logged and in what form, where it goes, how it is used, who can read it and how long it is kept. This
is that inventory, part 4 of [alerts that reach a person](../architecture/alerts.md).
`scripts/src/valo/log-inventory.test.ts` checks it against the code:

- every event the API, the worker and the operator commands log is in the events table below, and
  every event in it is logged;
- the API has one logger, made in one place (`createApplicationLogger`). It writes to its process's
  output and nowhere else; in development it can print the same output more readably (`pino-pretty`).
  The supervisor and a few commands print their JSON events to their output themselves;
- every table named here is in the database's schema.

## Where each record goes

| Record | Written by | Its form | Where it goes | Who can read it | How long it is kept |
| --- | --- | --- | --- | --- | --- |
| A line for each request | The API, as each request ends (`platform/http-logging.ts`) | JSON: the level, the time in milliseconds since the epoch (UTC), the process, the request's id, method and status, how long it took, and its route's pattern | The API's standard output | Whoever can read the host's output: the owner and engineering | As long as the host keeps it. Valo sets no limit (the design's owner points) |
| Events | The API, the worker and the operator commands, through the logger (`platform/logger.ts`), each named in the events table | JSON, as above, with the event's name and its own fields: counts, codes, kinds, a guard's or a limit's name, and an error by its class, code and stack frames | Each process's standard output | As above | As above |
| The worker's supervisor's reports | `workers/export-supervisor.ts` | One JSON object a line: the event's name, and the reason or the check | Its standard output | As above | As above |
| Operator commands' reports | The commands in `artifacts/api-server/src/scripts` and `scripts/ops` | Text or JSON; some also write the report file the command names | The terminal of whoever runs them, and the file they name | The operator | Until the operator removes them |
| The worker's alert file | The worker and the probe command (`modules/operations`) | JSON: the last 1,000 alerts raised or cleared, how far the journal holds them, and the last readings | `generated-artifacts/valo-operations/alerts.json` on the worker's disk, readable by its owner alone | Whoever can read that disk | The last 1,000 changes |
| The worker's heartbeat | The worker | JSON: its health, the time and its process | `generated-artifacts/valo-operations/worker.json` | The supervisor and the probe | Replaced at each turn |
| The alert journal | The worker's copy of its file | A row for each alert raised or cleared: its code, time, reading, limit, runbook and roles | `valo_operational_alerts` | System operators, and emergency system access, in the System area | For good: never changed or removed |
| Security signals | The API, after each refused request | A count for each kind, keyed address hash and minute | `valo_security_signals` | The worker's readings. No screen shows them | A day |
| Request counts | The API, once a minute | How many requests began in each minute, how many failed unexpectedly, and how many took at most each of seven times | `valo_request_minutes` | The worker's readings | A week |
| Limit counters | The API, for each request a limit counts | A count for each limit, keyed subject and window | `valo_rate_buckets` | The limits, and the worker's readings | Until their window ends |
| Histories | The API, the worker and staff actions | The rows of every table a database guard keeps from change or removal, such as staff reads (`valo_staff_access_audit`), role changes (`valo_staff_role_changes`), a privacy request's steps (`valo_privacy_events`) and a workspace's activity (`valo_events`) | Their tables, each with a digest the database keeps as it is written (`valo_history_digests`) | A permanent system operator, in the audit viewer, where each read is itself recorded | For good, but for an erasure and a synthetic workspace's cleanup |
| The hourly counts of the histories | The worker | Which histories' digests no longer match their rows, once an hour | `valo_history_checks` | The worker's reading, and the audit viewer | For good |
| The operator's journal | The restore and backup-removal tools (`scripts/ops/operator_journal.py`) | Hash-chained JSON lines: who ran which tool, why, and what it did | `operator-journal.jsonl` in the private directory `VALO_OPERATOR_JOURNAL` names, on the operator's machine | The operator | As long as the operator keeps it |
| Pings to the external monitor | The worker's supervisor, once it is set up (`platform/valo-external-monitor.ts`) | An HTTPS request to the check's own address, saying only that the check passed or failed | Healthchecks (`hc-ping.com`), only when `VALO_EXTERNAL_MONITORING` names it | Whoever holds the Healthchecks account | As long as the service keeps it |

## What is never written

- The logger removes these wherever they appear: a request's authorization and cookie headers, an
  answer's cookies, and any field named `body`, `payload`, `prompt`, `document` or `profile`.
- An error is written by its class, its code and its stack's frames. Its message never becomes the
  line's message or any of its fields.
- A request's line never holds a value from its address, nor its headers or body: only its route's
  pattern, or `unmatched` or `unrecognised`.
- An address or an account is kept only as a keyed hash, in the security signals and the limit
  counters.

## Events

| Event | Written by | When |
| --- | --- | --- |
| `request.failed` | The API's error handler | A request failed in a way Valo did not expect, by the error's class |
| `request.refused_by_guard` | The API's error handler | A database guard refused what a request sent, by the guard's name |
| `origin.rejected` | The API's identity check | A change was sent from another site's page |
| `quota.denied` | The API's read limit, and its unsubscribe routes | A limit refused a read, or a use of an unsubscribe link, by the limit's name |
| `quota.purge_failed` | The API's limits | Expired limit counters could not be removed |
| `security_signal.failed` | The API's security signals | A refusal could not be counted, by its kind and the error's class |
| `security_signal.unavailable` | The API's security signals | A refusal could not be counted because the key for its hash is not set |
| `security_signal.purge_failed` | The API's security signals | Expired signals could not be removed |
| `clerk_proxy.upstream_failed` | The API's identity provider proxy | The identity provider could not be reached |
| `payment.signature_rejected` | The API's payment webhook | A message from the payment provider failed its signature check |
| `email.signature_rejected` | The API's email webhook | A delivery report failed its signature check |
| `email.event_unreadable` | The API's email webhook | A signed delivery report was not in the form the email provider documents |
| `unsubscribe.refused` | The API's unsubscribe routes | An unsubscribe link was not one Valo made, or not one it still honours. The link is not logged |
| `price.recorded` | The owner's price screen | The owner recorded a price |
| `bundle.recorded` | The owner's bundle screen | The owner recorded a bundle |
| `commercial_setting.recorded` | The owner's settings screen | The owner recorded a commercial setting |
| `staff.role_changed` | The staff roles screen | A staff role was granted or revoked |
| `source_inspection.capture_unreadable` | Source checks | A source's captured copy could not be read |
| `review_preparation.failed` | Review preparation | A review could not be prepared, by its code |
| `editorial.run_completed` | The editorial pipeline | An editorial run finished |
| `editorial.run_failed` | The editorial pipeline | An editorial run failed |
| `privacy.lock_connection_failed` | The erasure | The erasure's lock connection failed |
| `db.connection_failed` | The API and the worker | A pooled database connection failed while idle, by its login and code: the pool dropped it, and the next query opens another |
| `operations.request_counts_unwritten` | The API's request counts | The counts could not be written, and wait for the next write |
| `operations.request_counts_written` | The API's request counts | The counts were written again after a failure |
| `operations.request_minutes_not_removed` | The API's request counts | Minutes older than a week could not be removed |
| `export.worker_started` | The worker | The worker started |
| `export.startup_failed` | The worker | The worker could not start |
| `export.shutdown_failed` | The worker | The worker could not stop cleanly |
| `export.dispatch_failed` | The worker | An export could not be dispatched |
| `export.orphan_cleanup_failed` | The worker | Export files left behind could not be removed, by how many |
| `export.retention_binding_failed` | The worker | Exports past their retention could not be bound, by how many |
| `workspace_export.cleanup_pending` | The worker | Whole-workspace downloads still wait to be cleared, by how many |
| `workspace_export.cleanup_failed` | The worker | Clearing whole-workspace downloads failed |
| `privacy.erasure_replay_held` | The worker | A privacy hold kept an erasure from being replayed, by how many |
| `operational.dispatch_failed` | The worker | A scheduled task failed, by its name |
| `queue.database_error` | The worker | The job queue lost its database |
| `worker.heartbeat_publish_failed` | The worker | The worker's heartbeat could not be written |
| `operations.internal_probe_failed` | The worker | Its readings could not be taken |
| `operations.alert_journal_behind` | The worker | Alerts wait to be copied to the journal, by how many |
| `operations.alert_journal_lost` | The worker | The file dropped alerts before the journal took them, by how many |
| `worker_supervisor.started` | The worker's supervisor | The supervisor started |
| `worker_supervisor.ready` | The worker's supervisor | The worker it started is ready |
| `worker_supervisor.restart` | The worker's supervisor | It restarted the worker, with the reason and the attempt |
| `worker_supervisor.exhausted` | The worker's supervisor | It stopped restarting the worker, with the reason |
| `worker_supervisor.stopping` | The worker's supervisor | It is stopping the worker, with the reason |
| `worker_supervisor.stopped` | The worker's supervisor | The worker stopped, with the reason |
| `external_monitor.acknowledged` | The external monitor | Healthchecks took a ping, by the check |
| `external_monitor.delivery_failed` | The external monitor | A ping could not be delivered, by the check |
| `operations.probe` | The probe command | It took the readings, with what it found |
| `storage_probe.reserved` | The storage probe command | It checked the production storage's isolation |
| `recovery.isolated_drill` | The recovery drill command | It finished an isolated recovery drill, with its report |
| `editorial.source_attempt` | The source retrieval command | It tried to fetch a source |
| `editorial.instrument_attempt` | The instrument retrieval command | It tried to fetch an instrument |
| `editorial.proof_finished` | The editorial proof command | Its proof finished |
| `editorial.proof_failed` | The editorial proof command | Its proof failed, by its code |
| `finite-preparation-loading` | The finite inference command | It is loading a preparation, with no inference call made |
| `finite-preparation-template` | The finite inference command | It wrote a preparation's template |
| `customer_ai.evaluation_finished` | The drafting assistant's evaluation command | Its evaluation finished |
| `customer_ai.evaluation_failed_before_report` | The drafting assistant's evaluation command | Its evaluation failed before its report |
| `reminder.evaluation_finished` | The reminders' evaluation command | Its evaluation finished |
| `reminder.evaluation_failed_before_report` | The reminders' evaluation command | Its evaluation failed before its report |
| `p0.journey_check` | The customer journey command | One of its checks passed |
| `p0.customer_journey_failed` | The customer journey command | Its journey failed, by the phase |
| `checker.journey` | The requirements check journey command | One of its checks passed |
| `checker.journey_check_failed` | The requirements check journey command | One of its checks failed |
| `checker.journey_failed` | The requirements check journey command | Its journey failed, by the phase |
| `controlled_privacy_browser_failed` | The privacy data browser command | Its browser check failed |
| `bundle-secrets` | The bundle check, after each build of the web app in CI | It read what the browser is sent: how many files, and each finding by file and by the setting or the secret's shape, never the secret |

## Not yet

- **A system of their own** (the security baseline's v5.0.0-16.4.3). The logs stay on the machine that
  wrote them, kept as long as its host keeps its output. Where they go instead is the owner's choice,
  and may cost money (the design's owner points).
- **How long the host keeps them.** No host has been chosen for staging or production, so no retention
  for the process output has been set or checked.
