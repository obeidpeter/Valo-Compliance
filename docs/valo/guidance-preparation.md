# Preparing a guide for its two reviews

This note is for the person who runs commands in the development environment. It covers one step:
turning a guide's retained draft into a candidate that is ready for its two AI reviews
([decision 0017](../architecture/decisions/0017-clear-guidance-holds.md)).

The command calls no AI model, approves nothing and publishes nothing. The owner approved the
guidance policy on 22 November 2026. If the policy file is edited, that approval ends: the command
then prints what holds the guide and keeps no candidate.

## What must be in place

1. **The drafting login.** Apply its migration and enable it as
   [the drafting login note](migration-drafter-login.md) says, and give the command its connection
   (`VALO_DRAFTER_DATABASE_URL`). Without it the command stops with `VALO_DRAFTER_LOGIN_UNAVAILABLE`
   before it reads, renders or keeps anything.
2. **The publisher login.** Apply its migration and enable it as
   [the publisher login note](migration-publisher-login.md) says. A guide can be prepared without
   it, but it cannot be published.
3. **A watch on each official address the guide rests on.** A member of staff registers the
   address for the daily check with the source controls in the Content area. A watch approves
   nothing. The addresses are:

   | Source | What it is | Guides that rest on it |
   | --- | --- | --- |
   | `SV-010` | Companies and Allied Matters Act 2020, the Commission's copy | GUD-01 to GUD-07, GUD-10 |
   | `NASS-NTAA-2025` | Nigeria Tax Administration Act 2025, the National Assembly's copy | GUD-07 to GUD-10 |
   | `CAC-BN-PROCESS` | The Commission's business-name page | GUD-01, GUD-03 |
   | `S03` | The Commission's registration portal, front page | GUD-05 |
   | `NRS-TAXID-HOW` | The revenue service's page on how Tax ID retrieval works | GUD-08 |
   | `S04` | Nigeria Data Protection Act 2023, the Commission's copy | GUD-11 to GUD-15 |
   | `S05` | The Commission's General Application and Implementation Directive 2025 | GUD-11 to GUD-15 |
   | `NAFDAC-FSAN-GDL-004-03` | NAFDAC guideline: inspection of micro scale food manufacturing facilities | GUD-19 |
   | `NAFDAC-FSAN-GDL-005-03` | NAFDAC guideline: inspection of small scale food enterprises | GUD-19 |
   | `NAFDAC-FSAN-GDL-001-03` | NAFDAC guideline: pre-packaged food manufacturing and packaging facilities | GUD-19, GUD-20 |
   | `NAFDAC-FRRA-GDL-002-01` | NAFDAC guideline: registration of pre-packaged food made in Nigeria | GUD-21, GUD-26 |
   | `NAFDAC-FSAN-GDL-006-03` | NAFDAC guideline: good manufacturing practice for food | GUD-22, GUD-23 |
   | `NAFDAC-FSAN-GDL-008-03` | NAFDAC guideline: food hygienic practices | GUD-24 |
   | `NAFDAC-IE-GDL-001-02` | NAFDAC guideline: handling and disposal of unwholesome regulated products | GUD-25 |
   | `NAFDAC-FRR-GDL-003-01` | NAFDAC guideline: advertisement of food products | GUD-26 |
   | `NIPC-LABOUR-ACT` | Labour Act, the investment commission's reference copy | GUD-27 to GUD-30 |

   The command asks only for the addresses the guide it is given rests on.

4. **A capture of each address, checked within the last day.** The daily source check makes it. The
   preparer fetches nothing itself.
5. **A copy of the AI provider's terms taken within the last day.** This command fetches the
   provider's five public pages and writes the copy:

   ```sh
   NODE_ENV=development tsx src/scripts/capture-provider-terms.ts /path/to/terms.json
   ```

   It refuses to write the copy if a page no longer holds the sentence the rights record looks for.
   That is a real stop, not a fault to work around: someone has to read what the provider's terms
   now say before any template or guide is prepared. The command has not yet been run against the
   provider's site from the development environment. Run from a build machine with a plain
   request, the five pages were served on 21 November 2026 and held all five sentences.
6. **The owner's approval of the guidance policy.** Given on 22 November 2026 for
   `docs/valo/policies/guidance-publication-policy.md` as it stands, and held in the code as that
   file's checksum. Any edit to the file ends it until the owner approves the new text, and every
   guide is then held
   ([decision 0017](../architecture/decisions/0017-clear-guidance-holds.md) records the approval).

## The command

Run it from `artifacts/api-server`, with the guide and the path of the terms file:

```sh
NODE_ENV=development tsx src/scripts/finite-inference-run.ts --prepare-guide-candidate GUD-01 /path/to/terms.json
```

Only GUD-01 to GUD-15 and GUD-19 to GUD-30 have a claim map today, so only they can be named.

The words of the two Acts GUD-01 to GUD-10 quote are kept in the repository. The words of the data
protection Act, the directive, the eight food guidelines and the Labour Act are not: for GUD-11 to
GUD-15 and GUD-19 to GUD-30 the repository keeps only where each passage starts and ends and the
checksum of its words. Such a guide is built only from a capture.
If no capture supplies any of its passages, the command stops with `GUIDE_HAS_NO_BOUND_SOURCE`:
its addresses are not watched yet, their captures are older than a day, or the files read
differently from the way they read on 21 November 2026 (22 November for the Labour Act).

GUD-27 to GUD-30, the employment guides, can be named and will come back held. Their only source
is a copy of the Labour Act that its publisher calls a reference copy, and one Act that might
change it could not be read. The amendment record carries both, so no passage of that copy is
marked current. The command prints `source_unresolved` for each passage. They stay held until the
owner decides about the copy (decision 0017, decision 8) and the record is changed to say so.

## What it prints

One line of JSON. Its `state` is one of two.

- `held`: the guide is not ready. `reasons` lists what the publication gate named, apart from the
  two reviews. No candidate is kept. Fix the cause and run the command again.
- `awaiting_reviews`: the gate named nothing but the two reviews. The candidate is kept as a
  private file. It appears in the staff Content area, in the list headed "Templates and guides
  awaiting their reviews". `id` and `candidateArtifact` name it.

Reasons you are likely to see:

| Reason | What it means |
| --- | --- |
| `policy_not_owner_approved` | The policy file is not the text the owner approved on 22 November 2026: it has been edited since. |
| `rights_not_cleared`, `check_not_passed:rights` | The rights record rests on the policy's point 7, so it waits for the same approval. Or the guide repeats more than 20 words in a row from a passage. `rightsProblems` says which. |
| `legal_scope_unverified`, `material_uncertainty`, `source_unresolved:<passage>` | A sentence about the law is not bound, or a source is not marked current. `missingEvidence` lists each one. The usual cause is a missing or stale capture. For the employment guides it is the open question about their copy of the Labour Act. |
| `check_not_passed:scope` | The candidate's claims no longer match its claim map and its sources. |
| `export_inspection_failed` | The Word or PDF file did not read back as the candidate. |

A source is not marked current when its capture is a different file from the one its amendment
record describes. That is deliberate: someone has to read the new file and write a new record
(`guidance-amendments.ts`) before any guide can rest on it.

## What happens next, and what is not built

- **The two reviews: only after the owner's check of the guide's sources.** A guide that says what
  the law requires is released only after the development owner's own check of its official sources
  (decision 0018). On the reviewed route that check is of one prepared candidate
  ([the reviewed route](../architecture/reviewed-route.md), part 2). The owner confirms the
  candidate by its checksum. Each capture the candidate is bound to must still be its watch's current
  one, checked within the last day, and hold the guide's passages and quotations. The database keeps
  the check, refuses it from anyone but the development owner, and never changes or removes it. A
  check counts for a day.

  1. `tsx src/scripts/finite-allocation-approval.ts prepare <package.json> --guide-pairs` writes a
     package of the guides' kind. The owner approves it as any package, with `approve`.
  2. `tsx src/scripts/finite-inference-run.ts --prepare <package id> --candidate=<artifact id>:<sha256>`
     plans the pair for a prepared guide, and calls no model. Admitting the pair, and sending each of
     its reviews, is refused with `OWNER_SOURCE_CHECK_REQUIRED` until the owner has checked that
     candidate's sources within the last day. A pair admitted under another kind of package is refused
     with `PACKAGE_EXECUTABLE_PREPARER_UNAVAILABLE` or `WORK_OUTSIDE_PACKAGE`.
  3. `publish-reviewed-pair.ts` saves and releases a guide that passes every gate only on such a
     check. Without one it stops with `OWNER_SOURCE_CHECK_REQUIRED` and saves nothing: the owner checks
     again, at no cost, and the command is run again. A guide that fails a gate is saved and held. The
     publisher and the database ask for the check again at release.

  The owner makes the check in Staff → System → **Guides on the reviewed route**. It lists each
  prepared guide awaiting its reviews with its whole text, each sentence with the passage it rests on,
  where each source's copy stands today and what holds it. **Check official sources again** reads
  them again. When nothing holds the guide, the owner confirms the check of that exact guide, and
  the panel shows until when it counts. No real check has been made: the two migrations are not
  applied to the Replit development database
  ([how to apply them](migration-reviewed-guide-checks.md)), and until they are the panel says so and
  records nothing.

  A test shows the route for GUD-02, in a disposable copy of the database with made-up approvals and
  a stand-in for the model. The guide is prepared from a stored capture and its pair planned. Before
  the owner's check nothing admits its pair. A check by anyone else, a check of other words, and a
  check while the Act's capture is stale are refused and record nothing. With the owner's check, the
  pair is refused without an approved package and under an approved package of template reviews, and
  is admitted under an approved package of guide reviews. A day after the check its reviews are not
  sent and the guide is not saved. On a current check, both reviews run through the real dispatcher,
  and the real publisher releases the guide, bound to the captures the owner checked. The reviews in
  the test are controlled fixtures, not reviews.

  One command line has been run for a guide, as a process in a test: the preparing command, against
  a database that holds no watch on the guide's address. It stops with `GUIDE_HAS_NO_BOUND_SOURCE`
  and keeps nothing, and it refuses a guide with no claim map and a call without the terms file.
  No guide has been through any of this for real.
- **Publication.** The publisher makes every check again at release, including that each source is
  still the capture its address serves. A test passes a prepared guide through all of those checks
  in a database transaction that is rolled back. No guide has been published.
- **Pages that change with every request.** The business-name page and the Tax ID page return
  different bytes each time they are fetched while saying the same words. The daily check compares
  a web page by its words, so that alone holds nothing. If a page's words change, what rests on it
  is held until it is prepared and reviewed again.
- **Four guides are mapped and held by their source**: GUD-27 to GUD-30 (employment). See above.
- **Three guides have no claim map yet**: GUD-16 to GUD-18 (consumer protection). The only
  official copy of their Act is a scan the extractor misreads (decision 0017, decision 9).
