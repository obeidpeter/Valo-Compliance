# Synthetic privacy integration — executed runtime evidence

## Source and migration

The requested reviewed head `b127edf1451614fa897376b32b1139340d7f7be5`
was already an ancestor of preserved development checkpoint
`7cf9cd22ce59ad605f8f15071148cb2d834a1b9a`. This run used the separate
`verify/pr13-synthetic-7cf9cd2` Git worktree. No duplicate PR merge, reset,
force-push or replacement app was necessary.

The pending SQL was already registered by earlier commit `b77b2b1` as
`0022_privacy_erasure_hardening`, journal index **22**. Its SQL matches the
reviewed pending file after excluding comments. Registered file SHA-256:
`8766ba62ee2065953ff62ba68cece0e914b2de6d17ab4dac728551f4b7b9052e`.
All 29 ordered journal entries were applied to a new disposable loopback
PostgreSQL cluster. Index 22 was not duplicated or reassigned; next unused
journal index is 29. No primary-development or production migration ran.
The actual SQL includes both inventory and tombstone binding guards. This is
not proof that Replit production publishing preserves those functions/triggers.

The combined development source also contains later inventory-cache/cursor
work. Results below apply to **`24e3b3782ff7591d352ffdf2a2df172f3743d778`**,
not a claim that the earlier independent source review approved every later
change. The new runtime correction remains available for independent review.

## Runtime correction

Ordinary document-export orphan cleanup already deferred privacy-owned scopes.
Ordinary **workspace temporary-upload cleanup did not**. It now defers storage
and scratch deletion whenever the workspace has an erasure tombstone. Only
the authenticated erasure path may handle that scope; expiry cannot override
a hold, invalid proof or unavailable key.

Deferred attempts advance their cleanup-check timestamp, so they do not
permanently occupy the front of the bounded cleanup query. The internal result
reports `privacyHeld`. Normal unowned expiry still deletes its controlled
fixture bytes.

The new database regression exercises both ordinary cleanup paths against six
states: incomplete, completed-but-privacy-owned, held, tampered MAC, wrong key,
and missing historical key. Each produced **zero deletion callbacks**, and
the restored private scratch copy remained intact. A separate unowned
positive control cleaned its bytes. Restored document tracking respects real
composite foreign keys; workspace-export tracking metadata is retained rather
than falsely described as removed private bytes.

## Portable process verification

A separate strict development-only test composition implements private-file
operations in a newly created, permission-restricted temporary directory.
Real child worker processes share it. It rejects native configuration,
non-loopback database targets, wrong keys/paths and deployment markers; native
anonymous/workspace-storage operations fail rather than simulate native proof.
The directory is removed after the test.

This exercises actual PostgreSQL, real Chromium PDF generation, actual files
and real worker/process death without bucket credentials. It is **not native
Replit App Storage evidence**. The existing native lane and the native-call
detector remain separate and unchanged.

Routine checks now include the replay-cursor controls and the portable worker
group. Existing lock/seal/cache, portable erasure, HTTP and key-rotation CI
coverage was preserved; key tests were already in the standard database group.

## Executed results

Final isolated run: `09bf6e45-a6ac-4a5d-a5fe-2b8c9ed10b4f`.
15 November 2026, **10:46:17.471–10:47:25.290 UTC**.

| Group | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Credential-free import/native detector | 3 | 0 | 0 |
| Controlled export zero-effects boundary | 1 | 0 | 0 |
| Existing rich-checker focused tests | 26 | 0 | 0 |
| Current-source task database controls | 15 | 0 | 0 |
| Checker HTTP contracts | 5 | 0 | 0 |
| Portable erasure database regressions | 19 | 0 | 1 |
| Privacy HTTP permissions/session/origin | 7 | 0 | 0 |
| Ordered migration journal | 1 | 0 | 0 |
| Erasure locks/seals/cache/cursor controls | 15 | 0 | 0 |
| Historical privacy signing keys | 6 | 0 | 0 |
| Portable export and real worker recovery | 12 | 0 | 0 |
| Workspace-download HTTP regressions | 11 | 0 | 0 |
| **Engineering total** | **121** | **0** | **1** |

Full workspace typecheck passed on that source. Counts include test parents.
The sole skip is the explicit genuine-native-storage lane; portable erasure
was not blanket-skipped. No provider credentials were inherited. The database
was stopped/removed and temporary portable files cleaned.

Bounded replay proved **13 exact objects, 13 delete calls, zero duplicate
deletes, 205 restored profile rows, two killed workers, at most 10 objects
and 100 rows per batch**, with process restart and cached verification instead
of rescanning the full inventory per application page. Other checks cover
tampering before destructive replay, key rotation, holds/revoked permissions
between dispatches, late uploads after tracking removal and killed upload
acknowledgement with automatic controlled reconciliation.

The worker group covers SIGKILL at claiming, claimed, rendering, uploading,
uploaded, completing and completed; bounded retries; stale queued deliveries;
one-winner lease recovery; preserved revisions and a real dispatcher restart.

## Retained failures and boundaries

Earlier failed runs remain under the integration worktree's ignored
`generated-artifacts/valo-ci-portability/`:

- `6291afdb-680b-46e5-b436-f81898ea4a56`: restoration fixture lacked revision
  foreign-key prerequisites.
- `7a8f0405-08d3-4fc2-9557-bd4d15417b42`: fixture incorrectly tried reinserting
  workspace-export tracking rows that were retained.
- `425b1640-b70a-4ceb-addf-25d05a3ea4c4`: restored fixture omitted a local scratch
  copy; its absence was observed, not counted as a negative-cleanup pass.
- `247017f9-c811-4736-9430-f3f23d238759`: worker suite was skipped because its
  explicit crash-test flag was absent; not counted as executed worker proof.
- `92450843-df7c-490a-a2f9-584bd06e94db`: child startup rejected an experimental
  flag in `NODE_OPTIONS`.
- `ba8a739b-5f3e-45bf-bb6b-dafb80c4e5ae`: eight worker tests passed, four failed
  because the portable adapter returned filesystem errors instead of the
  storage contract's missing-file error. The adapter was corrected, not the
  assertions weakened.

No existing owner data, genuine usage ledger, shared source/master or external
provider record was deleted. Tests created only new synthetic fixtures.
Internal maintenance functions were exercised there; no maintenance command
against existing application records ran. No live cleanup setting was enabled.

Native storage, external processor deletion, full account-erasure scope,
independently preserved backup tombstones/35-day retention, production migration
behavior and production recovery remain separate evidence gates. Local results
do not establish production RPO/RTO, a security approval, or R1/R2 acceptance.
The original source oracles, publication holds and disabled spending remain
unchanged. No paid inference, PSP/email execution, public publishing or main
merge occurred.

## Requirement evidence linkage

| IDs | Evidence gained | Not accepted by this run |
|---|---|---|
| PRV-003 / PRO-002 | Synthetic case authority, quarantine, scoped erasure and replay | Full processor/account fulfilment |
| SEC-001 / SEC-006 | Actual HTTP role/session tests; per-dispatch hold and role checks | Independent approval of the new delta |
| EDT-007 / EDT-008 / NFR-009 | Real worker death, private-file recovery, late-upload fencing | Native-store/production guarantees |
| OPS-003 | Actual clean journal execution with database guards | Production publish/bootstrap |
| OPS-008 / NFR-005 | Bounded synthetic replay/restart | Production restore, RPO/RTO or retention |

Compact results: `evidence/pr13-runtime-result.json`. Full logs remain under
`generated-artifacts/valo-pr13-integration/`. Hosted CI results must be reported
separately; earlier GitHub runs were refused before startup.
