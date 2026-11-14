# Coordinating refinement: actual development evidence and limits

## Scope and traceability

This is an increment of the existing Valo application, not a restart or a gate
acceptance. All 127 original requirement IDs, 40 baseline templates, 79 regulatory
rows and previously retained exact contracts remain intact.

`docs/registers/coordinating-refinement.json` binds the coordinating findings to
the retained register hashes. All 27 mappings match: five exact overlaps, one
composite manual and 21 distinct additions. The 19 further proposals remain
distinct candidates; the catalogue still has zero published assets.

All 13 C-01–C-13 resolutions are now also visible in the live requirements
register. A resolution of specification precedence is not implementation or owner
approval. All 14 SV observations remain attributed to the coordinating team.
Their reported retrieval status cannot substitute for local evidence.

URL deduplication preserves all original S01–S24 IDs and adds only four distinct
research URLs: SV-003, SV-004, SV-006 and SV-010. The three additional Replit URLs
remain locally unattempted; their team observations are not presented as local
snapshots. Current official Replit documentation was consulted separately.

## Actual official PDF ingestion

Only S02 and SV-010 receive a maximum 32 MiB / 60-second request profile; other
sources retain the 8 MiB / 15-second bound. HTTPS, DNS public-address checks,
address pinning and same-host redirect restrictions remain enforced. Larger
extraction inputs must be actual PDF bytes with PDF MIME type. Extracted output
remains bounded at 8 MiB; subprocesses have timeouts and temporary files are
deleted in `finally`.

The first NRS attempt with the shorter timeout failed in transport. Its result
is retained in the report and immutable database history. The bounded retry
captured **27,677,259 bytes** and extracted text. The CAC Gazette PDF captured
**1,269,127 bytes** and extracted text. Raw and extracted objects were written with
the native private-storage SDK and read back for checksum comparison.

The actual CAC PDF metadata title is **ELECTORAL (AMENDMENT) ACT, 2015**. Its text
identifies Companies and Allied Matters Act 2020. The system records this conflict,
uses body pages for provisional identity and does not trust metadata for release.
A regression test proves a blank first PDF page cannot shift subsequent locators.

Identity checks are not checks of amendments, currentness, operative completeness,
rights, legal interpretation or applicability. No statutory rate, deadline,
exemption or filing rule was released. All source records remain unreviewed and
held; NDPC blocked text and historical NAFDAC tariff cautions remain unchanged.

See `docs/valo/evidence/coordinating-instrument-retrieval.json` for exact snapshot
IDs, bytes, hashes, prior failed attempts and identity findings. Large raw files
are private storage objects, not Git assets. The development source dashboard
shows safe metadata only, never private object keys or customer documents.

## Verification

Executed results are retained in
`docs/valo/evidence/coordinating-execution-checks.json`. These are engineering
checks, not the separate formal 80-rule / 60-customer-AI / 60-editorial suites.
Those suites remain unexecuted. Staff MFA, managed signed-in browser journeys,
source-to-AI drafting and independent checks, payments, email, deployed-worker
access and isolated restore still require actual proof.

## Repository and release boundaries

**Historical visibility incident, not current repository status.** The repository
was subsequently made private and application source was synchronized through
the existing feature branch and draft PR2. See
[current security checkpoint](security-checkpoint.md). This historical finding
and the original restraint on writes are retained:

The then-current authorised exact-name check returned an existing public repository,
despite the coordinating report that none was created. The owner subsequently
confirmed it is the intended repository. This resolves product identity only;
creation history, private visibility, uploads, CI and protection are separate
facts. No repository mutation or source upload was performed in this increment
while visibility was public. The visibility decision is tracked separately.

P0/G0 is not accepted; R1 is not accepted, R2 remains locked and R3 is excluded.
Public launch, live payments, recurring billing, real confidential data, paid
upgrades and new hosting commitments remain disabled. Proposed retention periods
are not enacted statutory or product promises. The known partially failing
development schema operation remains a migration blocker, not a successful
production migration.
