# Private-copy erasure and scoped export checkpoint

## Saved source and boundaries

- Application change: `2eb03d03d7b4e46c6d8bbde1c5a28dd07eaf9e23`.
- CI/scan follow-up: `453969be7f02d10a0e4342b87be1192b24cbc6a0`.
- Orphan/legacy queue ownership follow-up: `37ebcc9e51f6b0bda753d0e76d633c1375a51782`.
- All were normally pushed to the existing private development branch/PR2.
- No owner content, shared editorial masters, genuine usage ledger or external
  processor record was deleted. Verification used new synthetic workspaces.
- No AI call, email, actual merchant operation, paid upgrade, public publishing
  or owner spending/production approval occurred.

## Implemented application behavior

New synthetic erasure uses a signed v3 scope. Existing v2 journals retain their
original phase ordering; a signed old replay cursor is not reinterpreted as new
deletion authority.

The access fence removes matching durable export payloads and stops local
pending refund/dispute work without claiming an accepted provider action was
cancelled. Uncertain dispute work remains uncertain and fenced.
Orphan payloads and older payloads without a workspace field are found through
their remaining trustworthy ownership link. Contradictory ownership produces
a tested 409 hold and no queue deletion. Missing queue installation reports an
explicit prerequisite rather than being called successful cleanup.

Existing deletion phases remove historical profiles, document revisions,
assessment snapshots, tasks/notes, reminders, AI previews/plans and accepted
document copies. New phases minimise requester/checkout fields, refund reasons,
dispute information/payloads/results, linked payment-event failures, reconciliation
text, workspace activity and privacy-audit reasons. Financial amounts, references,
licence facts and necessary status history remain explicitly retained.

Before rows disappear, the signed cleanup inventory retains ready assets,
pending/cleanup reservations, workspace-export aliases and strictly scoped local
scratch locators. Storage failure remains retryable. Repeated replay removes
late scratch writes; private locator ownership is checked before removal.

Privacy and refund audit reasons are replaced by a fixed marker only with an
authenticated, immutable witness of the exact verified original and redacted
projection. The witness contains no removed plaintext. Original chain hashes
are preserved, not silently recomputed with invented history. Current keys sign;
historical keys verify; absent historical verification material holds processing.
An existing witness can be reused only for the exact restored original.

Workspace exports now include scoped refund/dispute history, linked charge,
refund and dispute event metadata, and privacy-case/result metadata. Corrected
profiles remain in their real profile versions. Previous full prepared snapshots
are not recursively nested. All paged sections use the existing fixed-snapshot,
current-authorization and durable private-result path. No public support record
is included or deleted merely because a contact email matches.

Shared safety, usage, role/staff records and unlinked public intake are not
blanket-deleted. Where historical linkage cannot establish ownership, provenance
review remains necessary. Local cleanup cannot confirm Clerk, AI-processor,
Paystack or backup deletion.

## Executed checks

| Selected group | Passing tests |
|---|---:|
| New private-copy inventory and scoped-export integration | 4 |
| Physical erasure, actual queue payloads, native storage, process death and replay | 16 |
| Privacy key-version rotation/held-history controls | 6 |
| Controlled native merchant-dispute intents | 12 |
| Durable workspace export / HTTP disconnect / process death | 10 |
| Erasure seal and privacy-state controls | 9 |
| SQL migration journal registration | 1 |
| Complete source traceability/UAT/gate preservation | 11 |
| Exact historical scan dispositions and CI prerequisites | 3 |
| Controlled provider/real HTTP signature/durability tests | 18 |
| **Total selected engineering tests** | **90** |

The logs overlap where an earlier cohort was rerun. Do not sum every log:
the final 16-test queue/erasure run supersedes the earlier 11-test run and adds
five hardening/recovery checks. The table counts each selected test once.

Commands used the existing `node --import tsx --test` runners, development
synthetic flags, `test:valo-disputes`, workspace `typecheck`, and API `build`.
The three disposition tests also verify workflow ordering. Native dispute and
HTTP tests use controlled merchant transports, not actual PSP execution.

The export regression completed **5,001 source rows / 11,797,972 bytes**, exercised
actual HTTP disconnect and SIGKILL, and measured a 3 ms membership-revocation
commit. Its managed-session reader was controlled; this is not new genuine
Clerk revocation evidence or production performance/RPO/RTO.

The public Valo homepage loaded after API/worker restart. This checkpoint did
not browser-verify signed-in privacy screens. Development HMR/Clerk warnings
were observed; no accessibility or real-user acceptance is inferred.

## Migration evidence and a genuine operational gap

Reviewed migration `0029_privacy_copy_redaction.sql` passed an isolated,
rolled-back DDL/immutability exercise. Applying it through a normal-predecessor
guard correctly refused: the development Drizzle journal contains **zero rows**
despite installed application tables.

A separate explicitly named development-only action then checked the existing
required objects and applied **only 0029**, changing no existing customer row.
It wrote no fabricated legacy migration records. The result is recorded in the
development operation receipt; the complete historical schema-adoption problem
remains unresolved. This is not production migration proof.

## Actual scan/CI outcomes

The first CI run at `2eb03d0` failed:

1. A database-backed HTTP test was in a job without a database.
2. Queue-payload/erasure tests preceded pg-boss schema installation.
3. The secret scan reported three immutable evidence-map source digests.

`453969b` moves the HTTP test into the real synthetic PostgreSQL job and installs
the reviewed queue before dependent tests. The queue operator now requires the
central explicit-development/no-deployment guard.

All three reported historical values were recomputed from the exact named
source files at their commits. Only those commit/file/rule/line fingerprints
were added to the existing ignore list. Runtime proof rechecks each binding;
no rule-wide, file-wide or future-commit exemption was introduced.

The subsequent **local** scan passed: dependency counts critical/high/moderate/
low all zero; remaining secret findings zero. The generated vulnerable-lock and
secret detector canaries were detected. Raw secrets were not retained.
These are scanner results, not independent security acceptance. GitHub runs for
the follow-up were not yet verified green when this document was prepared.

## Remaining implementation versus external decisions

**Still implementation/verification work, not credential excuses**

- Import and physically replay independently preserved deletion controls,
  including inventories and redaction witnesses, into an older isolated
  database/object snapshot. Current recovery controls explicitly report
  access quarantine with physical purge pending.
- Reconcile measured legacy schema state with journalled history without
  inventing executions; prove the eventual deployment/rollback path.
- Extend copy coverage fixtures across larger/more varied histories and
  independently review remaining unlinked staff/audit provenance.
- Finish outstanding R1 software/evidence and original formal source-rule,
  customer-AI and editorial acceptance. R2 remains gated, not implemented by
  content targets or this checkpoint.

**Owner/provider decisions and outcomes**

- Approved field-level retention/holds and externally verified processor
  deletion/retention/geography outcomes before complete fulfilment/live data.
- A supported 35-day recovery design and actual production recovery evidence.
- Previously documented merchant, sender/owner-recipient, spending and
  production approvals remain separate and disabled.

No full R1/R2 completion, eligible publication, professional review, real bank
outcome or complete account deletion is asserted.
