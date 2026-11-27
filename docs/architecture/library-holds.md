# Holding, withdrawing and reporting staff-library entries

The finishing plan's Phase 3 row "Withdrawal and replacement in the staff library" (ADM-007, ADM-008,
EDP-011). Every template and guide published today is a staff-library entry. Staff can withdraw one, but
cannot see first whom that affects, cannot hold one short of withdrawal, and a complaint cannot point at
one.

## What there is today

**A withdrawal.** A Content editor withdraws the published version of an entry, with a reason of 20 to
1,000 characters ([editions](editions.md), slice 3). The database then tells each workspace that bought the
template, or made a document from that version, once, with the reason. Those notices are the record of
whom it affected. A guide has no buyers or documents, and its readers simply can no longer open it.
Before withdrawing, the editor is not told how many workspaces will be told. A withdrawal cannot be
undone: the entry comes back only as a new version, which says what changed
([guidance currency](guidance-currency.md), slice 3).

**Nothing short of a withdrawal.** An entry overdue for its review is held from new use automatically
(guidance currency, slice 2), but staff cannot hold one by hand. The safety switches pause all AI
generation or all checkout (ADM-007). On the reviewed route, the source controls hold one exact content
version or rule release and queue its reassessment.

**A complaint.** Anyone can report a problem, free: a signed-in customer from Help, and anyone else
through account-access intake. Support staff can escalate a workspace's request to content triage. An
escalation points at an exact content version or rule release on the reviewed route, typed as an ID. The
Content triage queue acknowledges it, resolves it, or holds that version through the source controls and
queues its reassessment. An escalation cannot point at a staff-library entry. A rule the owner signed
(decision 0020) is a rule release, so an escalation can point at one already, but nothing tells the
owner.

## What changes

### 1. Whom a withdrawal affects, shown first (ADM-007)

- ADM-007 asks that the reason, the actor and the customer impact of disabling a guide, rule or template
  are recorded. The reason and the actor are recorded with each withdrawal today. The impact is recorded
  only afterwards, as the notices.
- The open entry shows, for a template's published version, how many workspaces bought the template and
  how many documents were made from that version, in how many workspaces. One database function gives
  both these counts and the notices' rows, so the editor sees whom the notices will reach.
- The withdrawal form says it before the editor confirms: for example "3 workspaces will be told, with
  your reason: 1 bought it, and 2 made 5 documents from it." A guide's form says that its readers can no
  longer open it.
- After the withdrawal, the entry says how many workspaces were told. The notices stay the record.

### 2. A hold short of withdrawal (ADM-007, EDP-011)

- A Content editor can hold the published version of any entry, with a reason of 20 to 1,000 characters.
  A held version leaves new use exactly as an overdue one does: the public pages and lists, free
  downloads, saving, copying, starting a form, the offers and new orders. What a customer already has
  stays, as it does for an overdue entry: their files, documents and purchases.
- The database keeps each hold with who placed it, when, why and how many workspaces it touched, and
  never changes it. Lifting a hold is a record of its own: who lifted it, when and why.
- A Content editor lifts a hold on any entry but a regulatory guide. Only the owner lifts a regulatory
  guide's hold, as only the owner releases one (decision 0018).
- A held entry is listed first in the staff library, and its page tells staff why it is held. Customers
  are not told of a hold, since nothing they have changes.
- Every other entry stays available: a hold touches only the version held.

### 3. Complaints that point at a library entry (ADM-008)

- Support staff can escalate a workspace's request to a staff-library entry, chosen by its title, as well
  as to a reviewed version or a rule release. The escalation keeps the exact version and its digest.
- The Content triage queue lists library escalations with the reviewed route's. "Hold and reassess" on
  one places the hold of change 2, with the escalation as its reason, and the entry is reassessed by its
  accountable owner: a Content editor reviews it or releases a new version, and the owner checks a
  regulatory guide's sources. Resolving one records the outcome.
- An escalation that points at a rule the owner signed is shown on the owner's panel as well as in the
  queue, and its hold goes through the source controls, as for a reviewed rule.
- So an escalated entry is held at once by whoever triages it. It does not wait for a specialist.

## Settled while building it

Slice 1:
- The counts come from `valo_manual_edition_reach`, and the notices of a replaced or withdrawn edition
  are written from the same function, so the editor sees whom the notices will reach. A workspace bought
  the template if it holds an active entitlement to any of its editions under a verified order, as the
  notices have counted since editions slice 3. An order only started does not count.
- A workspace is counted once, however many documents it made. The line says how many workspaces bought
  the template, and how many made how many documents from the version.
- The counts are of the published edition, which is the one a withdrawal acts on, even while a newer
  draft is open. A guide shows none.
- A withdrawn template edition says how many workspaces its withdrawal told, counted from its notices.
- The counts are read only where the migration has added the function. On a database it has not
  reached, the screen shows none and the withdrawal form says what it said before. Withdrawals and
  their notices work either way.

Slice 2:
- A hold is placed only on an entry's published version, which has at most one hold not yet lifted. Once
  lifted, it can be held again. An active Content editor holds any entry, and the development owner may
  hold a regulatory guide too. The database dates the hold and counts the workspaces it touched itself,
  from slice 1's function.
- A Content editor lifts any hold but a regulatory guide's, which only the development owner lifts, on
  the owner's panel. The lifting is a record of its own, dated by the database. Neither record is ever
  changed or removed.
- A held version leaves the public pages and lists, regulatory guides included, a free template's
  download, saving and suggestions, copying, starting a form, the premium offers, new orders and the
  owner's price command, as an overdue one does. A buyer's file and purchases, and documents already made,
  stay. Every other entry stays available.
- Releasing a corrected version is another way out of a hold: the new version is not held, and the hold
  stays on the record of the version it replaced. A held version can also be withdrawn, which tells its
  customers as before.
- The staff list marks a held entry "Held" and lists it first. The open entry says since when the version
  is held and why. Customers are not told.
- A database the migration has not reached holds nothing. The readers then apply the review rule alone,
  and before the reviews migration, neither.

Slice 3:
- Support staff find a library entry by words of its title, among published entries only, and the
  referral points at the version published now, with its digest. A draft or replaced version is
  refused. Only support staff may search, as only they refer. The screens call an entry a guide or
  template, in the site's own words, as the staff library's screen does.
- In the triage queue, "Hold this version from new use" places slice 2's hold, in the
  transaction that records the triage, by the Content editor triaging it. Its reason names the support
  request by its reference and copies none of its words, since the hold is read outside support. A
  version already held keeps its hold, and the referral points at that one. A version no longer
  published is not held, and the refusal says to refer the current version if the problem remains.
  Resolving a referral keeps its hold, which a Content editor lifts, or the owner for a regulatory
  guide, or a corrected release leaves behind.
- The database keeps the version every referral points at, sets a library referral's hold once and only
  to a hold on that edition, and keeps a library hold to a library referral and a source impact to the
  others.
- The owner's rule panel lists the referrals not yet resolved of every version of the rule the owner
  signed, whether released, replaced or withdrawn, with the reason given and whether content staff held
  that version through the source controls. A referral from an erased workspace is left out, as from
  the triage queue. A regulatory guide's hold from triage reaches the owner's guidance panel as slice 2's
  hold, which only the owner lifts.
- A library referral has no AI reassessment (the owner's third point): a Content editor, or the owner
  for a regulatory guide, reassesses the entry.

## What does not change

- Who may release which entry (decision 0018), and the reviewed route's holds.
- The notices to customers, which a hold does not send.
- Documents, saved copies and purchases.

## Slices

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **Whom a withdrawal affects.** A migration adds the function that gives a version's buyers and documents, which the notices then use, with its upgrade test and runbook. The count on the staff screen and in the withdrawal form. Tests of the count against workspaces that bought or used a version, that it matches the notices written, and a browser check. | ADM-007 |
| 2 | **Holds.** A migration adds the holds and their lifting, with the readers' rule, its upgrade test and runbook. The staff screen's hold and lift. Database tests: a held entry leaves new use and comes back when lifted, while what customers have stays and other entries stay available; only an active Content editor holds, and only the owner lifts a regulatory guide's hold. | ADM-007, EDP-011 |
| 3 | **Complaints.** A migration adds the library target to escalations. The support screen's choice of entry, the triage queue's hold, and the owner's panel. Tests: an escalation of a library entry holds it, and one of a signed rule reaches the owner. | ADM-008 |

## The owner's points

1. **Customers are not told of a hold.** A hold keeps what they have; only a withdrawal tells them.
2. **Only the owner lifts a regulatory guide's hold.**
3. **A library entry has no AI reassessment.** ADM-008 routes content issues to the AI reassessment
   queue. Staff wrote these entries, so a Content editor, or the owner for a regulatory guide, reassesses
   one. Sending one for AI review would need the owner's AI budget.
4. **The words:** the counts, the hold's question and the held entry's line.
