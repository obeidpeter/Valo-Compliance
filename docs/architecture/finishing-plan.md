# Finishing plan

Status: **approved** by the owner on 24 November 2026, in the words "Implement all (make the best
decisions for me)". The owner left the decisions this plan added to the coding agent. They are
recorded, with their reasons, under
[Decisions made under the owner's delegation](#decisions-made-under-the-owners-delegation). Work
starts with phase 0. Approving the plan approves no spending, launch, live payment, real customer
data or real message (AGENTS.md section 1): those stay with the owner, and the rows that need one
say so.

The owner asked for a plan of everything left to implement to finish the platform, apart from the
owner's own tasks. This is that plan. It covers release R1, the commercial core, and then R2. R3
stays excluded. It sits beside the [maintainability and scale plan](plan.md), which is nearly done
and whose open rows are taken up here.

## How it was made

On 24 November 2026 the code at commit `c8a3238` was read against all 127 requirements in
`docs/registers/requirements.json`, family by family, together with the roadmap, the plan, the
known issues and the decision records. Nothing was run for it: every finding comes from reading
code and tests, and a finding is not a test result.

The findings this plan leans on most were then checked a second time in the code. Those rows end
with "(checked twice)". Every row is checked again when its work starts, and a row that turns out
to be built already is struck out, not built again.

Sizes are rough and relative: **S** is under a day of an engineer's work, **M** a few days, **L** a
week or more. They are estimates from reading, not commitments or dates.

## What "finished" means here

- **R1** is the 127 requirements of `docs/specification/VALO-TRD-001-v1.1.txt` and the roadmap's
  content targets. A requirement is finished when its code exists and a test in CI shows it.
- A requirement is **accepted** only by the owner, with evidence from a deployed system: the six
  gates, the ten user-test packs and the three evaluation suites. Acceptance is not in this plan.
  The plan builds what acceptance will need.
- **R2** is what the roadmap lists for growth: team access, more guided documents, a provider
  directory, bundles, attachments.

## Where the platform stands

Built and tested in development: the public site and its redesign, sign-in, the workspace, twelve
fill-in forms with Word and PDF files, the requirements check's engine, tasks and reminders, support
requests, test-mode checkout with refunds and disputes, privacy requests, the staff console, the two
editorial routes (the reviewed route of decision 0014, and in development the staff library of
decision 0018 with the owner's sign-offs of decisions 0018 and 0020), source monitoring, backups in
development, and a CI of seven jobs.

What is left falls into five kinds:

1. **Routes in use lag the reviewed route.** Notices, disclosures, holds, saved items and
   recommendations were built for content released by the reviewed route. The staff library and the
   owner's sign-off, which is how content is released today, lack many of them.
2. **Parts of a requirement no code does yet.** The largest: a fill-in form's file is a list of its
   questions and answers, not the template's own wording; no file can be made without the draft
   notice; the requirements check's questions are fixed in the web app; a privacy request cannot be
   completed.
3. **Things that exist only in development or test mode.** Email, payments, document files, the
   drafting assistant and production itself.
4. **Evidence a requirement asks for that no test gives.**
5. **R2**, of which only a design for team access exists.

## The work

### Phase 0: corrections and loose ends

Small, and none needs a decision. This is where work starts.

**Done on 24 November 2026.** Every row below is built, tested and merged into the integration
branch: the release notice
([#243](https://github.com/obeidpeter/Valo-Compliance/pull/243)), the guide reviews
([#245](https://github.com/obeidpeter/Valo-Compliance/pull/245)), the support requests and
checkout's daily limit ([#244](https://github.com/obeidpeter/Valo-Compliance/pull/244)), the
records ([#246](https://github.com/obeidpeter/Valo-Compliance/pull/246)), the NAFDAC rule
([#247](https://github.com/obeidpeter/Valo-Compliance/pull/247)) and the tests
([#248](https://github.com/obeidpeter/Valo-Compliance/pull/248)). The NAFDAC rule, like the other
three, is released only when the owner signs it.

| What is left | Requirements | Size |
| --- | --- | --- |
| A rule released on the owner's sign-off shows no notice of how it was released on a customer's result, while the sign-off panel says "Shown with it". Show the notice on the result, in the saved result and in its download (checked twice) | EDP-008 | S |
| The reviewed route still admits a guide's two AI reviews, but its publisher now refuses every guide: a guide is released only on the owner's sign-off (decision 0018). Paid reviews of a guide would therefore release nothing. Stop admitting guide reviews unless that route is chosen for guides again, and correct `plan.md` and `docs/valo/guidance-preparation.md`, which still say the route releases a guide (checked twice) | CMP-008, EDP-004 | S |
| The workspace's quick jump to "Support requests" opens a page that does not exist. Fix it and list a customer's support requests in the workspace (checked twice) | WRK-001, WRK-006 | S |
| Checkout's daily limit shares a counter's name with its per-minute limit, so ten checkouts in a day would raise the payment-activity alert | SEC-005 | S |
| Records: list staff-library versions in the release record; cite the staff-library and owner-rule tests in the evidence register; add the backup store to the processor review; remove an advisory exception that no longer applies; count the price and rule-release code in the coverage areas | OPS-005, OPS-006, SEC-007, NFR-011 | S |
| Tests for behaviour already built: the editor's conflict, offline and undo states; a download's headers; checkout and payment-status success; the payment event worker; a new rule version flagging tasks; the reply to an unsupported drafting request; content staff refused a payment setting | EDT-003, EDT-004, EDT-008, PAY-002, PAY-004, PAY-006, RUL-009, AI-001, ADM-001, NFR-009 | M |
| The NAFDAC rule, the fourth research note. NAFDAC's site serves the Act (Cap F33) unchanged since 14 November. Register it as a watched source, write its amendment record from real searches, and prepare the rule and its scenarios for the owner's sign-off | RUL-008 | M |

### Phase 1: documents worth paying for

| What is left | Requirements | Size |
| --- | --- | --- |
| **Forms that produce the document.** A form's file prints each question with its answer. For an invoice that is close to the document; for the five agreements it is not an agreement. Join each form to its template: the answers fill the template's own wording and layout, with clause choices where the template has them. This needs a second version of the forms. The freeze of 21 November is released for it, on the terms of [delegated decision 1](#decisions-made-under-the-owners-delegation) (checked twice). The design, with its slices, is [forms-v2.md](forms-v2.md): a form fills only wording released in the staff library, never the retained drafts | EDT-001, EDT-002, EDT-006 | L |
| With it: a document made from a form records its template and version; the five premium forms check for a purchase, which they do not today; a template's page starts its form; questions carry examples and are filled from the business profile; the server checks answer types (checked twice for the purchase check) | DOC-005, EDT-001, PRO-003 | M |
| **A finished file.** Every file carries "INCOMPLETE DRAFT" on each page, complete or not, and the Word files filed from the retained drafts carry "BLANK DEVELOPMENT TEMPLATE". Check completeness on the server when a file is asked for, and print a complete document without the draft notice (checked twice) | EDT-005, EDT-006, EDT-009 | M |
| **Library templates as full entries.** A template released from the staff library has a title, text and file only. Give it what the reviewed route's entries have: saving, recommendations, "make my own copy" in the workspace, what it is for, what it needs, its limits, related guidance, and a statement of how it was written and checked (the wording is the owner's to approve) | DOC-001, DOC-003, DOC-006, DOC-009, EDP-008 | M |
| **Editions.** Warn when a newer edition exists. When an edition is replaced or withdrawn, tell the people who bought or used it, with what they can do. What a buyer keeps is [delegated decision 3](#decisions-made-under-the-owners-delegation) | DOC-007, EDT-010, EDP-011, PAY-009 | M |
| **Previews.** A real preview for each template instead of two generic lines; a free library template shows a preview, not its whole text; a test that no built page holds premium text | DOC-004 | S to M |
| The editor: a lock on a template's fixed wording; a check that the preview and the files say the same; a check that Word opens the file; table headings repeated across pages | EDT-002, EDT-003, EDT-006 | M |

### Phase 2: a requirements check people can complete

| What is left | Requirements | Size |
| --- | --- | --- |
| **The questions.** The check's steps and nineteen questions are fixed in the web app. The prepared rules read none of them: they read an "optional details" panel of up to 23 fields with no skipping, not filled from the earlier answers. Hold the questionnaire as data, ask each released rule's questions in the main flow with skipping, give sector, product type and local government fixed choices, and let the earlier answers feed the rules (checked twice) | RUL-001 | L |
| **Results.** Show the documents a rule recommends, which the engine returns and no screen shows; record a fee and a deadline with "confirm with the authority"; link each authority's own official route; say what a place or activity is not covered for; show the source-check, review and publication dates separately (checked twice for the recommended documents) | RUL-006, CMP-001, CMP-003, CMP-004, CMP-006, CMP-007, EDP-012 | M |
| **Rule changes.** A new version or a withdrawal records its reason and who it affects, flags saved results and tasks made under the old one, and tells those customers. The owner's panel withdraws a rule with no reason recorded today | CMP-005, EDP-011, ADM-007, RUL-009 | M |
| **The 80 scenarios through the live check.** The runner executes the research notes' calculations in their own format, not the check with released rules. Map the scenarios to the check's answers and run them against signed rules. Build the preparer for the separate AI run that challenges the expected results; running it needs AI spend | RUL-008 | M |

### Phase 3: editorial work on the routes in use

| What is left | Requirements | Size |
| --- | --- | --- |
| **Withdrawal and replacement in the staff library:** a reason, the customers affected, a notice to them, a hold short of withdrawal, and complaints that can point at a library item or a signed rule | ADM-007, ADM-008, EDP-011 | M |
| **Keeping published guidance current.** A regulatory guide stops showing 30 days after its last source check, and only a command or a button rechecks it. Schedule the recheck, give other library content a review date, and put a correction note on content that was republished | EDP-011, CMP-005, CMP-007 | M |
| **The guidance record.** Of a draft's editorial lines only "applicability" is kept. Keep the authority, the action and evidence, the effective dates and the related documents, and show them | CMP-001 | M |
| **The source register.** Sources are a list in code; staff can only start watching one. Let staff keep the register (authority, jurisdiction, instrument, version in force), and let a changed source or a complaint open review work that ends in a prepared candidate. Today such work waits in a row that nothing reads | ADM-003, ADM-008, CMP-007 | M to L |
| **The reviewer's record** (decision 0016, proposed): a reviewer role, a record that cannot be edited, a queue, and the three suites reading it. Nothing of it is built | EDP-010, RUL-008, AI-008 | L |
| **The editorial cases.** Seventeen of the 31 case-bound candidates are unbuilt and each names a text it lacks; the suite's ceiling today is 43 of 60 against a bar of 57. Build them as their texts are retained. Build the scorer for the 60 drafting cases, which has a check for one case only | EDP-010, AI-008 | L |
| **The audit trail.** Alert on an attempt to change it and on heavy privileged reading; a viewer for staff; a guard on the events table; the restore and backup-removal tools record who ran them and why | ADM-009 | M |
| **Commercial settings.** A staff screen for prices in place of a command; one-off bundles; quotas and access rules as versioned settings instead of constants; a price carried to a template's next edition | ADM-006 | L |
| **The reviewed route, which stays** ([delegated decision 2](#decisions-made-under-the-owners-delegation)): preparers for the 23 templates without one, which state law and so need sources and a claim map each; a bundle builder and a release request for rules; a restore command; and, for guides, the owner's source check on this route, which decision 0018 requires: until it exists the route approves and admits no guide's reviews. Running their reviews needs the owner's AI budget | EDP-003 to EDP-006, ADM-004, ADM-005 | L |

### Phase 4: messages

Built against a stand-in sender. Sending a real message stays switched off until the owner approves
a provider and a sender.

| What is left | Requirements | Size |
| --- | --- | --- |
| A sender that reaches each customer's own verified address. Today's only sender refuses outside development and sends to one configured test address. Record delivery and bounces, which nothing writes (checked twice) | WRK-003 | M |
| An unsubscribe link and its endpoint, and marketing consent that a sender reads. Neither exists (checked twice) | WRK-004, PRO-002 | M |
| Receipts and refund notices: they are queued and nothing sends them. A PDF receipt for the customer, who gets a JSON download today (checked twice) | PAY-009, PAY-008 | M |
| An answer for someone who cannot sign in, a notice to staff of a new or ageing enquiry, and a visible state when one fails to go out | SRV-002, IAM-001 | M |
| Correction notices by email as well as in the app | EDP-011 | S |

### Phase 5: payments ready for real money

| What is left | Requirements | Size |
| --- | --- | --- |
| **A first run against Paystack's test mode.** No call to Paystack has ever run: tests stand in for it. Needs the owner's test key. It settles two open points: which signature the webhook carries, and how an unpaid transaction verifies | PAY-002, PAY-003, PAY-004 | S to M |
| **Order safety.** Re-verify an abandoned or failed order before a second order for the same edition; check the status when the customer returns from Paystack; guard an order's line, amount and price in the database | PAY-001, PAY-006 | M |
| **Reconciliation.** Alert on a reconciliation that needs review; a finance action that resolves one, with its trail; a listing from the provider's side as well as Valo's | PAY-007 | M |
| **Live mode, behind the owner's switch.** The code accepts only a test key and Paystack's test domain, and its receipts and screens say "test". Build live mode so that it is refused until production runs with the owner's recorded approval: wording without "test", a tax amount as the owner's treatment requires, the webhook's address and secret in a runbook (checked twice) | PAY-002, PAY-009, PAY-010 | M |

### Phase 6: the drafting assistant

| What is left | Requirements | Size |
| --- | --- | --- |
| **A customer's own request.** A request from the site can never reach a model: approved AI work must be tied to one of the frozen evaluation cases. The known-issues record says only a budget is missing; the path is missing too. Write the decision record for a standing daily allowance, then build it, off until the owner records an amount ([delegated decision 4](#decisions-made-under-the-owners-delegation)) (checked twice) | AI-001, AI-007 | L |
| Follow-up questions in plain words, with a way to answer and ask again; today they are field names. Wider recognition of a legal request the assistant must not take, with a reply that names where to go | AI-001 | M |
| The assistant's notice in plain words (redesign decision 13); the provider's storage setting stated on each request; a staff switch for the customer assistant alone; the time a draft takes, measured; a paid download during an AI outage, tested | AI-009, PRV-002, NFR-004 | S to M |

### Phase 7: privacy and security

| What is left | Requirements | Size |
| --- | --- | --- |
| **Finishing a privacy request.** A request reaches "partly fulfilled" and can go no further: nothing records the steps at the sign-in provider, the processors or the retention review. Add them, completion, a due date with an ageing alert, and a hold that stands on its own (checked twice) | PRV-003 | L |
| **The processing inventory.** No inventory file exists, and the privacy page is a four-paragraph development note. Write the inventory, derive the notice from it, and test both against the database schema and the processor list. Show the notice where data is collected and record the version shown; version the marketing consent; keep the reminder opt-in's history | PRV-001, PRO-002 | M |
| An incident and breach procedure with a rehearsal script | SEC-008, PRV-003 | S to M |
| **The security baseline.** No mapping to OWASP ASVS exists, only scans and tests. Write control, code and cited test for each, with a check that the citations exist | SEC-001 to SEC-008 | M |
| Tests in CI that store hostile markup and render it, reflect it, inject it and cross sites; a rule against raw-HTML output; two test files that run nowhere | SEC-003 | M |
| **Alerts that reach a person.** Alerts are written to a file on the worker and no screen reads them. A staff alert list; signals for abuse spread over many callers, for AI and payment cost, and for bulk data exports; alerts on error rate, latency and backlogs; the route in each request's log (checked twice) | SEC-008, SEC-005, NFR-010 | M |
| Logins of their own for drafting and review, as the publisher has | SEC-006 | M |
| Small hardening: scan the built browser bundle for secrets; a rotation runbook with a rehearsal; limits as settings; an owner and an expiry on each advisory exception; a scheduled scan | SEC-002, SEC-005, SEC-007, OPS-004 | S each |

### Phase 8: launch engineering

Outside development the API starts only as a rehearsal that answers the health check, and 21 module
files refuse to run outside development (checked twice). None of this phase opens production: it
makes opening it a reviewed, rehearsed change.

| What is left | Requirements | Size |
| --- | --- | --- |
| **Staging and launch profiles.** Only development and a rehearsal exist. Add the two profiles; decide, feature by feature, what each development-only guard becomes in production; run the scheduled jobs there; a migration command with a login of its own; a check that each environment holds its own identity keys | OPS-001, OPS-002, OPS-003 | L |
| **Packaging.** The supervisor does not start the web app, and the API image lacks the migrations and the operations scripts. Add them, a test that the images start, and a base image pinned by digest | OPS-002, OPS-005 | M |
| **Backup and restore for production.** The backup cycle refuses anything but development, and no drill runs capture, archive, restore and replay end to end or asserts a recovery time. Build it with a drill that asserts the recovery point and time | NFR-005, OPS-008 | L |
| **Rollback.** Run the previous release against the new schema in CI, and check that a migration only adds | OPS-008 | M |
| **Compatibility probes** for the host: identity callbacks, the domain, outbound provider calls, the browser binary, the database's connection limit. Running them needs the host | OPS-007 | M |
| **Measurement.** A monthly availability report and its schedule; page timing from real visits; a trigger for the 30-minute load run; Firefox and WebKit runs with a supported-version list | NFR-001, NFR-002, NFR-003, NFR-007 | M |
| **The launch change**, prepared and reviewed but applied only on the owner's approval: the production gate, the search-engine block and the development notices | KI-001 | S |
| **The acceptance pack.** The ten user-test packs as scripted journeys where a script can run them; the evidence for each gate gathered by a command; the registers refreshed | UAT-01 to UAT-10 | M |

### Phase 9: the site

| What is left | Requirements | Size |
| --- | --- | --- |
| Filters on the guides, industries and help pages kept in the address so a view can be shared; loading, empty and error states tested on the remaining primary pages | WEB-002 | S |
| Search judged on guidance, articles, industries and services as well as templates | WEB-003 | S |
| The offer to check requirements again after any change to the business profile, and tests that tasks survive a new result | PRO-003 | S |
| Sign-in tested against the provider's test instance: verification, an expired link, recovery, sign-out, staff second factor. Needs test-instance credentials in CI | IAM-001, IAM-002 | M |
| The remaining words: 215 server sentences about payments, privacy requests and the drafting assistant, which wait on redesign decisions 13 to 15, and the staff screens | NFR-008 | M |

### R2

After R1 is live, as the roadmap orders it. Each starts with the owner's decisions.

| What is left | Source | Size |
| --- | --- | --- |
| **Team access:** roles, grants to named content, invitations. The design is in [r2-team-access.md](r2-team-access.md) with five decisions for the owner | Roadmap W21–24; TRD roles | L |
| **More fill-in forms:** twelve more to reach the roadmap's 24, then the rest of the 28 that are files only; easier repeat use; saved requirements | Roadmap W21–28 | L |
| **The provider directory:** provider records, a verification workflow, verified profiles, and requests for a quote or availability. No provider record exists today, and R1 rightly lists none | SRV-003, SRV-004 | L |
| **Bundles and subscription trials.** Recurring billing stays off until cancellation, refunds and failed renewals are tested | Roadmap W25–28; PAY-010 | L |
| **Attachments** on tasks, with malware quarantine, safe preview and retention | Roadmap; WRK-005 | L |
| Scoped drafting for selected contracts; the NGO experience; state and FCT packs, which the guidance policy bars until the owner decides | Roadmap; CMP-003 | L each |

## What only the owner can do

The plan does not include these. Each phase names the ones it waits on.

- **Content:** file and publish the drafts; check and sign the regulatory guides and the rules.
- **Decisions already asked for:** the guidance policy's wording; the drafting assistant's sentence;
  premium prices, licence text and tax treatment; decisions 0016 and 0017; the five decisions on
  team access.
- **Decisions this plan added:** left to the coding agent on 24 November 2026, and made below.
  The owner can reverse any of them; the work that follows one says which.
- **The test with five business owners**, and a person for the manual accessibility review.
- **Money:** AI budgets; hosting, database, storage, backups, monitoring and a domain; an email
  provider.
- **Accounts and keys:** a Paystack test key now and a live key at launch; the identity provider's
  production instance and test credentials for CI; an email sender.
- **Readers:** a legal read of the privacy and terms pages, the privacy notice, the refund policy
  and the licence text; an independent reviewer for the three suites; an outside security
  assessment.
- **Replit:** apply the migrations; adopt the migration ledger or give access to do it.
- **Launch:** approve the launch change, the merge to `main`, opening traffic and live payments.

## Decisions made under the owner's delegation

On 24 November 2026 the owner approved this plan with "Implement all (make the best decisions for
me)". The coding agent made the decisions the plan had put to the owner, as follows. Each follows
the specification where it already says something, and none of them approves spending, a launch,
live payments, real customer data or a real message.

1. **The forms' questions.** The freeze of 21 November (redesign decision 6) is released for the
   second version of the forms, on these terms. A question the second version keeps is carried over
   in the first version's words, so nothing is reworded on a guess before the test. New questions
   are only those the template's own wording needs, such as a clause choice. Documents already
   made keep the first version. The test with five business owners then judges the second version,
   and its findings reword what confuses people, as decision 6 intended. Reason: the forms cannot
   produce the document without the template's wording (EDT-001, EDT-006), the test has no date,
   and decision 6 froze wording, not the documents a form produces.
2. **The reviewed route stays.** It is the route the specification describes (EDP-001 to EDP-012,
   CMP-008, ADM-005) and the only one that may release content outside development: the staff
   library and the owner's sign-offs are development routes with a review budget of nothing
   (decisions 0018 and 0020). Its code and tests are kept working, and the last row of phase 3 is
   built. Running its reviews needs the owner's AI budget. Whether the development routes are also
   taken to production is a launch decision for the owner (phase 8).
3. **What a buyer keeps.** Following DOC-007, EDT-010, PAY-008, PAY-009 and decision 0018:
   - A customer's saved drafts and the documents made from them stay the customer's, and an update
     never changes them.
   - When an edition is **replaced**, the purchase carries to the new edition of the same template
     at no further charge. The replaced file closes to new downloads, as decision 0018 says; its
     record stays, and the buyer is told what changed.
   - When an edition is **withdrawn** as unsafe, nobody can download it again or start a new
     document from it. The buyer is told why and what they can do: take the replacement when one
     is released, or ask for a refund under the refund policy, whose terms are the owner's. Drafts
     made from it can still be opened and downloaded, with a notice that the template was
     withdrawn.
   - A **refund** ends new downloads of the bought file, and leaves the drafts.
   - Nothing says that closing access takes back a file already downloaded (EDT-010).

   The licence text that states this is still the owner's to approve.
4. **A daily allowance for customers' drafting.** Its decision record is written and its path is
   built, switched off. The amount is an AI budget, which only the owner sets (AGENTS.md
   section 1). Until the owner records one, the allowance is nothing and no customer request
   reaches a model.
5. **The premium drafts' text stays where it is.** It is frozen content (AGENTS.md section 7) and is
   already in the repository's public history, which cannot be rewritten (section 1). The
   repository is public by the owner's decision 0006. The site itself still never serves a premium
   text without a purchase (DOC-004), which phase 1's previews row tests.

## Order

Phase 0 first. Then phases 1 and 2, which decide whether a customer gets what the site offers.
Phases 3, 4 and 7 follow in slices, most valuable first. Phases 5 and 6 move when their inputs
arrive: a Paystack test key, and the decision on customers' drafting. Phase 8 starts when a hosting
decision is near, since most of it is proved only on a host. Phase 9's small rows fill gaps between
the others. R2 follows R1's launch.

Work lands as it does now: one pull request at a time into the integration branch, each with its
tests, merged only when hosted CI passes on its exact commit.

## What this plan does not do

- No R3.
- No acceptance of a requirement, a gate or a user-test pack.
- No new content written: the 19 further templates proposed for R2, and any state or local
  guidance, wait for the owner.
- No spending, launch, live payment, real customer data or real message without the owner's
  approval.
