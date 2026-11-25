# When a rule changes

The finishing plan's Phase 2 row "Rule changes" (CMP-005, EDP-011, ADM-007, RUL-009). When a
requirements-check rule is replaced by a new version, or withdrawn, the change records why, who made
it and whom it affects. The saved results and tasks made under the old version are marked, and the
businesses that made them are told.

## What there is today

**How a rule's version leaves the check.** There are three ways:
- **A new version replaces it.** The owner's sign-off, or the reviewed route's release command,
  publishes the next version and marks the published one superseded, in one transaction. Nothing
  records why.
- **The owner withdraws it.** The owner's panel withdraws an owner-signed version. It asks the owner
  to confirm, and records no reason.
- **It is held.** Two things hold a version:
  - a staff safety control holds or withdraws it;
  - the daily source check holds it when a source changed or its review is due.

  Each records a source impact, with its reason and who made it, and leaves the version stored as it
  was. A queued job then marks each task made under the version for review and cancels its unsent
  reminders. It leaves a correction notice for each task, saved result, document and purchase it
  reaches. The notice's words are fixed: "This saved item used a source or version that is now held
  or withdrawn…".

**Saved results.** A saved result keeps what it was saved with, and is shown only while its checksum
matches. Its page says when the business profile has changed since. It says nothing when a rule it
lists has been replaced or withdrawn. Comparing two saved results explains, rule by rule, a changed
version or result (CMP-005).

**Tasks.** A task made from a result records its rule's version. When that version is no longer
released, the task is marked for review and its reminders stop. That happens when the workspace's
tasks are next read, or when a reminder falls due. The task then says "Linked rule changed. Review
this task." It does not say what changed.

**What is missing.** A replacement and the owner's withdrawal have:
- no reason, and no record of whom they affect;
- no mark on a saved result;
- no notice.

A task is marked only later, when something reads it.

## What changes

### 1. Each change records why, who made it and whom it affects (ADM-007, EDP-011)

- **A change record.** A new table keeps one record for each version that leaves the check. It holds:
  - the rule and its version;
  - whether it was replaced or withdrawn, and the version that replaced it;
  - the reason, of 20 to 1,000 characters;
  - who made the change, and when;
  - how many workspaces, saved results and tasks were made under that version at that moment.

  A record is never changed or removed.
- **The database refuses a change without its record.** A version's status moves from published to
  superseded or withdrawn only when its record was written in the same transaction. So every route
  gives a reason: the owner's panel, the reviewed route's release command, and any later one.
- **The owner's panel asks for the reason:**
  - when withdrawing a version: "Why is this rule withdrawn?";
  - when signing a version that replaces one: "What changed in this version?".

  The reviewed route's release command takes the reason in its request when it replaces a version.
- **Holds are unchanged.** A hold already records its reason and who made it, and leaves the version
  stored as it was.

### 2. Tasks are marked and businesses told at once (RUL-009, EDP-011)

In the transaction that replaces or withdraws a version, the database:
- **marks each task made under it for review**, and cancels its unsent reminders, as a hold does. A
  task is never deleted, and its dates are not changed;
- **writes one notice to each workspace** that saved a result listing the version or made a task from
  it. The notice names the rule, the version, what happened and when, and the reason. It says how many
  of the workspace's saved results and tasks were made under that version.

The workspace's home lists unread notices with the edition notices, and each can be marked as read.
Their proposed words:

| | Replaced | Withdrawn |
| --- | --- | --- |
| Heading | "{title}: version 1 was replaced by version 2" | "{title}: withdrawn" |
| Reason | "What changed: {reason}" | "Why: {reason}" |
| Saved results | "Your 2 saved results that list it are kept as they were saved. Check again to see what applies now." | the same |
| Tasks | "Your task made from it is marked for review, and its reminders have stopped." | the same |

Sending notices by email waits for a sender and the owner's decision on messages (phase 4).

### 3. A saved result says which of its rules changed (CMP-005, EDP-011)

- **Each requirement whose rule version has since been replaced or withdrawn says so** in its card,
  with the date and the reason:
  - "Version 2 of this rule was published on 25 Nov 2026. What changed: …";
  - "This rule was withdrawn on 25 Nov 2026. Why: …".

  The result then offers "Check again".
- **The saved result is unchanged:** its items, its checksum and its downloads. The marks come from
  the change records when the result is read.
- **A task marked for review says why**, from the same records.

## What does not change

- Saved results, their checksums and their downloads. EDP-011 asks that "past customer files are
  never silently rewritten".
- Tasks are never deleted, and their dates are never moved (RUL-009).
- Holds, their source impacts and their correction notices.
- The check's results. A replaced or withdrawn version already leaves the check.

## Settled while building it

**Slice 1: the change record.**
- **A record is written for a version that is published**, at the time of its own transaction, and
  the database counts whom it affects as it is written: the workspaces, their saved results that list
  the version, and their live tasks made from it. The counts and the time are the database's,
  whatever the insert names.
- **A replacement's record names a version of the same rule that is published by then.** So the new
  version is released first, then the old one recorded and superseded, in one transaction.
- **A reason is trimmed, and refused under 20 characters.** The first sign-off of a rule needs none.
- **The reviewed route's release command records itself as the maker** (`operator:rule-release`). It
  runs on the server with no signed-in identity.
- **The owner's panel asks** "What changed in this version?" before signing a version that replaces a
  released one, and "Why is this rule withdrawn?" once the owner says they want to withdraw one. Each
  button waits until the reason has 20 characters.
- **A deletion is not a change.** No code deletes a release. An owner-signed release cannot be
  deleted (decision 0020); one on the reviewed route can, and needs no record.

**Slice 2: marks and notices.**
- **The change's own transaction marks the tasks**, calls off their unsent reminders with the reason
  the reminders screen already explains (`SOURCE_NO_LONGER_ELIGIBLE`), and writes an event in the
  workspace's log for each mark, as a mark made when the workspace's tasks are read does. A task
  already marked is left as it is.
- **The notice's words** follow the edition notices' beside them on the home, under "Changes to
  requirements you checked":
  - "“{title}” version 1 was replaced by version 2 on 25 Nov 2026", or "… version 2 was withdrawn on
    26 Nov 2026";
  - "What changed: …" or "Why: …", in the words the change was given;
  - "Your 2 saved results that list it are kept as they were saved. Check again to see what applies
    now.", with "Check again" linking to the requirements check;
  - "Your task made from it is marked for review, and its reminders have stopped."
- **A workspace whose data was erased gets no notice.** Its erasure does not remove notices it already
  has, as for the edition notices. They hold no text the customer wrote: the rule's title, its
  versions, counts and the reason the change was given. Phase 7's processing inventory lists them.
- **The home reads the notices with a live sign-in check.** The cached check serves only the read-only
  screens the owner approved; this list is not one of them.
- **The owner's panel now says** the businesses that used the old version are told what the owner
  writes.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The change record.** A migration adds the table, its guard and the status trigger that requires a record, with its upgrade test and runbook. The owner's panel asks for the reason, and the reviewed route's command takes it. Database tests: a change without a record is refused; the record names its reason, who made it and the counts; it is never changed. | ADM-007, EDP-011 |
| 2 | **Marks and notices.** A migration adds the notices' table and its row security, and extends the trigger to mark tasks, cancel their reminders and write the notices, with its upgrade test and runbook. Then the routes that list notices and mark them read, and the list on the workspace's home. Database tests: a change marks exactly the old version's tasks, and writes one notice to each workspace affected and none to another. | RUL-009, EDP-011 |
| 3 | **The saved result's marks.** The saved result's read gives the changes to its rules. Then the card's words, "Check again" and a marked task's reason. Tests of the words and the view, and a browser check. | CMP-005, EDP-011 |

## The owner's points

1. **The words:** the two questions ("What changed in this version?" and "Why is this rule
   withdrawn?"), the notices under "Changes to requirements you checked", and the marks.
2. **Every change tells the businesses it affects.** CMP-005 and EDP-011 ask for a notice "when
   material". Every change gives a reason, few rules are released, and a rule says what a business
   may have to do. So every change is treated as material. The owner may prefer a change to be
   marked as not material, which would mark tasks for review without a notice.
3. **Whether notices also go by email**, once a sender exists (phase 4).
