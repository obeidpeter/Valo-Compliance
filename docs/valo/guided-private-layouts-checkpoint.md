# Twelve question-led private drafts — development checkpoint

This is implementation evidence, not R1/R2 acceptance or catalogue publication.
The machine-readable record is `evidence/guided-private-layouts.json`; its source
hashes and saved-code revision are authoritative for this checkpoint.

## Implemented

The private workspace offers the exact twelve question sets: TPL-01–05,
TPL-08, TPL-12–17. Users provide the actual parties, purpose, dates, quantities,
units, references and agreed terms. Contract/offer forms do not insert statutory
defaults, legal findings, signatures or an industry's presumed clauses.

Conditional questions include supplied tax/discount amounts, receipt
acknowledgement, delivery status, board assumptions, recorded payment
allocations, agreement periods, NDA direction and employment probation.
Unknown payment allocations do not become zero. Missing parties, invalid units,
calendar/date ordering and whole-kobo input failures remain visible.

Raw incomplete answers can be saved without replacing them with invented facts.
The “complete” indicator concerns the shown answer schema only, not suitability,
enforceability, regulatory compliance or editorial eligibility.

Answers and deterministic output use versioned canonical block IDs. No new
unversioned fields were added to the frozen historical revision codec. Undo,
reload and restoration consume the saved canonical answers; the form does not
maintain a second authoritative set of monetary values. Manually positioned
sections survive recalculation. Required question blocks/calculated totals
cannot be deleted or forged through the save API.

The shared preview/Word/PDF projection excludes internal IDs and unselected
conditional answers. Monetary output identifies NGN and supplied kobo. A private
draft cannot silently discard its bound question model during a later save.

## Verification

See the bound report for actual execution times and results:

- 37 passing engineering records, including complete/incomplete paths for all
  twelve layouts, actual DOCX/PDF generation, decimal-safe calculations,
  tamper cases and all ten historic v3 document-hash fixtures.
- The broader API command includes these tests: 150 records, 149 passes,
  one skip, zero failures. These overlapping counts must not be added.
- A managed-Clerk synthetic customer run covers the twelve actual question UIs,
  saves/reloads, missing parties, invalid invoice date/money, 360px reflow,
  associated labels and keyboard interaction.
- Each private DOCX/PDF request uses the ordinary durable worker and private
  storage, with source-revision hash, downloaded-byte checksum and mechanical
  reader checks. Export creation is paced under the existing limit.
- The initial harness failures are retained. It incorrectly guessed a status
  endpoint; the corrected run uses the existing documented listing. Those
  failures are not rewritten as product passes.

Word/PDF **mechanical readers** are not actual Microsoft Word compatibility
review or manual assistive-technology acceptance.

## What this does not complete

These are personal question-led business drafts, **not the forty released
catalogue masters**. No held master was exposed, no publication gate waived and
no professional review fabricated. Published content/rule counts do not increase.
Catalogue entitlement/editorial integration, complete privacy fulfilment and
erasure, formal 80/60/60 acceptance, external operational evidence and R2 remain
open. Live payments and public launch remain disabled.
