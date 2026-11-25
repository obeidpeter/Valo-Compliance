# Editions

Design for the finishing plan's Phase 1 row "Editions" (DOC-007, EDT-010, EDP-011, PAY-009). It is a
proposal under the owner's delegation of 24 November, and it carries out the plan's delegated
decision 3, "What a buyer keeps". The words customers read are proposed for the owner.

## The problem

A template is released in editions: each version is a record of its own, on both routes. Today each
edition stands alone.

- **A purchase does not carry.** A purchase names one edition. In the staff library, a premium
  template's file, the check that a workspace holds a template, and a premium form each read only an
  edition that is still released. So once an editor releases version 2, the buyer of version 1 can
  download nothing. Version 1's file closes, as decision 0018 says, and version 2 is not theirs.
  Decision 3 says the purchase carries to the new edition at no further charge.
- **On the reviewed route, a replaced file stays open.** A replaced version stays published beside
  the new one. Its buyer can still fetch its file by its address, though the purchases screen no
  longer lists it. Decision 0018 and decision 3 close a replaced file to new downloads.
- **The template page counts only the edition on show.** A buyer of version 1 sees version 2 as not
  bought.
- **No document says where its edition stands.** A document records the edition it was made from,
  in one of three columns. Nothing compares that with the current release. So no screen says that a
  newer edition exists, or that the edition was withdrawn. DOC-007 asks: "Warn about material updates;
  withdraw unsafe masters from new use and explain available remediation."
- **Nobody is told.** The reviewed route's correction notice covers a withdrawal or a hold, in one
  fixed sentence. The staff library tells no one of either, and records no reason for a withdrawal.
  A replacement tells no one on either route. EDP-011 asks to "notify affected users when material".

## What changes

### 1. Where a document's edition stands

A new read gives, for each of the workspace's documents made from a template, where that edition
stands now:

| State | When | What the editor says |
| --- | --- | --- |
| Current | the edition is still the template's release | nothing |
| Replaced | a later edition is released | "A newer version of this template was released on 25 Nov 2026. Your document is unchanged and keeps the wording of version 1.", with a link to the template |
| Withdrawn | the edition was withdrawn, and no later one is released | "This template was withdrawn on 25 Nov 2026. Your document stays yours: you can still open, edit and download it. Check its wording before you use it.", with the reason when one was recorded |

A withdrawn edition with a later release counts as replaced. The documents list marks a replaced
document "Newer template version" and a withdrawn one "Template withdrawn". Nothing in the document
changes. DOC-007's acceptance asks that "an update never silently rewrites a customer's saved
document".

A customer request cannot read the staff library's table. So, as for the copies, a function that runs
as the table's owner gives the scoped workspace where its documents' library editions stand, and
nothing outside its scope. The scoped role already reads the reviewed route's versions.

### 2. A purchase carries to the next edition

Following decision 3:

- A workspace with an active, verified purchase of any edition of a premium template may download the
  template's released edition, and start its form from it, at no further charge. The edition it bought
  closes to new downloads once it is replaced or withdrawn, as today. A refunded or reversed purchase
  carries nothing.
- In the staff library, the three owner's functions and the guard on a premium form document read a
  purchase of any edition of the same item. The document still records the order it was bought
  under.
- On the reviewed route, a priced version downloads for a workspace that bought any version of the
  same template. A replaced version still stays published beside the new one there, so its file stays
  open by its address. Closing it waits for the reviewed route's release work in phase 3: that route
  releases no template in development today, and the check needs a test of its own against a released
  version.
- The purchases screen shows, under a purchase whose edition was replaced, the template's released
  edition to download: "You bought version 1. Version 2 is yours at no further charge." The template
  page counts a purchase of any edition of the template.

### 3. Telling the people who bought or used an edition

When an edition is replaced or withdrawn, each workspace that holds the template, or made a document
from that edition, gets one notice. The database writes it, in the transaction that makes the change.
So a notice exists exactly when the change does, whichever route or screen made it:

- in the staff library, when a template's release is withdrawn, and when a new edition is released
  after a replaced or withdrawn one;
- on the reviewed route, when a new version of a template is published. Its withdrawals and holds
  keep their correction notices.

A notice names the template, the edition, what happened and when. It also says whether the workspace
holds the template and how many of its documents came from that edition. The workspace's home lists
unread notices, and each can be marked as read. Their words:

| | Replaced | Withdrawn |
| --- | --- | --- |
| Holds the template | "Your purchase carries to version 2 at no further charge. Download it from Purchases." | "It can no longer be downloaded or used to start a document. You can take the replacement when one is released, or ask for a refund under the refund policy." |
| Made documents from it | "Your 2 documents made from version 1 are unchanged." | "Your 2 documents made from it stay yours: you can still open, edit and download them. Check their wording before you use them." |

Every notice ends: "Files you already downloaded are not affected." Nothing says that closing access
takes back a file already downloaded (EDT-010).

A staff-library withdrawal now records a reason of 20 to 1,000 characters, as the reviewed route's
withdrawal does, and the notice shows it. Sending notices by email waits for a sender and the owner's
decision on messages (phase 4).

### What does not change

- The documents themselves, their saved versions and their files.
- Prices. The new edition of a premium template has no offer of its own until a price is recorded for
  it (ADM-006, phase 3). Buyers of an earlier edition hold it without one.
- The reviewed route's correction notices.

With the reason and the customers' notice built here, phase 3's row "Withdrawal and replacement in the
staff library" keeps the rest: the customers affected shown to staff before a withdrawal, a hold short
of withdrawal, and complaints that point at a library item or a signed rule.

## Slices

There are two pull requests. The first carries this design and slices 1 and 2, the second slice 3.

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | Where a document's edition stands. A migration adds the function for the staff library's editions, with its upgrade test and runbook. Then the read, the editor's notice and the documents list's mark. Database tests: a document made from a released edition reads current; after a new release, replaced; after a withdrawal, withdrawn; on both routes. Render tests of the notice and the mark. | DOC-007, EDT-010 |
| 2 | A purchase carries to the next edition. A migration replaces the three functions and the premium form guard, with its upgrade test and runbook. Then the reviewed route's check, the purchases screen and the template page. Database tests: a buyer of version 1 downloads version 2 and starts its form, and cannot download version 1; a refunded buyer and another workspace cannot; a buyer of a withdrawn edition takes the next release. | DOC-007, PAY-009 |
| 3 | Notices. A migration adds the notices' table, its row security, the reason column and the triggers, with its upgrade test and runbook. Then the reason on the staff screen, the routes that list notices and mark them read, and the list on the workspace's home. Database tests: each change writes one notice to each workspace that holds or used the edition, and none to another. The customer-wording test reads the notices' words. | EDP-011, EDT-010, DOC-007 |

## The owner's points

1. The words of the notices and the editor's notice.
2. Decision 3 itself: a purchase that carries to every later edition at no further charge. The licence
   text that states it is still the owner's to approve.
3. Whether notices also go by email, once a sender exists (phase 4).
