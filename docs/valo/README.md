# Valo Compliance — implementation and evidence

Visible brand: **Valo**. Homepage copy: **The documents you need. The business rules you should know.**

This is development work, not a released compliance product. Do not infer acceptance from a title, a screenshot, a test fixture or this document.

## Contract intake

The master brief, EDP-001–EDP-012 and TPL-01–TPL-40 were supplied in chat. The three referenced Word documents are not present. Remaining formal requirements and original P0–P5 criteria must be ingested verbatim when supplied. Expected formal count is 127; received exact formal IDs: 12. Do not fabricate the other 115 or their numbering.

The team reports a 27-document/79-row inventory, yielding five direct matches, one composite manual and 21 additions, hence 61 distinct identified templates. This report has not been independently mapped here. The 19 proposed candidates must be checked against the missing inventory before claiming 80 distinct templates. NGO SCUML is an alias, not a second publication.

## Executable registers

- `pnpm --filter @workspace/scripts valo:readiness` returns the current formal traceability, conflicts, release holds, catalogue and evaluation-suite state.
- `pnpm --filter @workspace/scripts test:valo` runs early deterministic unit checks. These are NOT the formal 80-rule, 60-customer-AI or 60-editorial suites, nor real model/export/restore evidence.
- `lib/valo-core/src/traceability.ts` preserves the exact supplied editorial requirement body and acceptance text. Paths are implementation links, not acceptance evidence.
- `lib/valo-core/src/catalogue.ts` contains inventory metadata only. Zero templates are released.
- `lib/valo-core/src/publication.ts` validates manifest bindings and mandatory conditions. It is **not a live publisher**. No HTTP endpoint accepts a submitted manifest as trustworthy.

## Current proof boundaries

Clerk development tenant provisioning succeeded. Verified login, password recovery, staff MFA and tenant-scoped business/document persistence are not yet demonstrated.

No customer drafts, legal publications, compliance rules, purchases, provider bookings or export files have been seeded as completed work.

The validator's synthetic attestations exercise logic. Production must derive attestations from an immutable trusted store, actual provider runs, source passages, rights records and real renderer outputs. Semantic completeness, prompt injection resilience, rights validity and legal accuracy are not established by hashes or unit tests.

## Explicit release restrictions

- R1 first; R2 remains locked until R1 required gates pass.
- R3 is out of scope.
- No public launch, live payments, recurring billing, real confidential customer data, paid hosting commitments or subscription purchases.
- No invented specialist endorsement. Per-item specialist review is not a required gate; actual owner scope policy, independent AI checks and deterministic validation are.
- No legal/regulatory lead is published until controlling text, claims, dates, rights and all applicable gates are proven.

## GitHub

A GitHub connection was attached. A metadata request for `obeidpeter/Valo-Compliance` returned HTTP 404. This can mean the repository does not exist or that the connected GitHub App cannot see it. It does not establish repository creation or successful synchronization.

Do not create a competing repository while separate creation is underway. Required: make the intended private repository visible to the connected GitHub App with contents write permission, then verify its identity and existing content before a non-destructive initial push. Keep all work in Replit until then.
