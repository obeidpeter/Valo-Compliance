# Preparing a guide for its two reviews

This note is for the person who runs commands in the development environment. It covers one step:
turning a guide's retained draft into a candidate that is ready for its two AI reviews
([decision 0017](../architecture/decisions/0017-clear-guidance-holds.md)).

The command calls no AI model, approves nothing and publishes nothing. It can be run before the
owner has approved the guidance policy: it then prints what holds the guide and keeps no candidate.

## What must be in place

1. **The publisher login.** Apply its migration and enable it as
   [the publisher login note](migration-publisher-login.md) says. A guide can be prepared without
   it, but it cannot be published.
2. **A watch on each official address the guide rests on.** A member of staff registers the
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

   The command asks only for the addresses the guide it is given rests on.

3. **A capture of each address, checked within the last day.** The daily source check makes it. The
   preparer fetches nothing itself.
4. **A copy of the AI provider's terms taken within the last day.** This command fetches the
   provider's five public pages and writes the copy:

   ```sh
   NODE_ENV=development tsx src/scripts/capture-provider-terms.ts /path/to/terms.json
   ```

   It refuses to write the copy if a page no longer holds the sentence the rights record looks for.
   That is a real stop, not a fault to work around: someone has to read what the provider's terms
   now say before any template or guide is prepared. The command has not yet been run against the
   provider's site from the development environment. Run from a build machine with a plain
   request, the five pages were served on 21 November 2026 and held all five sentences.
5. **The owner's approval of the guidance policy**, recorded as
   `docs/valo/policies/guidance-publication-policy.md` describes. Without it every guide is held.

## The command

Run it from `artifacts/api-server`, with the guide and the path of the terms file:

```sh
NODE_ENV=development tsx src/scripts/finite-inference-run.ts --prepare-guide-candidate GUD-01 /path/to/terms.json
```

Only GUD-01 to GUD-15 have a claim map today, so only they can be named.

The words of the two Acts GUD-01 to GUD-10 quote are kept in the repository. The words of the data
protection Act and the directive are not: for GUD-11 to GUD-15 the repository keeps only where each
passage starts and ends and the checksum of its words. Such a guide is built only from a capture.
If no capture supplies any of its passages, the command stops with `GUIDE_HAS_NO_BOUND_SOURCE`:
its addresses are not watched yet, their captures are older than a day, or the files read
differently from the way they read on 21 November 2026.

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
| `policy_not_owner_approved` | The owner has not approved the policy file as it stands. |
| `rights_not_cleared`, `check_not_passed:rights` | The rights record rests on the policy's point 7, so it waits for the same approval. Or the guide repeats more than 20 words in a row from a passage. `rightsProblems` says which. |
| `legal_scope_unverified`, `material_uncertainty` | A sentence about the law is not bound, or a source is not marked current. `missingEvidence` lists each one. The usual cause is a missing or stale capture. |
| `check_not_passed:scope` | The candidate's claims no longer match its claim map and its sources. |
| `export_inspection_failed` | The Word or PDF file did not read back as the candidate. |

A source is not marked current when its capture is a different file from the one its amendment
record describes. That is deliberate: someone has to read the new file and write a new record
(`guidance-amendments.ts`) before any guide can rest on it.

## What happens next, and what is not built

- **The two reviews.** They run only inside an allocation the owner approves, and the owner
  approves guide reviews apart from template reviews. The steps are the templates' own, with a
  package of the guides' kind:

  1. `tsx src/scripts/finite-allocation-approval.ts prepare <package.json> --guide-pairs` writes a
     package that admits the review pairs of guides and nothing else. Only the owner, or someone on
     the owner's written instruction, records its approval with the same command's `approve`.
  2. `tsx src/scripts/finite-inference-run.ts --prepare <package id> --candidate=<artifact id>:<sha256>`
     plans the pair for a prepared guide. It calls no model.
  3. `--admit` and then `--execute` of the same command admit the pair under the approved package
     and run the two reviews. This is the step that spends.
  4. `tsx src/scripts/publish-reviewed-pair.ts <batch id> <result artifact id> <sha256>` saves the
     version with its reviews and hands it to the publisher, or records the hold.

  What stands behind these steps has been run for a guide in a test, in a disposable copy of the
  database with a stand-in for the model and made-up approvals. The guide is prepared from a
  stored capture. Its pair of reviews is refused while no package is approved, refused under an
  approved package of template reviews, and admitted under an approved package of guide reviews.
  The two reviews then go through the real dispatcher, and the publish step releases the guide
  through the real publisher. The command lines themselves have not been run for a guide. No guide
  has been through any of this for real.
- **Publication.** The publisher makes every check again at release, including that each source is
  still the capture its address serves. A test passes a prepared guide through all of those checks
  in a database transaction that is rolled back. No guide has been published.
- **Pages that change with every request.** The business-name page and the Tax ID page return
  different bytes each time they are fetched while saying the same words. The daily check compares
  a web page by its words, so that alone holds nothing. If a page's words change, what rests on it
  is held until it is prepared and reviewed again.
- **The other fifteen guides**, GUD-16 to GUD-30, have no claim map yet.
