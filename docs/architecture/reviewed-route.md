# The reviewed route

Design for the finishing plan's Phase 3 row "The reviewed route, which stays", for EDP-003 to EDP-006,
ADM-004 and ADM-005. It is a proposal under the owner's delegation of 24 November, and it carries out
the plan's delegated decision 2, "The reviewed route stays". Every release on this route rests on two
AI reviews, so running it needs the owner's AI budget. This design builds the route. It approves no
spending and runs no review.

The requirements, verbatim from the specification:
- EDP-003: "Draft from the approved evidence bundle and content schema. Map every material legal
  claim, deadline, rate and applicability condition to a supporting passage; distinguish source
  statements from interpretation and optional practice. Record missing evidence, assumptions,
  provenance and template rights. Accept: invented citations, business facts and rights assertions
  fail validation."
- EDP-004: "Run a factual/source check and a separate challenge for scope, omissions, exceptions and
  misleading certainty, apart from drafting. Reviewers receive the source bundle and candidate, not
  each other’s verdict. Log model, prompt and run IDs; another model is optional. Accept: unexplained
  disagreement holds release. Model agreement is not independent professional validation."
- EDP-005: "For tax, employment, privacy, governance, contracts and regulated-sector content, check
  controlling text, amendments, effective dates, exceptions and jurisdiction. Contract templates must
  expose party/use assumptions and unresolved clauses. Accept: a material uncertainty holds the whole
  template or inseparable rule; detachable unsupported claims may be removed and the complete item
  rechecked."
- EDP-006: "Validate schemas, source locators, dates, scope, numeric extraction, rights records,
  required fields and disclosures. Run deterministic arithmetic and rule fixtures; render both export
  formats. Accept: every mandatory check passes on the exact candidate version. A model’s confidence
  or pass verdict cannot override a failed deterministic check."
- ADM-004: "Validate condition schemas, preview affected profiles and run regression scenarios before
  publishing a new ruleset. Accept: failed critical tests block release and prior versions can be
  restored without losing assessment history."
- ADM-005: "Require provenance, rights evidence, rendered DOCX/PDF samples, scoped limitations and a
  passing AI review manifest. Accept: every published item has an immutable eligible version and
  reproducible export tests; specialist sign-off is not an acceptance dependency."

## What there is

The reviewed route is the release path the specification describes. Content is prepared from
retained drafts and official sources and checked mechanically. Two AI reviews then check it, apart
from each other (decision 0014). The publisher releases it on a login of its own (decision 0017,
point 6), after checking every gate again on the exact version: the policy, provenance, rights,
mechanical checks, both reviews, the enhanced checks and both files. In development, the staff
library and the owner's sign-offs also release content, at no AI cost (decisions 0018 and 0020).
Outside development only this route may.

Built:
- **Seventeen templates have a preparer:** the free forms TPL-01 to TPL-12, and TPL-22, TPL-24,
  TPL-34, TPL-35 and TPL-38. Each is an original form that states nothing about the law, and its
  rights record is one "for an original form that quotes no law".
- **Twenty-seven guides have a claim map and a preparer:** GUD-01 to GUD-15 and GUD-19 to GUD-30.
- **The rule release command,** `rule-release.ts plan|apply`, plans a rule version against the
  registry and the saved answers. It runs the version's critical scenarios, and applies it only with
  the operator's confirming manifest hash. It reads a request file.

The gaps:
1. **A replaced version stays open.** A new version of a template is published beside the earlier
   one, which stays published. The catalogue lists a template's latest visible version. But the file
   and a new document are refused only for a version that is not visible, so a replaced version's
   file still downloads by its address. If the new version is withdrawn, the earlier one returns to
   the catalogue. Decision 0018 and delegated decision 3 close a replaced file to new downloads. The
   editions design left this to this row, with a test of its own against a version really released
   ([editions](editions.md), slice 2).
2. **No guide can be released here.** Decision 0018 releases a regulatory article only after the
   owner's own check of its sources. This route has no such check. So the database refuses to publish
   a guide here (`valo_hold_new_regulatory_release`), and the publisher holds one with
   `REGULATORY_ARTICLE_AWAITING_OWNER_SOURCE_CHECK`. Since 24 November 2026, no package of guide
   reviews is approved or admitted (`GUIDE_REVIEWS_RELEASE_NOTHING`): the reviews would release
   nothing.
3. **Nothing prepares a rule for this route.** The release command reads a request that nothing
   writes. A rule's bundle has no builder, and no kind of package admits a rule's two reviews. A
   restore is done by hand: `restoredRuleVersion` gives a stored version's rule as the next version,
   and someone has to make the rest of the request.
4. **Twenty-three templates have no preparer:** TPL-13 to TPL-21, TPL-23, TPL-25 to TPL-33, TPL-36,
   TPL-37, TPL-39 and TPL-40, all premium. Their drafts are in five frozen candidate files. Four of
   the files keep internal notes on the official sources their templates rest on. Unlike the
   seventeen, these templates rest on the law:
   - the data processing agreement rests on section 29 of the Data Protection Act;
   - the employment templates rest on the Labour Act;
   - the agreements rest on the Copyright Act and the Companies and Allied Matters Act.

   The templates' recorded authority says: "All claims about law require a different source-backed
   applicable policy and verified operative/effective evidence"
   ([operational-publication-authority.md](../valo/policies/operational-publication-authority.md)).
   The guidance policy is such a policy, but only for guides.

## The parts

They are taken in order of the size of their machinery. The content-heavy claim maps come last,
family by family.

### Part 1: a replaced version closes

- **When a version is replaced.** A version is replaced once a later version of the same template
  has been published, whether that later version is still published or was withdrawn since. A
  replaced version is never live again. It is the same in the staff library, where a release never
  returns once it is superseded.
- **The catalogue.** It lists a template's latest released version, and only while it is visible.
  So checkout offers only that version, and each document compares its own edition with it.
- **Files and new documents.** A replaced version's file, and a new document from it, are refused
  under the source-state lock: "A newer version of this template was released. Get it from the
  template's page." The publisher holds the same lock alone while it releases, so a release
  committed first wins.
- **Purchases.** A purchase of a replaced version carries to the latest version under the rule its
  order recorded, as now ([editions](editions.md), slice 2;
  [commercial settings](commercial-settings.md), slice 3b).
- **Documents made from a replaced version.** Such a document reads "replaced" while the latest
  released version stands, and "withdrawn" once that version has been withdrawn. Today the read
  compares only with the version on show, so a document whose replacement was withdrawn reads as
  current.
- **The database.** `valo_workspace_holds_template` is the check the premium forms read. On this
  route it now counts only a version that is not replaced. A migration replaces it
  ([how to apply it](../valo/migration-replaced-reviewed-versions.md)).

Settled while building it:
- A template's versions share one address, so its page shows the latest released version. A
  replaced version has no page of its own.
- The check under the lock asks only whether a later version of the template was released. It reads
  no file and no storage.

### Part 2: the owner's source check for a guide

- **The panel.** The development owner opens Staff → System → **Guides on the reviewed route**,
  signed in with recent MFA. It lists each prepared guide awaiting its reviews, with its exact text
  and every passage its claims rest on.
- **Checking.** **Check official sources** binds each claim again to today's captures: each
  passage's words must be in a capture made within the last day, of the official file its amendment
  record describes. Any claim that does not bind is listed, and it holds the guide.
- **Confirming.** When nothing holds the guide, the owner confirms the check of that exact
  candidate. The check is kept, and is never changed or removed. It records the candidate's
  checksum, each capture it read, the owner's identity and the time.
- **Admission.** A guide's reviews are admitted only for a candidate with the owner's confirmed
  check from within the last day. So no money is spent on a guide the owner has not checked.
  Approving a package stays the owner's own step, as now.
- **Release.** The publisher releases a guide only with the owner's confirmed check of that exact
  candidate from within the last day. The database refuses it otherwise: a migration replaces
  `valo_hold_new_regulatory_release` with that check. An older check holds the guide, and the owner
  checks again, at no cost.
- **What goes.** `GUIDE_REVIEWS_RELEASE_NOTHING` goes. The guide preparation note says what the
  owner does and when.

Settled while building it (slice 2a):
- **One action checks and records.** The owner confirms the candidate by its checksum, and the check
  of its sources runs again at that moment. So the check recorded is the check made. A candidate that
  changed since the owner opened it, or whose review date has passed, records nothing.
- **What the check reads.** Each of the guide's sources must still be bound to the capture its
  candidate names. That capture must still be its watch's current one, checked within the last day,
  and must hold the source's passage and every quotation from it. This is the check the publisher
  makes at release (`verifyReleasedSources`). The files are read outside any transaction, and nothing
  calls a model. In 2a, the first source that does not hold is reported and nothing is recorded. The
  panel, in 2b, lists every claim that does not bind.
- **The database keeps the check.** A row of `valo_reviewed_guide_checks` names the prepared
  candidate, the guide, its version, the candidate's checksums and the capture of each source. The
  database refuses a row from anyone but the development owner and records its time itself. It never
  changes or removes a row, and the table cannot be emptied. `valo_reviewed_guide_checked` answers
  whether the check counts: it is of that exact candidate and captures, made within the last day, by
  someone who is still the development owner. The publisher's role asks it and reads no check or staff
  record itself ([applying the migrations](../valo/migration-reviewed-guide-checks.md)).
- **Where it is asked.** The binding checks ask before admission and again before each review is sent,
  so a check older than a day stops a pair already admitted (`OWNER_SOURCE_CHECK_REQUIRED`). The
  publish command asks before it saves a guide that passes every gate. Without the check it saves
  nothing, and runs again once the owner has checked. The publisher and the database ask again at
  release. A guide that fails a gate is saved and held, as any version is.
- **Approving.** A package of guide reviews is approved as before 24 November 2026. Its pairs are
  admitted only with the owner's check.

Settled while building it (slice 2b):
- **One list.** The panel reads one list of every prepared guide awaiting its reviews, newest first.
  A guide the publish command saved, waiting for a current check before its release, is listed too. A
  guide released, held, withdrawn, past its review date or overtaken by another candidate is not
  listed: it needs no check. Each guide is shown as it would be checked now: its whole text, each
  sentence with the passage it rests on, where each of its sources' copies stands, what holds it, and
  the owner's latest check with the day it counts for.
- **Every problem, not the first.** Listing reads each source's copy without recording anything
  (`inspectReleasedSources`, the read-only form of the publisher's check). It says, for each source,
  whether its copy holds the passage and every quotation from it, has no copy named, comes from a
  file that has changed since, was not checked within the last day, or cannot be read. Each sentence
  whose quotation the copy lacks is named. Every one of these holds the guide, with its reason.
- **Checking again and confirming.** **Check official sources again** reads the list again; nothing is
  recorded. The owner confirms the check of the guide shown, by its candidate's checksum, only when
  nothing holds it, and the check of slice 2a then runs once more before it is recorded.
- **Who reads it.** Only the development owner, signed in with recent MFA, reads the list or records
  a check. Both refuse with 503 until the two migrations are applied.

### Part 3: rules on the reviewed route

- **The bundle builder.** It starts from a rule prepared in the repository for the owner's route
  (`ownerRuleCandidates`), with that rule's claims, sources, scenarios and rights record. It builds
  the rule for this route:
  - the rule as an editorial release, and its body;
  - its claims, bound to today's captures;
  - the guidance policy, the mechanical checks and the two review requests.

  The result is kept as a prepared candidate, as a guide is. Nothing is kept while anything holds the
  rule.
- **Its reviews.** A kind of package of its own admits a rule's two reviews and nothing else, and no
  other kind admits them. Its binding checks rebuild the pair from the builder before admission and
  again before dispatch.
- **The release request.** When both reviews pass, a command assembles the request that the release
  command reads: the rule with its manifest hash, the bundle with its reviews, the scenarios, the
  captures and the reason. It is kept as a private file, and `rule-release.ts plan|apply` take its
  reference.
- **Restoring a version** (ADM-004). `rule-release.ts restore <rule> <version>` prepares a stored
  version's rule as the next version, through the same builder. Like any version, it is reviewed
  again on today's sources, and its reason says which version it restores. Saved results keep the
  versions they were made under, so no assessment history is lost.

Settled while building it (slice 3a, first part: the builder):
- **Two parts.** Slice 3a is built in two pull requests: first the builder, the kept candidate and its
  command; then the reviews, with the package kind and its binding checks.
- **Which rules.** Only a rule prepared in the repository (`ownerRuleCandidates`), named by its id. The
  core library lists their requirement versions (`preparedRuleIds`), and a test holds that list to the
  repository's rules. The route builds the rule's next version: the number after every version either
  route has stored.
- **The same binding as the owner's route.** The rule's sources are bound to today's captures by the
  owner route's own code (`bindRuleSources`, moved out of the sign-off unchanged). A source is current
  only on its amendment record's decision. On this route nobody confirms EDP-005's checks: the two reviews
  run them, as they do a guide's (decision 0014).
- **The rule and its candidate.** The rule is the owner route's, released as an `editorial_release`. The
  candidate's body is the rule without its manifest hash, so the registry admits the release only while
  the two match. It carries the reviewed route's disclosure ("AI drafted and reviewed; not reviewed by a
  Nigerian legal, tax or sector specialist") and the scope, limits, assumptions and claims the repository
  records. Its review date is the rule's.
- **How it was written.** The drafting record says only what is known: the rule was written in the
  repository from research notes, and the model that drafted it is not recorded. No model run of Valo's
  own made it.
- **The rights record holds every rule today.** Each rule's rights record adopts each version's wording
  by the development owner's signature, and this route has none. So a version released here is covered
  only by a rights record the owner chooses for this route (`reviewedRouteRights`). None is chosen, so
  the route holds all four rules with "No rights record covers this rule on the reviewed route", and the
  bundle's rights are not cleared. The tests stand in a synthetic one, and say so.
- **Ten mechanical checks of its own,** measured from the rule against the one prepared in the
  repository:
  - its schema and canonical body;
  - each claim and quotation in its source's passage, none over twenty words;
  - its dates, and a review date no later than its sources stay fresh;
  - its scope, the guidance policy and the official hosts;
  - the numbers in its claims and its figures;
  - its rights record for this route, and its required fields;
  - the disclosure;
  - its arithmetic, which is its source family's calculation bound by its hash;
  - its scenarios, run through the requirements check with the rule in place.
- **Its two files are the rule's sheet.** The sheet holds:
  - what the check shows for the rule, and where to act;
  - the figures it shows, what it covers, its limits and assumptions;
  - its sources with the words it quotes;
  - how it was written and checked, and when its sources were checked.

  It is rendered as Word and PDF, under the guidance notice, and names the rule's version. Both files are
  inspected as a guide's are, for the whole sheet. They are the samples EDP-006 and ADM-005 ask for. The
  check itself shows the rule on screen.
- **What is kept.** When nothing but the two reviews holds the rule, it is kept as a prepared candidate,
  as a guide is: a private file with its evidence, and a row on drafting's own login. Staff → Content
  lists it under "Templates, guides and rules awaiting their reviews". Another version of the rule stored
  under its number, on either route, ends its review there. When anything else holds it, nothing is kept,
  and the command says why.
- **The command.** `finite-inference-run.ts --prepare-rule-candidate <rule>`. Nothing calls a model.

Settled while building it (slice 3a, second part: the reviews):
- **A package of its own.** `finitePackagePreparers.rulePairs` (`rule-review-pair-v1`) admits the
  review pairs of the rules prepared in the repository and nothing else, and no other kind admits a
  rule's pair. Each pair is a factual check and a challenge of one kept candidate, with its plan, and
  never a retry. Only the owner approves such a package, as any other.
- **The two requests.** Each reviewer is given:
  - the rule's candidate, whose body is the rule;
  - its scenarios, each with its answers, its date and the result the requirements check gives for it;
  - its rights record, how it was written and its files' inspection;
  - its sources whole.

  Neither is given the other's verdict (EDP-004). The factual check asks whether the rule says only what
  its passages support. The challenge looks for a business the rule would mislead, missing exceptions
  or thresholds, wrong dates or jurisdiction, and scenarios the passages do not support. A rule that is
  not general also runs EDP-005's five enhanced checks, as a guide does. The requests are kept as a plan
  of their own lane (`rule_publication_review`). They are run by the executor every review pair runs
  on, which takes each request's rebuild as an argument.
- **Built again before admission and dispatch.** The binding checks read the kept candidate and build
  the rule again with the builder. They build it from the repository's rule, the captures its sources
  were bound to, the passages read from them and their amendment records, under the guidance policy as
  it stands. The rebuilt candidate, sources, rights, checks, files and manifest must be exactly the kept
  ones, and the two requests exactly the planned ones.
- **Current sources, not an owner's check.** A guide's pair waits on the owner's check of its sources
  (part 2). A rule's waits on its sources themselves. Each capture it is bound to must still be the
  current copy of its official source, checked within the last day and holding the rule's passage and
  quotations. Its release will make the same check (`verifyReleasedSources`).
- **What it releases: nothing.** The release request and the command that applies it are slice 3b.
  Every rule is still held on its rights record (above), so no rule's reviews can run today.
- **The commands.** `finite-allocation-approval.ts prepare <file> --rule-pairs`, then
  `finite-inference-run.ts --prepare`, `--admit` and `--execute`, as for a guide. The reviews are
  recorded on review's own login.

### Part 4: the twenty-three templates

- **A template's claim map.** As a guide's map does, it places every sentence of the template: as a
  statement of the law bound to an exact passage, Valo's reading of a passage, a term the parties
  choose, a practice, a limit of the template, or not a claim. The map is checked, not trusted, as a
  guide's is.
- **Which policy releases it.**
  - A template whose map states nothing about the law is released under the templates' policy, as
    the seventeen are.
  - A template whose map does state the law is released only under a source-backed policy for
    templates, as the authority requires. Slice 4a writes that policy as a file for the owner to
    approve, on the model of the guidance policy. Until the owner approves its exact text, every such
    template is held with `policy_not_owner_approved`.
- **The preparer.** It builds the candidate from the template's retained draft and its map:
  - its claims, bound to today's captures;
  - its rights record;
  - the enhanced checks EDP-005 names. For a contract, the parties' assumptions, its use assumptions
    and the clauses it leaves open are the candidate's assumptions and unresolved issues;
  - both files and the two review requests.
- **Sources.** Each official source a map rests on is in the source register. Each has an amendment
  record that records only the searches really made (`guidance-amendments.ts`). A source missing
  from the register is added there first.
- **The families,** one slice each:
  - privacy: TPL-29 to TPL-32;
  - commercial: TPL-13 to TPL-15, TPL-18 to TPL-21, TPL-23 and TPL-39;
  - governance and safety: TPL-25, TPL-33, TPL-36, TPL-37 and TPL-40;
  - employment: TPL-16, TPL-17 and TPL-26 to TPL-28. These stay held, as the employment guides do,
    until the owner decides about the Labour Act's reference copy.

## What does not change

- Every gate the publisher checks. Nothing here loosens one.
- The development routes: the staff library and the owner's sign-offs.
- Building this publishes nothing and reviews nothing. Running a review needs a package that the
  owner approves, from the owner's AI budget.
- A claim map is a drafter's reading, for the two reviews to check. It is not a review. No AI review
  is a professional review.

## The slices

Each slice is its own pull request.

| # | Slice | Requirements |
| --- | --- | --- |
| 1 | **A replaced version closes** (built). This design, then part 1, with a migration for the forms' check, its upgrade test and runbook. Unit tests of which version is live for each mix of states. A database test: the real-bindings test publishes TPL-07's version 2 after version 1 through the real publisher, with two passing synthetic reviews. Version 1 then leaves the catalogue, its file and a new document from it are refused, version 2's are served, and a document made from version 1 reads replaced. | DOC-007, EDT-010, ADM-005 |
| 2a | **The owner's source check for a guide, in the database and the route** (built). Part 2 apart from the panel: the kept check, the admission's and the publisher's checks, and two migrations for the database's check, with their upgrade tests and runbook. Database tests: with no check, or a day-old one, GUD-02's reviews are not admitted or sent and the guide is not saved or released. With the owner's check of the exact candidate, the stand-in reviews run and the real publisher releases it, bound to the captures checked. Another person's check, a check of another candidate or other captures, and a check while a capture is stale record or release nothing. | EDP-002, EDP-004, EDP-005, EDP-006, ADM-005 |
| 2b | **The owner's panel** (built). Staff → System → **Guides on the reviewed route**: the list, the candidate's text and passages, what holds it, and the check. Its contract and routes. Tests: the real-bindings database test lists GUD-02 as the owner reads it, with a stale or changed copy holding it and the owner's check counting for a day; unit tests of the inspection's states; and a browser test of the panel on a phone. | EDP-002, EDP-004, CMP-008 |
| 3a | **A rule's bundle and its reviews** (built). The builder, the package kind and its binding checks. Database tests: a prepared rule's pair is admitted only under a package of its kind and runs with a stand-in model. A held rule keeps nothing. | EDP-003, EDP-004, EDP-006, ADM-004 |
| 3b | **The release request and restoring a version.** The request command and the restore. Database tests: a reviewed rule is planned and applied from its request. A restored version is released as the next one, and saved results keep their versions. | ADM-004 |
| 4a | **A template's claim map, its preparer and the proposed policy.** The map's builder and checks, the preparer, and the policy as a file for the owner, with TPL-31, the data processing agreement, mapped first. | EDP-003, EDP-005, EDP-006, ADM-005 |
| 4b–4e | **The families' maps:** privacy, then commercial, governance and safety, and employment. | EDP-003, EDP-005 |

## The owner's points

1. The AI budget for every review on this route.
2. Part 2: the owner's own check of each guide's sources, within a day before its reviews and again
   before its release.
3. Part 4: the source-backed policy for templates, as a file for the owner's approval.
4. The words of the refusal of a replaced file, and of the owner's panel.
5. The Labour Act's reference copy (decision 0017, decision 8). It holds the employment templates as
   it holds the employment guides.
6. Part 3: the rights basis for a rule released on the reviewed route. Each rule's rights record adopts
   a version's wording by the owner's signature, which this route does not have, so the route holds
   every rule until the owner chooses a rights record for it.
