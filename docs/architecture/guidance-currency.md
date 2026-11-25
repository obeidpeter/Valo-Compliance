# Keeping published guidance current

The finishing plan's Phase 3 row "Keeping published guidance current" (EDP-011, CMP-005, CMP-007). A
published regulatory guide is checked against its official sources every day, without anyone
pressing a button. Every other entry in the staff library gets a review date and a record of each
review. An entry republished with a correction says what changed.

## What there is today

**A regulatory guide.** The staff library shows a published regulatory guide only while the newest
source check of its text:
- has the evidence the owner signed it on: the same sources, each with the same checksum;
- found nothing that holds it;
- is under 30 days old;
- and has every source still within its amendment record, which runs out 30 days after the last
  search for a later instrument.

A check is made only when the owner presses "Refresh the official sources" on their panel, or when
someone runs `guidance:check-manual-sources`. Nothing runs it on a schedule. So a guide stops showing
30 days after someone last asked, even when nothing in its sources changed. A change in a source in
between is found only when someone asks.

**A web page among a guide's sources.** Three of the guides' sources are web pages, not files:
- the Corporate Affairs Commission's business-name page, for GUD-01 and GUD-03;
- its registration portal, for GUD-05;
- the tax authority's Tax ID page, for GUD-08.

A check records each source's checksum of the bytes it read. Two of these pages return different
bytes on each request while saying the same words, as the daily source watch found on 21 November
(it now compares a page by its words). Read twice a few seconds apart on 25 November, the
business-name page and the Tax ID page each gave two checksums. So any check made after the one a
guide was signed on gives different evidence, and the guide stops showing. Today that happens only
when someone presses the button; a daily check would do it every day.

**Every other entry.** Practical guides, industry introductions and packs, templates and premium
templates stay published until a Content editor replaces or withdraws them. Nothing records when one
was last re-read, and nothing asks for it. EDP-011 asks for high-impact content to be re-reviewed
monthly and other content quarterly. On the reviewed route, a version stops being served when its
review date passes, and the daily source check queues its review. The staff library has neither.

**A republished entry.** A new version replaces the published one in one step. A holder of a
template is told that a newer version was released ([editions](editions.md)), but not what changed.
A reader of a guide is told nothing: the page shows the new text. CMP-005 asks for a correction
notice when a change is material.

## What changes

### 1. A guide's sources are checked every day (EDP-011, CMP-007)

**A web page is compared by its words.** Each check also records, for each source that is a web
page, the checksum of the words read from it, and the checksum of its evidence with those words in
place of the page's bytes. A file is still compared by its bytes. The reader shows a guide while its
newest check has the evidence it was signed on, as now, or the same evidence in words. A guide
signed before this change has no evidence in words, so it is shown as now until its owner signs it
again.

**The worker checks one guide at a time.** The worker gets a scheduled task of its own, `guidance`,
beside its seven others. Each minute it checks at most one published regulatory guide that is due:
- a guide is due a day after its newest check, or an hour after it when that check held it, so that
  a source that could not be read is tried again within the hour;
- the guide due longest is checked first;
- the check is the owner's own (`checkManualRegulatorySources`), for that guide alone, with the same
  reads, comparisons and amendment records. Its result is recorded as a check like any other.

So the reader's rule is unchanged, and a guide's newest check is at most a day old:
- a guide whose sources say the same keeps showing;
- a guide whose source changed, could not be read, or no longer matches its claims is held at once,
  with the reason on the owner's panel, until a check passes again;
- the monthly review stays where it is. An amendment record still runs out 30 days after its last
  search, which only a person can renew. A daily check never renews one.

A check holds no transaction, lock or connection while it reads. The task gives it four minutes,
within the five the queue allows a job. It runs in development only, as the owner's check does. A
database that already has the worker's schedules gets the new one when the reviewed queue setup
(`queue:apply-development`) is run again. Until then nothing checks on a schedule, as today.

### 2. Every other entry has a review date (EDP-011)

- An entry other than a regulatory guide is due for review 90 days after it was published or last
  reviewed. A regulatory guide's monthly review is the one above.
- The staff library shows each published entry's review date, and lists first those due within 14
  days or overdue.
- A Content editor records a review of the published version: that they re-read it and it needs no
  change, with a note of 20 to 1,000 characters. The database keeps the review, refuses one from
  anyone but an active Content editor or for any version but the published one, and never changes
  it. The next review is due 90 days later. An entry that needs a change gets a new version, as now.
- An entry whose review is overdue is held from new use, as the reviewed route holds a version past
  its review date. It leaves the library's lists and pages, and cannot be bought or started from.
  What a customer already has is untouched: their documents, saved copies and purchases.
- An entry already published when this is built is due 90 days after its publication.

### 3. A republished entry says what changed (CMP-005)

- When a version would replace a published one, the staff library asks "What changed in this
  version?" (20 to 1,000 characters), as the owner's panel does for a rule. The database refuses the
  replacement without it, and keeps the note with the new version.
- The entry's page then says "Updated on 25 Nov 2026. What changed: …" above the text, while that
  version is the published one.
- The notice to a template's holders ([editions](editions.md)) carries the note, as a withdrawal's
  notice carries its reason.
- For a regulatory guide, the owner writes the note when signing the new version.

## What does not change

- What holds a guide, and its 30-day amendment records.
- Decision 0018's release: who may publish which entry, and on what check.
- The reviewed route, its review dates and its queue.
- Documents, saved copies and purchases.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The daily check.** A migration adds the evidence in words to the checks, with its upgrade test and runbook. The reader takes either evidence. The worker's `guidance` task chooses the guide due and checks it, and the queue setup schedules it. Tests: a page's changed bytes with the same words keep a guide showing, and changed words hold it; a file is still compared by its bytes; the guide due is the one whose check is oldest past a day, or past an hour when held; a guide not published is never checked; the task stops at its bound. | EDP-011, CMP-007 |
| 2 | **Review dates.** A migration adds the reviews' table, its guard and the reader's rule, with its upgrade test and runbook. The staff library's review dates, its list and the review. Database tests: a review from anyone but an active Content editor, or of another version, is refused; an overdue entry leaves the lists and pages and cannot be bought, while what a customer has stays. | EDP-011 |
| 3 | **What changed.** A migration requires the note for a replacement and carries it to the notices, with its upgrade test and runbook. The staff screen's question and the entry page's line. Tests of the words and the database's refusal, and a browser check. | CMP-005 |

## The owner's points

1. **An entry whose review is overdue is held.** This follows the reviewed route. The owner may
   prefer an overdue entry to stay on the site, marked overdue for staff only.
2. **A guide is held when a source cannot be read.** CMP-007 asks for high-impact claims to be held
   when retrieval fails, and the reviewed route does so. Official sites can be slow or down, so a
   guide held this way is tried again within the hour.
3. **A guide's newest check may still be up to 30 days old.** If the worker stops, guides keep
   showing on their last check for up to 30 days, as today. Holding a guide whose daily check is
   two days late would follow EDP-011 more closely, but would hold every guide whenever the worker
   is not running.
4. **The words:** the review's and the change note's questions, "Updated on … What changed: …", and
   the review dates on the staff screen.
