# Shared finite-roster preparation checkpoint

Preparation only. No new inference, message, PSP operation, owner approval,
quota increase, public release or production operation.

## Fixed integration gap

Previously the decision packet accepted publication pairs only. Customer
preparation created a separate package, so the two actual supported workloads
were not one reviewable roster under one parent identity.

`--prepare-selection CASE [--with-schema-retry]` now prepares operational pairs
and the supported authored customer case under one exact package. Publication
pairs retain their distinct factual/challenge requests. A customer case is not
an independent pair: its optional second work item is a separately bound schema
retry. The version-2 projection reports those distinctions and lane totals.

Selection/admission requires the exact candidate UUID or `customer:CASE`.
It never silently chooses a first proposal. Retry lineage, identical retry
context, role, source/case bindings, shared package, hashes, expiry and total
cost are checked. Parent approval is still a durable separately validated record,
not a caller-supplied flag or package hash.

`--package=finite-package:HASH` can refresh supported preparation only after
loading and validating that existing parent's real approval and expiry. It
cannot manufacture authority. Old publication-only version-1 projections remain
unchanged; retained bytes and the old canonical packet hash were checked.

## Exact saved selection

| Field | Value |
|---|---|
| Shared package | `finite-package:ca5893a81880e75729dc303c9acea474c844161318ea9a8ec15b2b72a8eba977` |
| Private report ID | `5429e77d-126b-44c9-a9eb-185750ef12bc` |
| Report SHA-256 | `2dc1a7fa39da2c42bbbfc1918d796b7c4a862c767ce0f223d616d738e9048cf8` |
| Canonical decision-packet hash | `74122e5677bf50148f9883d4f2aa67204555accace5fd0f6aa0a484b2129521b` |
| Earliest expiry | 15 November 2026, 09:19:36.082 UTC |
| Manifests / attempts | 12 / 24 |
| Publication review attempts | 22: eleven factual/challenge pairs |
| Customer attempts | 2: `customer:CAI-CAND-INV-01:1` and `customer:CAI-CAND-INV-01:2` |
| Editorial evaluation / checker challenge attempts | 0 / 0; unsupported preparation remains held |
| Worst-case selected reservation | $8.8932096 pre-tax, including the proposed 10% uplift |
| Shared proposed allocation | $30 pre-tax additional-new; disabled and uninitialized |
| Owner approved / enabled / authorizes dispatch | false / false / false |

The private report contains each exact complete request, immutable manifest
artifact/hash, source-file hash, candidate/case version and work identifier.
It is retained locally as
`generated-artifacts/valo-completion/finite-inference-proposal-ef2e12ca-1248-461a-a320-9835750a1e0c.json`
and in the hash-verified private artifact above.

Actual operational versions selected, each with exactly two review attempts:

| Template | Candidate UUID | Version |
|---|---|---:|
| TPL-01 | `707d2f7b-f531-45ef-a740-823646625d22` | 1 |
| TPL-02 | `f036eb6f-abfd-4a7b-88a7-5ea91a8c3ce2` | 1 |
| TPL-03 | `23df1e54-2edb-4a14-94da-25125eec4e90` | 1 |
| TPL-04 | `09574528-09d7-4e54-8e2d-e772563a160e` | 1 |
| TPL-05 | `41097fa0-c830-4b3d-905e-51b5884fece7` | 1 |
| TPL-06 | `23bc7308-a20b-4860-9d9d-32721869ce35` | 1 |
| TPL-07 | `09349379-db29-44f1-bd24-a17f2d86eb74` | 10 |
| TPL-08 | `89d0f3da-ca2b-4917-b88e-763f720695bd` | 1 |
| TPL-09 | `b4e9df41-8bfb-4f62-91cb-2303bc491a0f` | 1 |
| TPL-10 | `65f7a481-4b8d-4353-8495-19fdbaf6d311` | 1 |
| TPL-11 | `c8e2dddb-afb2-4214-b558-e86a5e8fe88f` | 1 |

These are mechanically prepared candidates awaiting genuine independent reviews,
not eligible published templates. CAI-CAND-INV-01 remains an unexecuted authored
customer case. No missing quotation facts or original oracle were changed.

The parent package retains the original lane ceilings 216/68/80/94 and frozen
scope. This selection does not imply that the complete original roster has an
executable preparer or can finish under the fallback ceiling. New editorial
authoring is excluded. Per-attempt reservation is conservatively $0.3705504:
400,000 full-context input tokens plus 8,192 completion tokens, including 10%
uplift. Smaller tokenization bounds are not assumed.

Concurrency stays two, one completion per attempt, no tools or automatic SDK
retries. Existing daily/identity/provider limits remain unchanged and can stop an
incomplete selection. There is no promise all 24 attempts run before this expiry.
Every further attempt needs its own permitted work and reservation; unknown
outcomes retain liability. A new hold stops subsequent already-reserved work.

## Executed evidence

- **60 offline finite-budget controls passed**, including actual case-bound
  mixed projection, explicit retry handling, tamper/role/source/request failures,
  exact case selection, package mismatch and invalid authority/quota options.
  This is an engineering suite, not either formal 60-case evaluation.
- API TypeScript passed.
- Actual private report verification passed: **24 work items / 12 manifests**,
  exact packet hash above, zero provider calls, no approvals written,
  `authorizesDispatch:false`. A prior background verification was lost when the
  workspace restarted; it was not counted as passed. The foreground rerun passed.
- Two concurrent actual CLI customer admissions both stopped at
  `ALLOCATION_PACKAGE_NOT_AUTHORIZED`. Before/after batch and approval snapshots
  and both accounting fingerprints were unchanged; additional-new still has
  zero records. These are authorization controls, not model generations.
- The retained old publication-only report's SHA-256 and canonical projection
  were checked unchanged: packet
  `af1cbb248dad4d21c590129e549b87c19cee143c6ed14458d36bba724cdfb828`.
  This does not renew old freshness or approve expired work.

Retained output: `generated-artifacts/valo-completion/shared-finite-roster/`.
Some initial `/tmp` output was lost with the workspace restart; no replacement
stdout or provider receipt was fabricated. The original private report survived,
and the admission comparison used fresh durable before/after snapshots.

## Historical accounting and limits

The read-only historical ledger remains version 9, fingerprint
`c07bf75aaa2a4ac75de022025411c98877d44a23bbc9674d45de99b2359be29d`:
57 records = 48 reported-usage, six evidenced no-outbound and three unresolved
potential-charge records. Known recorded estimates total $0.2341911, not a
verified bill. Unknown old gpt-5-mini costs are neither zeroed nor silently
charged to this separately proposed additional allocation. No owner-approved
global project budget is inferred.

The additional-new fingerprint remains
`862c5a4daa20b04c1a52f0fc4d51f711f2d2df171e462b75b05611d70679aa96`.
Its $30 policy-default capacity is not approval or a funded balance. Independent
review and actual owner authorization remain pending. Expiry requires fresh
preparation/verification, never elapsed-time approval.
The ceiling covers this named additional text-inference scope, not unrelated
account usage, taxes or development/hosting costs.

The separate checker agent owns questionnaire/review/results/history and its
rich-facts release adapter. This checkpoint changes none of those files.
Privacy/receipt/dispute/export fixes remain queued here; no main merge or public
publishing occurred. Full R1/R2 and formal 80/60/60 acceptance remain incomplete.
