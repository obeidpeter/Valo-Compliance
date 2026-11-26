# Finishing a privacy request

Design for the finishing plan's Phase 7 row "Finishing a privacy request", for PRV-003. It is a
proposal under the owner's delegation of 24 November. What it says about time and retention is a
proposal for the privacy owner, not legal advice and not a review by a privacy professional.

The requirement, verbatim from the specification:
- PRV-003: "Provide request verification, correction/export/deletion and legal-hold handling. Accept: a
  test request traverses all systems. Notification triggers/deadlines must have retrieved statutory
  evidence and AI checks; the privacy owner owns incident decisions. Uncertainty prompts immediate
  assessment and authority contact, not an invented deadline."

## What there is

- **A request has six steps**, one for each place it is carried out: confirming it is the person
  (`identity_verification`), their Valo workspace (`application`), their files (`private_files`), their
  sign-in account (`managed_identity`), the other services Valo uses (`external_processors`), and the
  records Valo must keep and its backups (`retention_and_recovery`).
- **A request stops at "Partly done"** (`partially_fulfilled`). Preparing a data download, recording a
  correction and finishing a development erasure each confirm the workspace step and hold the other
  four. No code records any of those four, and no action leads to "Done" (`fulfilled`), although the
  completion check exists (`assertPrivacyCompletion`): every step confirmed or not needed, and the first
  two confirmed.
- **What the person sees.** Each step's words, and each event's reason, are shown to the person who
  asked, on their privacy page.
- **A hold is a status.** Privacy staff put a request on hold with a reason, and release it. The erasure
  and the removal of old data downloads check it. Releasing it rebuilds the status from the request's
  other fields, so a partly done data download or correction that was held comes back "With privacy
  staff" (`assigned`), and no action then fits it. A hold cannot exist without a request, and a held
  data download or correction does not stop anything else.
- **No time.** No request has a date it should be done by, the staff queue is in the order requests
  arrived, and no alert looks at privacy requests.

## The parts

### Part 1: a hold returns a request to where it was

- Releasing a hold returns a request whose workspace step is confirmed to "Partly done". Every other
  request returns as it does today.

### Part 2: the four outside steps, and "Done"

- **Recording a step.** On a partly done request, its privacy staff member records each of the four
  outside steps as confirmed or not needed, with the words the person who asked will read: what was
  done, where and when. The screen says that the person sees them. Each record is an event in the
  request's signed history, and a step can be recorded again, with its reason, until the request is
  done.
- **Finishing.** Once every step passes the completion check, the staff member marks the request done.
  It then says what was done in each place, and nothing changes it after.
- **A test request through every step.** A database test takes a synthetic deletion request from the
  person's own request to "Done": confirmed, claimed, erased, its four outside steps recorded, and
  finished (PRV-003's "a test request traverses all systems").

### Part 3: how long a request has been open

- **No time limit is stated as the law's.** PRV-003 says deadlines need retrieved statutory evidence
  and AI checks; neither has been done for privacy requests, so no screen names a legal time limit.
- **Valo's own target.** Each open request shows how long it has been open and the date Valo aims to
  finish it by: a number of days after it was made, which the privacy owner sets. The screen says that
  the date is Valo's own aim, not a time limit set by law.
- **An alert.** The operations probes count open requests past that date, and raise an alert with its
  runbook entry. The staff queue lists the oldest open request first.

### Part 4: a hold of its own

- **A hold on a workspace,** apart from any request: privacy staff place it with a reason, and release it
  with one. It is kept with who placed and released it, and when.
- **What it stops.** While a workspace is held, Valo's own deletion of its data stops: an erasure does
  not start or continue, and its old data downloads are not removed. A person's own changes in their
  workspace go on.
- **Who sees it.** Privacy staff. Its reason is not shown to the person whose workspace is held.

## What does not change

- Production erasure stays off, and nothing is sent to an outside service. Recording a step records
  what staff did elsewhere; it does nothing there itself.
- The signed history and its checks stay as they are. Every new action is an event in it.
- Tests use synthetic requests only.

## The slices

Each slice is its own pull request.

| # | Slice | Requirements | State |
| --- | --- | --- | --- |
| 1 | **A hold returns a request to where it was.** Part 1, with a database test. | PRV-003 | Built |
| 2 | **The outside steps and "Done".** Part 2: two staff actions, the staff screen, and the database test of a request through every step. | PRV-003 | Built |
| 3 | **Age, target and alert.** Part 3: the target the owner sets, the queue's order and the alert. | PRV-003 | Built |
| 4 | **A hold of its own.** Part 4, with a migration, its checks in the erasure and the removal of downloads, and the staff screen. | PRV-003 | Not started |

## Settled while building it

### Slice 1: a hold returns a request to where it was

- **The rule.** Releasing a hold returns a request whose workspace step is confirmed to "Partly done":
  a prepared data download, or a recorded correction. An erasure's request returns as it did before:
  partly done once the workspace's rows are erased, and being carried out until then.
- **What stays as it was.** A request held before anything was done returns as before: to its staff
  member, or to waiting for staff or for the person's confirmation. So does one held while staff waited
  for more information, so the person can no longer reply to that question; staff ask it again.
- **The database test** prepares a synthetic data download and records a synthetic correction, holds
  and releases each, and finds each partly done again, with its prepared result and its steps as they
  were. Without the change, the data download came back "With privacy staff". A request held before
  anything was done still comes back to its staff member.

### Slice 2: the outside steps, and "Done"

- **Two staff actions.** `record_step` records one of the four outside steps as confirmed or not
  needed, and `complete` marks the request done. Only the member of privacy staff who claimed the
  request takes either, and only while it is partly done.
- **The words are the person's.** What staff write becomes the step's words and the reason in the
  request's signed history. The person who asked reads both on their privacy page, and the staff screen
  says so before anything is sent.
- **Again, until done.** A step can be recorded again, with its reason, until the request is done. Each
  record is an event in the signed history.
- **"Done".** A request can be marked done once every step is confirmed or not needed and the first two
  are confirmed. That completion check existed, but nothing reached it. A finished request says "This
  request is done. Each step says what was done there, or why it was not needed.", and no action changes
  it after. A data download's prepared result stays the person's to fetch.
- **What it does not check.** A recorded step is what staff say they did elsewhere. Valo does not reach
  the sign-in service, the other services or the backups to confirm it.
- **The staff screen** now shows each step of the request it opens, with its outcome and words, so staff
  see what is still held.
- **The database tests** take a synthetic deletion through every step:
  - confirmed by its owner, claimed and erased;
  - its four outside steps recorded, one of them twice;
  - marked done.

  They check that:
  - only its own staff member records a step, and only one of the four outside steps, with an outcome;
  - it cannot be marked done while a step is held;
  - nothing changes it once done.

  A second test finishes a data download the same way and finds its prepared result still the person's.

### Slice 3: how long a request has been open

- **Valo's own aim.** 14 days after a request is made, as the design proposes, until the privacy owner
  sets the number (`PRIVACY_REQUEST_AIM_DAYS`, the owner's point 1). No screen names a time limit as the
  law's.
- **Who sees it.** The staff queue, beside each open request: "Valo aims to finish it by 10 Dec 2026.
  That is Valo's own aim, not a time limit set by law." Once the date has passed it says "Open past
  10 Dec 2026, the date Valo aimed to finish it by." The person who asked is not shown it, as it is not a
  promise to them (the owner's point 4).
- **The queue's order.** Open requests come first, the oldest first, then the rest, the newest first.
- **The alert.** The operations probe counts the open requests made more than 14 days ago. Any one
  raises `PRIVACY_REQUESTS_BACKLOG` under the deletion and recovery runbook, with the privacy owner
  accountable, and a failed reading raises `PRIVACY_REQUESTS_PROBE_UNAVAILABLE`. Like every operations
  alert, it is written to the worker's alert file; nothing sends a message.
- **A moved date holds the request.** A request's date is part of its signed history, so a date
  changed outside the application holds the request for investigation.
- **The tests.** A database test makes a request older than the aim. It finds the probe counting it, the
  staff queue listing it first with that date, the request held while its date is moved, and, once it is
  cancelled, no longer counted. A unit test raises the alert and the unavailable reading. A phone
  browser test reads the queue's words before and after the date.

## The owner's points

1. The number of days after a request is made by which Valo aims to finish it. Until the owner sets it,
   the design proposes 14, shown as Valo's own aim.
2. Whether a statutory time limit applies to privacy requests. None is shown until an official copy is
   retrieved and checked, with the AI checks PRV-003 names.
3. Whether releasing a hold of its own needs a second member of privacy staff. The design proposes one,
   with a reason.
4. Whether the person who asked should see the date Valo aims to finish their request by. Slice 3 shows
   it to staff only.
