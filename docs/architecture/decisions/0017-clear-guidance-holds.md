# 0017 — What clears each of guidance's six standing holds

Date: 2026-11-21. Status: **proposed**. Nothing here is approved, and no guide is published.

On 21 November 2026 the product owner asked for work to start on all six holds at once, so that the
prepared guides can be published. That request starts the work. It does not approve the policy, the
rights position or any spending below; each needs its own answer.

## Context

### The guides

Thirty guidance drafts, GUD-01 to GUD-30, are kept in `docs/content-candidates`. The intake
manifest (`r1-content-intake-manifest.json`) records them as written in a ChatGPT conversation the
owner authorised, on 14 November 2026. Each is `draft_for_editorial_intake`. None has had a factual
review, a challenge review, a rights record or a release manifest.

| Guides | Subject | Draft file |
| --- | --- | --- |
| GUD-01 to GUD-07 | Business names, companies and their records | `regulatory-guidance-registration-tax.md` |
| GUD-08 to GUD-10 | Tax ID, the company income-tax return, tax records | the same file |
| GUD-11 to GUD-15 | Personal data | `regulatory-guidance-privacy-consumer.md` |
| GUD-16 to GUD-18 | Prices, refunds and unfair terms | the same file |
| GUD-19 to GUD-26 | Food products and regulated stock | `regulatory-guidance-products-operations.md` |
| GUD-27 to GUD-30 | Employment terms, pay deductions and leave | `regulatory-guidance-employment.md` |

### The six holds

`mandatoryDevelopmentHolds` (`modules/editorial/pipeline-contract.ts`) lists six reasons. The proof
pipeline (`pipeline.ts`) adds all six to every output, whatever the output says. That pipeline
drafts one candidate from one source to prove the AI calls work. It never publishes.

A guide would be published by the same publisher as a template (decision 0014):
`publishOperationalVersion` rechecks every gate in one transaction. That publisher already accepts
the `sourced_guidance` class, and for it the gate (`evaluatePublication`) asks for more than for a
template:

- sources, each approved, with its operative text confirmed and its amendments resolved;
- a verified legal scope;
- every claim quoted word for word from one of those sources;
- the five enhanced checks, run by the two reviews.

So the six reasons are cleared by building what that route needs for a guide and by the owner's
decisions below, not by editing the list.

### What a guide lacks today

Read from the code on 21 November 2026:

1. **No builder.** Nothing builds a guide's publication bundle. Two guides (GUD-01 and GUD-09) have
   claim maps, built as evaluation cases (`editorial-case-candidates.ts`), with their sources marked
   as not approved.
2. **No source decision.** No code marks a source approved, its operative text confirmed or its
   amendments resolved. Test fixtures set those fields, and one evaluation case sets one of them
   wrongly on purpose.
3. **Sources outside the list.** The publisher binds each source to a fresh capture of an address
   in the source list (`allSourceLeads`), on a host the policy allows. The guides cite addresses the
   list lacks: the National Assembly's copy of the Nigeria Tax Administration Act, the Federal
   Competition and Consumer Protection Act, eight NAFDAC guidelines, the Labour Act and the Tax ID
   pages. Seven hosts are not in the policy: `www.cac.gov.ng`, `taxid.nrs.gov.ng`, `nass.gov.ng`,
   `fmino.gov.ng`, `fccpc.gov.ng`, `m.nipc.gov.ng` and `www.nafdac.gov.ng`.
4. **A rights record written for forms.** The publisher requires `originalOperationalOnly`, which
   describes a blank form that quotes no law.
5. **No guide layout in a file.** The renderer's sample mode prints "BLANK DEVELOPMENT TEMPLATE …
   Not regulatory guidance" and six empty business fields.
6. **The page and the publisher disagree.** The publisher stores a document as JSON in the
   candidate's body. The public guide page shows the body as text.
7. **One database login.** The publisher switches to its role (`SET LOCAL ROLE`) from the
   application's own login. That login can switch to any role.
8. **Passages kept for ten guides only.** The repository holds the passage text for GUD-01 to
   GUD-10 (the Companies and Allied Matters Act 2020 and the Nigeria Tax Administration Act 2025).
   For the other twenty it holds each official file's checksum and page locators, not the text.

### One fact gathered on 21 November 2026

Eighteen official files named in the drafts' source evidence were requested again from their
official addresses between 17:50 and 17:52 UTC. Sixteen were returned, and each is identical, byte for byte, to the copy
recorded on 14 November (same SHA-256): the Companies and Allied Matters Act, both copies of the
Nigeria Tax Administration Act, the Nigeria Data Protection Act, its General Application and
Implementation Directive, the Federal Competition and Consumer Protection Act, the eight NAFDAC
guidelines, the Pension Reform Act and one PenCom circular. The two files on `nipc.gov.ng` and
`m.nipc.gov.ng` (the Business Facilitation Act and the Labour Act copy) could not be reached from
the development container.

An unchanged file shows that the address still serves the same text. It does not show that no
later instrument amends it.

## Proposal

Each hold becomes a condition the guide's own route checks. A guide that fails one stays held.

| Hold | It is cleared when | Who supplies it |
| --- | --- | --- |
| `publication_policy_not_approved` | The owner has approved the policy below, the policy is kept in `docs/valo/policies`, and the publication policy binds that file's hash and an exact sentence of it, as it does the two authority files today | The owner approves; code binds |
| `current_amendments_and_effectivity_unverified` | Each source is a capture taken within a day of release (built), and has an amendment record that passes the rule in point 2 | Code and research; captures run in the real environment |
| `rights_record_not_cleared` | The guide has a rights record of the kind in point 3 | The owner accepts the basis; code checks |
| `complete_claim_scope_not_accepted` | Every sentence of the guide is classified and every statement of law is bound to an exact passage, as in point 4 | Code |
| `DOCX_PDF_publication_samples_not_validated` | The guide's Word and PDF files, in a guide layout, pass the export inspection | Code |
| `publisher_service_credentials_not_isolated` | Only a database session that logged in as the publisher can publish, as in point 6 | Code; the credential is set in the real environment |

### 1. The policy

EDP-001 has the owner set the allowed classes, places, risk levels and blocked activities once.
The recorded authority (`operational-publication-authority.md`) says claims about law need a
source-backed policy of their own. The text proposed for the owner's approval:

> **Guidance publication policy (proposed, not approved)**
>
> 1. **What may be published.** General guides about Nigerian national rules and official federal
>    processes, starting with GUD-01 to GUD-30. A guide is general information.
> 2. **Where.** Nigeria as a whole. A guide makes no claim about a state, the FCT or a local
>    government until a later decision allows it.
> 3. **Subjects.** Company and business-name records, tax administration, personal data, consumer
>    transactions, food and regulated products, and employment. Every one is treated as high impact:
>    the enhanced checks always run.
> 4. **Every statement of law is tied to its source.** Each sentence that says what the law requires
>    is bound to an exact passage of an official text that Valo holds a copy of. A sentence that
>    interprets a passage is recorded as an interpretation. A practical suggestion is recorded as
>    optional practice and is not presented as a legal duty.
> 5. **Numbers.** A rate, fee, penalty, threshold or deadline appears only when the quoted passage
>    contains that number.
> 6. **Never.** An opinion on one business's position; a statement that a business complies or is
>    exempt; a guarantee; a claim of review by a lawyer, tax adviser, regulator or other
>    specialist; a filing made for a customer.
> 7. **Official text is explained, not copied.** A guide explains in its own words, names the
>    section and links to the official address. It does not reproduce official text beyond a short
>    quotation.
> 8. **Sources.** Only texts fetched from the official hosts in the policy. A source counts as
>    current only under the rule in this decision's point 2.
> 9. **Checks before release.** The mechanical checks, two separate AI reviews that do not see each
>    other's result, the enhanced checks and both file formats. No person signs each guide. An AI
>    review is never called a professional review.
> 10. **What every guide shows.** "AI drafted and reviewed; not reviewed by a Nigerian legal, tax or
>     sector specialist", the date its sources were checked, what it covers, its limits and its
>     official links.
> 11. **Staying published.** Sources are checked daily. A guide is reviewed again every 30 days. A
>     changed source or a failed check takes the guide down until it passes again.
> 12. **Stopping.** The owner can pause the AI and withdraw any guide at once.
> 13. **Development only.** This policy allows publication in the development environment. Public
>     launch and production need their own approvals.

Points 9 to 12 describe what is built. Point 11's 30 days is the code's cadence for every risk
class except `general` (`sourceTargetAllowed`), and EDP-011 asks for a monthly review of high-impact
content. So each published guide needs two new AI reviews every 30 days.

Accepting the policy also adds the seven hosts above to the policy's host list, which changes the
policy's hash and so its version.

### 2. What "current" means

The gate needs `operativeTextConfirmed` and `amendmentsResolved` for every source. Proposed rule:
a source may carry them only when an **amendment record** for its instrument exists and is no older
than 30 days. The record holds:

- the instrument, its official address and the checksum of the capture it describes;
- its commencement, quoted from the text;
- each official place searched for later amendments, with the date and the checksum of what that
  place returned;
- each amending instrument found, with its own capture, and, for every section a guide quotes,
  either the passage that shows the section is untouched or the amended wording;
- every open conflict, for example the two official copies of the Nigeria Tax Administration Act
  that print different commencement dates.

A source with an open conflict that touches a quoted section is not resolved, and guides that quote
that section stay held. The two reviews then run the `amendments` and `effective_dates` checks
against the record and the captures (decision 0014).

This cannot prove that no later instrument exists. Only a search of every gazette could, and only a
qualified person could give an opinion on it. The guide's limits will say when and where the search
was made.

### 3. The rights record

Two different rights are involved.

- **Valo's own wording.** The drafts were written with ChatGPT. The record is the one templates
  use: a copy of the provider's terms taken within a day of preparing the guide, with the passages
  that assign the output and allow commercial use (`chatGPTPermissionRecord`). It lapses after 90
  days.
- **Official text.** The policy's point 7 becomes a check: the longest run of words a guide shares
  with any passage it cites is measured, and a guide over the limit fails. The public page shows a
  guide's own words, the section reference and the link, never the passage. The passages are kept
  as private evidence for the reviews.

The record claims no copyright opinion, exclusivity or clearance of third-party rights, as the
template record does not.

### 4. The claim scope

A guide's claim scope is complete when a builder can classify **every sentence** of its body as one
of:

- a source statement, bound to an exact quotation from a retained passage;
- an interpretation, bound to the passage it rests on;
- optional practice, bound to the official page it points to, or recorded as Valo's own suggestion;
- a limit of the guide itself, which says what the guide does not cover or decide;
- not a claim, for example a sentence that only introduces a list.

A sentence the builder cannot place fails the build. A number stands only where the quoted words,
or the place given for them, contain it; a number that is Valo's own record, such as the day a page
was read, is named with its reason. The builder sets the legal scope to verified only when every
bound source passes point 2. The two reviews check the map; no person accepts each guide (EDP-007).

### 5. The sample files

A guide gets its own layout: its title, its own notice, its body with links written out, then what
it covers, its limits, the disclosure and the date its sources were checked. The existing export
inspection reads both files back and compares them with the candidate. CI keeps the files as an
artifact, so the owner can open them.

### 6. The publisher login

As for customer requests (decision 0008): a login that can do nothing but publish.

- A migration creates `valo_publisher_login`, which may only become the publisher role.
- A release runs on the publisher's own connection (`VALO_PUBLISHER_DATABASE_URL`), which must lead
  to the application's own database.
- The database refuses a change to `published` from a session that logged in as anyone else, so the
  application's own login cannot publish even by switching role. Holding and withdrawing a version
  take content away, and stay open to the application's login.
- An operator script sets the login's password, which is kept in the secret store.

This limits who can release. It does not move the gates into the database: the publisher's login
could still publish a version with one statement, so its connection string goes only to the
command that publishes.

## What this decision does not do

- It publishes nothing and marks no hold as cleared.
- It spends nothing. Each guide needs two AI reviews before it is first published and two more
  every 30 days. They run only inside an allocation the owner approves in the real environment
  (`finite-allocation-approval.ts`). The cost is not known until the guides are prepared, because
  an enhanced review carries the guide's sources.
- It does not open production. `developmentPublicationOnly` still refuses production.
- It does not cover the twelve practical guides, the twenty industry pages or the six packs. They
  quote no law, and the gate has no route yet for a guide without sources.

## Order of work

1. This record.
2. The sample files (hold 5).
3. The builder and claim maps for GUD-01 to GUD-10, and the guide page (hold 4).
4. The publisher login (hold 6).
5. The source list, the hosts and the amendment record (hold 2), after the policy is approved.
6. The rights record (hold 3), after the owner's answers.
7. The guide preparer, its review requests and the publish command.
8. Claim maps for GUD-11 to GUD-30, from the official files whose checksums match the recorded ones.

## Decisions for the product owner

1. **The policy.** Approve the thirteen points above, or change them.
2. **"Current".** Accept the amendment record of point 2 as the standard, knowing it cannot prove
   that no later change exists.
3. **Rights.** Accept the basis in point 3: the provider's terms for the wording, and "explain,
   cite and link, never copy" for official text.
4. **Where the drafts were written.** Confirm that the thirty drafts were written in the owner's
   own ChatGPT account. The record must say only what is true.
5. **The real environment.** Name who runs commands there. Three steps happen only there: the
   source captures, the publisher login's password, and the AI reviews.
6. **The monthly cost.** Accept that a published guide costs two AI reviews every 30 days, or ask
   for the cadence to be proposed differently for some subjects.
