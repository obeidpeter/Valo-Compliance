# Incident tabletop: a privacy staff account used by someone else

A script for talking through one incident with the people in
[incident-procedure.md](incident-procedure.md): the incident lead, the privacy owner, privacy staff,
support staff and the owner (SEC-008, PRV-003; [design](../architecture/incident-response.md)).

**It has not been held.** The owner holds it with the people named for each role, and keeps the
record sheet below outside this public repository. A rehearsal in CI takes the same technical steps on
synthetic data (see the procedure's last section); it does not replace this tabletop, and it accepts
nothing.

## How to run it

- One person reads each inject aloud and asks its question. The others say what they would do, who
  does it and where, using the procedure. Only then does the reader turn to the expected answer.
- Write down every gap: a step nobody knew, a lever that was missing or slow, a decision with no owner.
- Use the screens on the development site if that helps, with synthetic records only. Never use a real
  customer's data.

## The incident

### Inject 1: an alert

The operations probe raises `DENIED_ACCESS_DETECTED`: one address was refused more than twenty times
in ten minutes. Its runbook is "Security/privacy incident".

*What do you do first?*

Expected:
- the incident lead opens the record, with the time, the alert's code and who leads (step 1);
- the lead reads the alert file and the security signals, and treats it as an incident, since it is in
  doubt.

### Inject 2: an account that was not its owner's

The System area's audit history shows one privacy staff account reading many privacy requests late at
night. Its holder says it was not them.

*How do you stop it?*

Expected (step 2):
- the incident lead revokes the account's privacy assignment in staff role administration, with a
  reason;
- the account's sessions are ended at the sign-in provider;
- the lead considers the service safety pauses, and records why each step was or was not taken.

### Inject 3: a deletion about to run

One of the requests the account read is a customer's deletion request, and its erasure is part done.

*What must stay as it is, and how?*

Expected (step 3):
- privacy staff hold the customer's workspace, so Valo's own deletion of its data stops, and nobody
  runs cleanup by hand;
- the lead copies the alert entries, and the times and request identifiers of the log lines that
  matter, into the record, with no private data;
- the lead checks that no history's digest has stopped matching (`HISTORY_INTEGRITY`).

### Inject 4: the privacy owner

The privacy owner joins.

*What did the account see, and who must be told?*

Expected (step 4):
- the privacy owner assesses whose data it was, what kind, and what happened to it;
- nobody gives a time limit as the law's;
- if the privacy owner is unsure whether the law requires telling the authority, the privacy owner
  contacts the Nigeria Data Protection Commission at once rather than waiting;
- each decision is recorded, with who made it and what it rested on.

### Inject 5: the customer writes in

The customer whose request was read writes on their support request: "Has something happened to my
account?"

*What do you say, and how?*

Expected (step 5):
- the privacy owner decides what the customer is told;
- support staff answer on the support request, starting from the procedure's draft, in plain words,
  without guessing or blaming;
- nothing goes outside the app without the owner's approval of the channel and the words;
- a copy of the answer goes into the record.

### Inject 6: the cause is fixed

The account's holder has a new sign-in, and the cause is found and fixed.

*How do you finish?*

Expected (step 6):
- another member of privacy staff releases the hold, with a reason, and the erasure goes on where it
  stopped;
- a fresh assignment is granted only through staff role administration;
- the lead checks the histories and the alerts;
- the review is written (step 7).

## What the tabletop should show

SEC-008's four outcomes, each from an inject above:

| Outcome | Shown by |
| --- | --- |
| Containment | Inject 2 |
| Evidence preservation | Inject 3 |
| Privacy escalation | Inject 4 |
| Customer communications | Inject 5 |

## Record sheet

Keep this outside this repository.

- Date, and who took part, by role.
- For each inject: what was decided, by whom, with which lever, and the gaps found.
- For each of the four outcomes: shown, partly shown or not shown, and why.
- The changes to make, each with an owner.
