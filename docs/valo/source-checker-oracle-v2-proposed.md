# Source-checker oracle v2 — proposed, not accepted

Version: `source-checker-oracle-v2-candidate`.

The original corpus and its expected labels are unchanged. The actual comparison
still reports **72 matches and eight failures**. These are explicit proposals
for independent source challenge, not permission to redefine passing criteria or
publish a rule. Neither a specialist signature nor an extra per-item owner
approval is introduced.

The two negative-result support gaps were independently identified in
`docs/reviews/rule-evaluation-readiness-2026-11-14.md`. That review also identified
NAFDAC scope ambiguities. The implementation now uses one explicit NAFDAC scope:
**national product-registration relevance**, not eligibility for a local
manufacturer application. The two additional consequences for resale and known
commercial supply also need challenge rather than silent oracle edits.

| Original case | Original label | Candidate label | Source-specific rationale |
|---|---|---|---|
| NDPA-018 | Not indicated | More information needed | Section 2(2)(a) separately includes controller/processor domicile, residence or operation. Negated operation, processing location and subject location do not answer domicile/residence or every processor connection. |
| NTAA-009 | Not indicated | More information needed | Section 147's company definition includes associations. An ordinary-partnership label and absence of CAMA incorporation do not alone establish the proposed tax-definition exclusion. This does not assert that the partnership owes a company return. |
| NAFDAC-005 | Not indicated | Likely relevant | Section 1(1) expressly includes sale/distribution. An asserted existing supplier registration is a satisfaction/action fact, not removal of national product-registration relevance. No duplicate application is suggested. |
| NAFDAC-009 | May apply | Likely relevant | Regulated processed-food supply/repackaging is known; uncertainty about a local-manufacturing route does not remove the broader product-registration question. Supplier coverage of the original product is not invented coverage of repackaging. |
| NAFDAC-012 | More information needed | Likely relevant | Cosmetic category and commercial supply are known. The precise questionnaire binding of “commercial supply” to sale/distribution/other section 1 activities must be challenged; it cannot silently mean an unknown activity. |
| NAFDAC-013 | May apply | Likely relevant | Section 1(1) expressly includes importation. It does not depend on domestic manufacture. Import-specific procedure is kept separate. |
| NAFDAC-016 | May apply | Likely relevant | Under section 13 the therapeutic description needs classification; both the drug and cosmetic branches are nevertheless within section 1(1). Procedural classification remains unresolved, not the existence of a product-registration question. |
| NAFDAC-017 | May apply | Not indicated for the confirmed sample activity | Section 1(2) permits the stipulated matching cosmetic-sample activity under its satisfied permit conditions. This says nothing about subsequent commercial supply, general exemption or the disappearance of continuing permit conditions. |

Full IDs retain their `CHK-CAND-` prefixes in the actual result artifact.

## Actual source bindings

- NDPA sections 2–3: official Act PDF pages 7–8 / A723–A724, retained in
  `source-evidence/ndpa-captured-passages.json` as `NDPA-2-3`.
  The independently downloaded NCC PDF matches the official NDPC research hash.
- NTAA section 147: National Assembly PDF pages 73–76 / A329–A332,
  `registration-tax-passages.json`, `NTAA-147-DEFINITIONS`; section 11
  is retained separately. The printed commencement and threshold discrepancies
  are not declared resolved or used to invent tax amounts/dates.
- NAFDAC Cap F33 sections 1 and 13: actual PDF pages 2 and 7,
  `nafdac_cap_f33.pdf` and exact page text files. Page 2 states manufacture,
  import, export, advertising, sale and distribution; its sample-permit list
  does not list processed food. Page 7 supplies the relevant product definitions.

Exact raw-source, passage, algorithm and original-corpus hashes are in the
80-case result artifact. These proposals have **no accepted oracle version,
provider challenge run, released manifest or customer-use eligibility**.
