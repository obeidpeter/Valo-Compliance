# The source register

The finishing plan's Phase 3 row "The source register" (ADM-003, ADM-008, CMP-007). ADM-003 asks Valo
to "Manage authorities, URLs, jurisdiction, instrument/effective versions, snapshots and next-check
dates", and accepts it when "a source change opens AI drafting/review and validation jobs; publication
follows only after every gate passes, not directly from a crawler alert". CMP-007 asks it to "Monitor
source changes, failed retrieval and review expiry. Trigger an AI reassessment; hold affected
high-impact claims until evidence and tests pass". ADM-008 asks that content issues reach "the AI
reassessment queue and accountable content owner".

## What there is today

**The register is code.** The 46 source leads Valo may fetch are lists in the shared core
(`allSourceLeads`): 24 generated from the final source context, 4 from the coordinating register, and
18 written by hand for the business-name rule and the guides. 28 are regulatory; the others are the AI
provider's terms and quality documents. Each lead has an id, a title, an address, a category and notes.
Authority, jurisdiction, instrument and the version in force are not fields: where they are known, they
are words in the notes, or they sit elsewhere, per guide: the claim maps' instruments (issuing body and
the day the text took effect) and the amendment records (commencement and the searches made). The
fetcher reads only addresses on the list, which keeps it from reaching any other host.

**Staff can only start watching.** A Content editor can start the daily check of a lead
(`watch_source`), always at high risk. Nothing stops a watch, changes how often it runs, or edits,
adds or retires a source. The picker offers all 46 leads, the provider's terms among them. The owner
can also have a prepared rule's sources watched.

**The daily check and what it writes.** The worker checks each watched source once a day in
development. A changed or unreadable source, a version past its review date, a staff hold or a
complaint's hold each record an impact on the exact versions bound to it. The impact holds the version,
flags tasks, cancels reminders and leaves notices. Each impact also writes one review work row,
"awaiting authorised review".

**Review work that nothing acts on.** The staff screen shows the 50 newest review work rows, with no
action. The publisher marks a row superseded when it publishes a later content version of the same
template; a rule's row never closes. No row says who is accountable for it, and nothing leads from one
to a corrected candidate: candidates are prepared only by commands, for a template or guide named on
the command line.

## What changes

### 1. The register as records staff keep (ADM-003)

- Each official source is an entry of the register, kept in the database: its title and address, the
  authority that issues it, its jurisdiction (Nigeria, or one of the states the requirements check
  lists), the kind of instrument (an Act, a regulation, a guideline, or an official page), the version
  in force (as the text names its edition) and the day that version took effect. An official page says
  what it says when it is read, so it has no such day.
- The 28 regulatory leads kept in the repository are filed into it, with what the claim maps'
  instruments and the amendment records say of them; a field they do not say is left for staff to
  complete. The provider's terms and the quality documents stay in code: they are not sources of law.
- A Content editor corrects an entry, retires it or brings it back, each time with why. A Content
  editor adds a new source only at an address on a host the owner approved in the guidance policy. The
  fetcher then reads that address as it reads a lead in code, with every other check it makes.
- Each change is a record of its own: who made it, when, why, and the fields before and after. An entry
  is never removed.
- The register shows, for each entry, its last snapshot and when it is next checked.

### 2. Watching from the register (ADM-003, CMP-007)

- A watched entry is checked daily at high risk or weekly at standard risk, and staff choose which.
- Retiring an entry stops its watch. A version bound to it then fails the source gate as a stale source
  does, so nothing goes on resting on a retired source.
- The picker offers only active regulatory entries.

### 3. Review work that reaches its owner (ADM-008, CMP-007)

- Each open review work row names who is accountable: a Content editor for a content version, and the
  development owner for a rule the owner signed.
- The staff Content area lists the open rows oldest first: the version held, why, since when, and the
  source or support request that opened it. A Content editor records what was checked on a row.
- The owner's rule panel lists the open rows of the rules the owner signed, beside the reported
  problems (library holds, slice 3).
- A row closes when its version is replaced by a later release, rule releases included, or when it is
  withdrawn. Each close says which.

### 4. From review work to a prepared candidate (ADM-003, CMP-007)

- For a held version of a template or guide on the reviewed route, a Content editor prepares its
  corrected candidate from the row. The preparer runs its mechanical checks, as its command does today,
  and the row then points at the prepared candidate.
- The candidate's AI reviews are its reassessment. They wait, as every candidate's do, for an AI
  allocation the owner approves; nothing is sent and nothing is published from the row.
- Staff-library entries keep their own holds and reviews (library holds, the owner's third point).

## Settled while building it

Slice 1:
- The register is one table, `valo_source_register`, whose rows are versions. An entry is its source's
  latest version, and the versions before it are its history, each with who recorded it, when and why.
  The database records a version only from an active Content editor, only as the next version of its
  entry, and only at the address the entry was first recorded at. It dates each version itself and never
  changes or removes one. So a change's fields before and after are the version before it and the version
  itself, and retiring or bringing back an entry is a version too.
- **File the 28 sources kept in the repository** files each regulatory lead the register does not hold
  yet as its version 1, with "Filed from the official sources kept in the repository." as why. Who issues
  it and the kind of text come from the captured text its claim map cuts passages from. The day it took
  effect comes from that text, or else from its amendment record's commencement. As the repository
  stands, 11 leads are filed with who issues them and the kind of text, and 14 with the day. All 28 are
  federal, so each is filed as applying to Nigeria. No lead records the version in force as a field, so
  staff write it. Filing again files nothing more.
- A correction gives every field as it should stand, with the version it corrects and why: who issues
  the source, where it applies (Nigeria or one of the states the requirements check lists), the kind of
  text, the version in force, the day it took effect, and whether the source is active or retired. It is
  refused without why in 20 to 1,000 characters, with a day the calendar does not have, with a day for an
  official page, or when nothing changes, and, with 409, on a version that is no longer the latest. The
  title and the address stay the entry's own; a source at another address is a new source (slice 2).
- Each entry shows its latest version, its earlier versions, and the daily check's last check and next
  one, or that it does not watch the source. In this slice, retiring an entry changes no watch and no
  gate, and the entry says so: slice 2 makes retiring stop its watch.
- The fetcher, the daily check and the watch picker read none of this yet. Like the source controls, the
  register runs in development only. A database the migration has not reached answers on the register
  alone, with the migration's name.

## What does not change

- The daily check's rule for calling a source changed, the impacts and what they hold, the notices,
  and the source gate the publisher and the requirements check apply.
- Who may release which content and rule (decisions 0014, 0018 and 0020). Publication still follows
  only every gate, never the register or the daily check directly.
- The guidance policy's host list, which only the owner changes.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **The register.** A migration adds the register's entries, kept as versions that are never changed or removed, with its upgrade test and runbook. Filing the repository's 28 regulatory sources with what the code says of them; a Content editor's corrections, retiring and bringing back, each with why. The staff screen. The fetcher still reads the addresses in code. Tests: an entry's versions are kept and never changed, a correction needs why and the latest version, only a Content editor files or corrects, and a browser check. | ADM-003 |
| 2 | **New sources and watching.** A Content editor adds a source at an address on the policy's hosts, and the daily check fetches it. Risk and its interval, retiring that stops a watch, the picker. Tests of each, and a browser check. | ADM-003, CMP-007 |
| 3 | **Review work with its owner.** The accountable owner, the queue in the Content area and on the owner's panel, the note of what was checked, and closing by release or withdrawal for rules too. Tests of each, and browser checks. | ADM-008, CMP-007 |
| 4 | **A prepared candidate from review work.** The preparer run from a row for the reviewed route's templates and guides, the row pointing at the candidate, and its reviews waiting for an approved allocation. Tests that the candidate is prepared and nothing is sent or published. | ADM-003, CMP-007 |

## The owner's points

1. **New sources only on the policy's hosts.** Staff can add a source only at an address on a host the
   approved guidance policy lists. Adding a host stays the owner's decision, as a change to the policy.
2. **The AI reassessment needs the owner's budget.** ADM-003 and CMP-007 open AI drafting, review and
   reassessment. A prepared candidate's reviews run only under an allocation the owner approves; until
   then the row shows the candidate waiting.
3. **The words** of the register, the queue and the owner's panel.
