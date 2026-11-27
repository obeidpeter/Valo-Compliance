# Responding to an incident

Design for the finishing plan's Phase 7 row "An incident and breach procedure with a rehearsal script",
for SEC-008 and PRV-003. It is a proposal under the owner's delegation of 24 November. What it says
about telling the authority or the people affected is a proposal for the privacy owner, not legal
advice and not a review by a privacy or security professional.

The requirements, verbatim from the specification:
- SEC-008: "Alert on repeated denied access, bulk exports, role changes, signature failures and
  unusual payment/AI activity. Accept: a tabletop incident demonstrates containment, evidence
  preservation, privacy escalation and customer communications."
- PRV-003: "Provide request verification, correction/export/deletion and legal-hold handling. Accept: a
  test request traverses all systems. Notification triggers/deadlines must have retrieved statutory
  evidence and AI checks; the privacy owner owns incident decisions. Uncertainty prompts immediate
  assessment and authority contact, not an invented deadline."

## What there is

- **Detection.** The operations probe reads nine security signals: refusals of one address, signature
  failures, role changes, callers at an export, payment or AI limit, refusals by a database guard, a
  member of staff reading many records, and histories whose digest no longer matches. Each raises an
  alert under the "Security/privacy incident" runbook, with the incident lead and the privacy owner
  accountable. The alerts are written to a file on the worker; no screen shows them yet (the Phase 7
  row "Alerts that reach a person").
- **Containment.** Each lever records who used it, when and why:
  - the System area's service safety pauses, for the drafting assistant and for checkout (ADM-007);
  - holding or withdrawing a content or rule version, in the Content area (ADM-007);
  - revoking a staff assignment, in the System area's staff role administration. Emergency access
    expires on its own after at most 60 minutes;
  - a hold on a privacy request, and a hold of its own on a workspace, which stops Valo's own deletion
    of its data ([finishing a privacy request](privacy-requests.md), slice 4).

  Ending a person's sign-in sessions happens at the sign-in provider, outside Valo.
- **Evidence.** The histories refuse changes and removal and keep digests, which an hourly count checks
  (ADM-009). Staff reads, role changes, safety pauses, privacy requests and holds are among them, and the
  System area's audit history shows them. Encrypted backups hold every record for 35 days (the owner's
  approval of 20 November 2026).
- **Privacy.** The privacy owner owns incident decisions. No statutory time limit for telling the
  authority or the people affected appears anywhere in Valo, as none has the retrieved statutory
  evidence and AI checks PRV-003 requires.
- **Communications.** Valo sends no email (the finishing plan's Phase 4). Inside the app, support staff
  answer a person on a support request they opened, and privacy staff answer one on a privacy request.
  Nothing tells every customer at once.
- **What is missing.** The runbook's row is one sentence. Nothing strings the levers into steps, no
  tabletop script exists, and nothing rehearses the steps.

## The parts

### Part 1: the procedure

`docs/valo/incident-procedure.md`: when it applies, who does what, and seven steps. The steps are: open
the record, contain, preserve evidence, assess and escalate to the privacy owner, tell the people
affected, recover, and review. Each step names Valo's own lever for it, where staff find it, and what to
record. It keeps the incident record outside this public repository and outside customer logs, and it
never copies a customer's documents or messages into it.

### Part 2: the tabletop script

`docs/valo/incident-tabletop.md`: one incident, told in injects, for the incident lead, the privacy
owner, privacy and support staff and the owner to talk through. Each inject asks what they do next.
Its expected answers come from the procedure, and together they cover SEC-008's four outcomes:
containment, evidence preservation, privacy escalation and customer communications. It ends with a
record sheet for who took part, when, the decisions and the gaps found. It says that it has not been
held.

### Part 3: a rehearsal on synthetic data, in CI

A database test takes the tabletop's technical steps on a disposable database:
- **detection:** refusals of one address and a role change raise their alerts under the incident
  runbook, with the privacy owner accountable;
- **containment:** the incident lead pauses the drafting assistant and checkout and revokes the suspect
  staff assignment, after which it is refused;
- **evidence preservation:** privacy staff hold the affected workspace, so Valo's own deletion of its
  data stops; the suspect's reads stay in the staff access history; every history still matches its
  digest;
- **privacy escalation:** the hold is placed by privacy staff, and released only by another member;
- **customer communications:** support staff answer the affected person on their support request, the
  person reads the answer in the app, and nothing is sent outside it.

A passing rehearsal shows that the levers work as the procedure says. It is not a tabletop, and it
accepts nothing.

### Part 4: no invented time limit

A test reads the procedure and the tabletop script and fails on any sentence that puts a length of
time beside telling, notifying or reporting, or beside the authority. The procedure's only periods are
Valo's own: how long emergency access lasts and how long backups are kept.

## What does not change

- No message is sent, and no production setting changes. The rehearsal uses synthetic records only.
- The levers are the ones that exist. The procedure adds no new switch.
- The human tabletop is the owner's to hold, with the people named. A rehearsal in CI does not replace
  it.

## The slices

| # | Slice | Requirements | State |
| --- | --- | --- | --- |
| 1 | **The procedure, the tabletop script and the rehearsal.** Parts 1 to 4, in one pull request. | SEC-008, PRV-003 | Built |

## Settled while building it

- **The rehearsal runs on its own.** Pausing the drafting assistant or checkout pauses it for every
  workspace, so the rehearsal has a script of its own (`test:valo-incident-rehearsal-db`) that runs one
  test at a time, in its own step of the database job. It checks that neither service is paused before
  it starts, and lifts both pauses before it ends, even when a check fails.
- **The suspect and the incident lead keep their records.** A role change needs the sign-in provider's
  form of an identity, and the staff access history refuses to remove a record that is not a synthetic
  test identity's. So, as in the staff roles test, the rehearsal keeps their role change and their
  reads, and only ends their assignments. It removes everything else it made.
- **What the evidence step checks.** The suspect's reads stay after the revocation, and the database
  refuses to change or remove them. The hold refuses a change to its reason. The pauses and the
  revocation are kept with who made them and why. The holds' history still matches its digest. It does
  not check every history's digest: other tests in the database job remove their synthetic records from
  histories with the triggers off, which leaves those digests behind, so such a check would depend on
  which tests ran first.
- **Customer communications.** Support staff answer the person on their support request with the
  procedure's draft, and the person reads it in the app. The rehearsal finds no message queued for the
  person in either outbox. It does not show telling every customer at once, which Valo cannot do.
- **No time limit.** A check in the scripts' suite reads the procedure, the tabletop script and this
  design, and fails on any sentence that puts a length of time beside telling, notifying or reporting,
  or beside the authority. It also checks that the procedure quotes PRV-003's two rules for incidents
  as the specification gives them.

## The owner's points

1. Who the incident lead and the privacy owner are, by name, kept outside this public repository.
2. Where an incident's record is kept, outside this repository and outside customer logs.
3. The authority's contact route, the Nigeria Data Protection Commission's, recorded with the owner's
   other private contacts. The procedure contacts it at once when the privacy owner is unsure, and
   names no time limit.
4. Holding the tabletop with the people named, and keeping its record sheet.
5. How the people affected are told outside the app, once Valo can send email (Phase 4): the channel,
   the sender and the words, each approved by the owner.
6. The period within which the review after an incident is written. None is set.
