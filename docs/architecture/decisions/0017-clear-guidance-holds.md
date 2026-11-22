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
   Of what the other twenty quote, it holds two passages of the Nigeria Data Protection Act
   (sections 2 to 3 and 27) and the text of the Food, Drugs and Related Products (Registration,
   Etc.) Act. For the rest it holds each official file's checksum and page locators, not the text.

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

### More facts gathered on 21 November 2026

Gathered while the amendment records of point 2 were first written (`guidance-amendments.ts`). The
searches were made between 17:50 and 20:22 UTC; each is in a record with the checksum of what the
address returned.

- **The National Assembly's list of Acts and publications** holds 182 entries. None names the
  Companies and Allied Matters Act. One names the Nigeria Tax Administration Act: the Act itself.
  The list is not a full statute book: it holds neither the Business Facilitation Act nor any
  Finance Act.
- **The Nigeria Tax Act 2025** (National Assembly copy) does not name the Companies and Allied
  Matters Act. Its repeals (section 195) and consequential amendments (section 196) do not name the
  Nigeria Tax Administration Act.
- **The Business Facilitation (Miscellaneous Provisions) Act 2022** amends twenty sections of the
  Companies and Allied Matters Act. The ten guides quote one of them, section 868, where it deletes
  the definition of "insolvency practitioner". No guide quotes that definition.
- **The Finance Acts of 2020, 2021 and 2023** were read from the copies the Budget Office of the
  Federation serves. The Finance Act 2020 changes one section of the Companies and Allied Matters
  Act: it replaces section 432, which no guide quotes. The Finance Acts of 2021 and 2023 have no
  part for that Act. Two of the three are scanned copies, read from their page images. Whether a
  Finance Act later than 2023 exists was not established.
- **The other two revenue Acts of 2025**, which set up the Nigeria Revenue Service and the Joint
  Revenue Board, change nothing in the Companies and Allied Matters Act or the Nigeria Tax
  Administration Act.
- **The two official copies of the Nigeria Tax Administration Act print three different
  commencements.** The National Assembly's copy prints 26 June 2025 at its head, and its section 148
  gives the Act's name only. The Gazette copy served by the revenue service prints 1 January 2026 at
  its head, and its section 148 says the Act comes into effect on 1 January 2025. Under every one of
  these the Act is in force from 1 January 2026. None of the thirty guides states when a law
  commenced.
- **The Gazette copy is a scanned image.** Its machine-read text is too unreliable to compare with
  the National Assembly's copy by machine, so the sections the guides quote were compared by reading
  its page images: sections 4, 7, 11, 31 and 33, and the three definitions of section 147 that the
  guides quote. They read the same apart from small differences of wording. The National Assembly's
  copy says "purposes" where the Gazette copy says "purpose" (section 4), adds "of this section" in
  three places (sections 7 and 31), and leaves out ", 2025" after "Nigeria Tax Act" in three places
  and words one paragraph differently (section 11). None is in a number, a time limit or who must
  act. The rest of section 147 was not compared, and a quotation from it is not confirmed.
- **No guide repeats more than ten words in a row** from a passage it cites.

With these readings, every passage the ten mapped guides quote is marked current under the rule of
point 2. What then holds eight of those guides, apart from their two reviews, is the owner's
approval of the policy. GUD-05 and GUD-08 also rest in part on an official page that is not kept in
the repository.

The reading of the Gazette copy and of the scanned Finance Acts was done by an AI assistant from the
page images. It is not legal review.

### Facts gathered while the preparer was built (21 November 2026)

- **The official files hold every passage.** The two Acts and the three official pages were fetched
  from their official addresses on 21 November 2026 and read with the capture pipeline's own text
  extractor, on the build machine. Each of the ten mapped guides was then built from that text.
  Every sentence about the law was bound, and every source was marked current. That includes the
  sentences of GUD-05 and GUD-08 that rest on a page not kept in the repository. Supposing the
  owner's approval, the gate then named nothing but the two reviews for each of the ten. In that
  run the check of each guide's two files was a stand-in; the files themselves are made and
  checked in CI. This was not a capture by the daily check in the real environment. A different
  version of the extractor there could read a file differently, and a guide would then stay held.
- **A guide's review is larger than a template's may be.** Before a review is sent, its size is
  counted the cautious way: every byte as a token. A template's review is refused above 32,000. A
  guide's review also carries the official passages and what was searched for later amendments.
  With nothing sent twice, the ten guides' reviews measure between 33,479 and 53,042. The policy
  file therefore states a limit of 64,000 for a guide's review, which the owner approves with the
  file.
- **What that limit means for money.** While a review runs, the budget holds the cost of the
  model's whole capacity for it, about 37 US cents at the recorded prices, whatever its size. That
  does not change. When the review finishes, the hold is replaced by what the provider counted. By
  the cautious count, the most one guide review could cost is about 9 cents, where a template's is
  about 7. The real cost is known only from the provider's count afterwards.
- **Two official pages return different bytes every time.** The Commission's business-name page
  carries an email-protection code and the revenue service's Tax ID page carries an anti-bot code;
  both codes change with every request. Each page was fetched twice on 21 November 2026 (at 21:14
  and 21:18 UTC, and at 18:26 and 21:18 UTC). The bytes differed and the words read from them were
  the same (1,113 and 2,796 characters). The portal's front page returned the same bytes twice.
- **What that meant for the daily check.** The daily check called a source changed when its bytes
  changed, and then held whatever rested on it. It would have reported those two pages changed
  every day.
  GUD-01 and GUD-03 rest in part on the business-name page, and GUD-08 on the Tax ID page. As the
  check stood then, those guides could be released only between two checks and would be held at
  the next one. The guides that quote Acts alone are not affected: both Acts' files returned their
  recorded checksums. The check now compares a page's words (see point 2).

### Facts gathered while the privacy guides were mapped (22 November 2026)

- **Five more guides are mapped.** GUD-11 to GUD-15, the privacy guides, each have a claim map:
  93 sentences in all. They rest on the Nigeria Data Protection Act 2023 and on the Commission's
  General Application and Implementation Directive 2025.
- **Their official words are not kept in the repository.** For these two texts the repository
  keeps only where each passage starts and ends, and the checksum of its words (33 passages,
  `guidance-captured-texts.ts`). A passage is read from a capture of the official address and
  supplied only when its words have that checksum. This is the route decision 7 gives for texts
  that are not Acts. It is used for the Act as well, so these five guides do not wait for the
  owner's answer on decision 7.
- **What a test can show, and what it cannot.** A test in CI shows that every word of each guide
  is placed and that every sentence about the law names a recorded passage. No test in CI can show
  that a quotation is in the official text: the text is not there to read.
- **The check made outside the tests.** On 22 November 2026, on the build machine, each of the
  five guides was built with the repository's own code from the two official files as fetched on
  21 November (their checksums are the ones the drafts' evidence recorded). Every sentence about
  the law was bound and every source was marked current. With the owner's approval supposed, in
  that run only, the gate named nothing but the two reviews. No guide repeats more than six words
  in a row from a passage it cites. A different version of the extractor in the real environment
  could read a file differently; nothing would then bind, and the guide would stay held.
- **Sizes.** The five guides' reviews measure between 46,146 and 62,242 by the cautious count,
  within the 64,000 limit. GUD-12 first measured 78,675, because its map cited whole sections
  where it quotes one clause. Its passages were narrowed to what it quotes. The limit was not
  changed. GUD-12 is now within the limit by about 1,750: a longer amendment record could put it
  over, and it would then be held unsent until its map cites less.
- **The search for later amendments.** The National Assembly's list of Acts (182 entries) names
  no Act that amends the Data Protection Act; the list does not hold every Act. Its bill tracker
  lists one bill that names the Act, SB.648, with a second reading on 18 March 2025 and no third
  reading. Press reports of July 2026 describe a bill of this kind, and none found says it was
  passed. The bill itself was not read: its file came back empty. The Commission's resources page
  offers the Act and the directive at the addresses these copies were fetched from, and nothing
  that amends either. A guidance notice of 26 June 2026 concerns Article 14 and Schedule 3 of the
  directive, which no guide quotes. No Gazette index was searched.
- **When the directive took effect.** The directive prints the day it was issued, 20 March 2025,
  and no day for taking effect. Law firms' notes and press reports say the Commission set
  19 September 2025. That statement was not found on the Commission's own site. The later day is
  used: on either account the directive is in force from it.
- **Three things found in the texts of the other fifteen guides.**
  - *The consumer protection Act.* The Commission's copy is a scan. The words the extractor reads
    from it contain many errors: letters for digits in section numbers, and misread words in the
    sections themselves. GUD-16 to GUD-18 rest on it. A sentence can be bound word for word only
    where the scan was read correctly, and the reviewers would be given the misread words. This
    needs a clean official copy, or a decision on how a text like this is quoted.
  - *A pension circular.* The circular listed with the employment guides' sources is an image
    with no words the extractor can read. The daily check could not capture it. Whether any
    sentence of a guide rests on it has not been checked yet.
  - *The Labour Act.* GUD-27 to GUD-30 rest on the copy at the investment commission's address.
    The build machine's own way of fetching got no answer from that address on 21 and
    22 November 2026: the connection closed. Fetched another way on 22 November 2026, the address
    returned the file, with the checksum the drafts' evidence recorded. The drafts' notes say the
    address's listing calls the file a reference copy. No amendment record has been made for it.

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
>    quotation: no more than 20 words in a row from a passage it cites.
> 8. **Sources.** Only texts fetched from the official hosts in the policy. A source counts as
>    current only under the rule in decision 0017's point 2.
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

The guidance policy is a policy of its own, with its own host list: the hosts the guides and their
amendment records need, the seven above among them, and the Budget Office's for the Finance Acts.

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
that section stay held. Two more things hold a source:

- an instrument that may amend the text and has not been read. While the record lists one, no
  passage of the text is resolved;
- official copies that are known to differ. A passage is confirmed as the operative text only for a
  section that has been compared between the copies.

Where an amending instrument changes a section, the record keeps the words of that section it
deletes or replaces. A passage of the section is unaffected only when it holds none of those words;
where none are recorded, every passage of the section counts as changed.

The two reviews then run the `amendments` and `effective_dates` checks against the record and the
captures (decision 0014).

This cannot prove that no later instrument exists. Only a search of every gazette could, and only a
qualified person could give an opinion on it. The guide's limits will say when and where the search
was made.

**A page is compared by its words (built).** An Act's file is the same bytes every time, and a
different file is a different text until someone has read it. An official web page is not like
that: two of the pages the guides describe return different bytes on every request while saying the
same words. So the daily check now compares a web page by the words read from it:

- When a page returns different bytes and the words read from it are identical, nothing is held.
  The check records that it found the same words, and keeps the new capture.
- When the words differ, the page has changed, and what rests on it is held as before.
- A file, such as an Act's PDF, is still compared by its bytes.
- Words read by a different version of the text extractor are not compared; that counts as a change.

This rule is about every watched source, not only the guides': a rule that rests on a web page is
treated the same way. It takes away false alarms. It cannot notice a change that leaves a page's
words as they were, such as a different picture or a link that now leads somewhere else.

### 3. The rights record

Two different rights are involved.

- **Valo's own wording.** The drafts were written with ChatGPT. The record is the one templates
  use: a copy of the provider's terms taken within a day of preparing the guide, with the passages
  that assign the output and allow commercial use (`chatGPTPermissionRecord`). It lapses after 90
  days.
- **Official text.** The policy's point 7 becomes a check: the longest run of words a guide shares
  with any passage it cites is measured, and a guide that shares more than 20 words in a row fails.
  The public page shows a guide's own words, the section reference and the link, never the passage.
  The passages are kept as private evidence for the reviews.

The record is cleared only while the owner's approval of the policy stands, because its basis is
the policy's point 7.

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
  (`finite-allocation-approval.ts`). The size of those reviews has been measured (see the facts
  above); what they cost is known only from the provider's count after each one.
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
7. The guide preparer and its review requests (built: the preparer reads the daily check's
   captures and checks a guide again before its reviews. In a test with made-up captures and
   reviews, and the owner's approval supposed, a guide passes every check the publisher makes and
   nothing is published).
8. The same review route templates use, opened to guides (built: a package of its own kind for
   guide review pairs, which the owner approves apart from templates; the plan, the manifest and
   the checks made before anything is sent all take a guide. A test now takes a guide the whole
   way in a disposable copy of the database: prepared from a stored capture, its pair of reviews
   admitted only under an approved package of guide reviews (the approvals are made up in the
   test), the two reviews run through the real dispatcher with a stand-in for the model, released
   by the real publisher, and shown on the site only while the supposed approval stands).
9. The daily check compares a page's words, not its bytes (built).
10. A released guide on the site (found already built: a released guide is listed as a free guide
    with its own page, apart from the templates. Added: it is shown only while the policy it was
    released under is still the guidance policy as approved, and the provider's permission for its
    wording is still current, as for a template).
11. Claim maps for GUD-11 to GUD-30, from the official files whose checksums match the recorded
    ones (built for GUD-11 to GUD-15, the privacy guides, with an amendment record for each of
    their two texts. GUD-16 to GUD-30 are not mapped: see the three things found in their texts).

## Decisions for the product owner

The policy is kept as a file, `docs/valo/policies/guidance-publication-policy.md`, with the same
thirteen points. Approving that file settles decisions 1 to 4 and 6 together: the file says so, and
the code counts the policy as approved only while the file is exactly the one approved.

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
   for the cadence to be proposed differently for some subjects. Accept too that a guide's review
   may measure up to 64,000 by the cautious count, where a template's limit is 32,000. The policy
   file states this. If the limit stays at 32,000, none of the ten guides can be reviewed.
7. **Passages for the other twenty guides.** The first ten guides' passages are kept in the
   repository, which is public. They are passages of Acts, kept on the basis recorded with them:
   section 3(b) of the Copyright Act, for official texts of a legislative nature. Say whether
   passages of the other Acts the guides quote may be kept the same way. Unless told otherwise,
   passages of texts that are not Acts (the NAFDAC guidelines, one of which says on its page 2 that
   commercial reproduction needs permission, and the data protection directive) will not be put in
   the repository: those guides will be bound by checksum to private captures. The privacy guides
   are bound that way already, the Data Protection Act included, so they do not wait for this
   answer. If passages of that Act may be kept in the repository, a test could then check their
   quotations in CI, as it does for the first ten guides.
