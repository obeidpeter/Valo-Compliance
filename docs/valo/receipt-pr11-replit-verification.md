# PR11: integrated Replit receipt verification

## History and scope

Requested source: `52d81a2459e763df5616ff35bc794461fa35e163`.
GitHub reports PR11 already merged into `feature/valo-p0-foundation` through
`ea73a87001301cd95fa33e232be71abba381bc32`. Git ancestry confirms the exact
requested source is already included in application head
`2488129e098c51302203a1aee2ec1ccc22276fd7`.

No duplicate merge, reset, main-branch merge or application-module replacement
was performed. The tests below exercise that current integrated application,
including later provenance hardening, rather than pretending to be a pristine
checkout of the earlier six-test review workspace.

## Actual execution

Final run: `1525f1cc-b6dc-4625-a8ab-b5da3b1cca67`.
Started **15 November 2026 08:47:22.923 UTC**; completed
**08:47:40.524 UTC**.

| Check | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Safe receipt reporting | 7 | 0 | 0 |
| Actual receipt PostgreSQL integration | 4 | 0 | 0 |
| Commerce regressions | 15 | 0 | 0 |
| Total, including Node suite parents | 26 | 0 | 0 |

`pnpm run typecheck` also passed for shared libraries and every configured
artifact/scripts workspace. The verification harness passed Node syntax checking.

The receipt integration exercises eight concurrent recovery calls with an
existing refund notice and suspended matching grant: one held original receipt,
one recovery audit, unchanged refund notice/order/grant, stable retries,
cross-tenant denial and the recovered original receipt link after reversal.
Reporting checks preserve partial successful observations, unknown repeat-check
outcomes, conflicting results and allowlisted error/provenance classifications
without raw private exception text.

## Isolation and transport boundary

The reproducible harness is
`scripts/src/valo/verify-receipt-integration.mjs`:

```sh
NODE_ENV=development node scripts/src/valo/verify-receipt-integration.mjs
```

It creates a separate local PostgreSQL cluster, applies the tracked migration
journal only there, and verifies the actual database/user/loopback port before
testing. The measured target was
`postgres|valo_receipt_proof|127.0.0.1|43551`. It does not pass the existing
workspace database URL or provider credentials to child commands.

A preload blocks Node HTTP/HTTPS and fetch transport. Its intentional canary
was rejected before transport; all three test phases recorded zero unexpected
outbound attempts. No worker was started for this disposable database.
The local cluster was stopped and its temporary data removed.

Retained logs, migration output, canary, full typecheck and result:
`generated-artifacts/valo-receipt-integration/1525f1cc-b6dc-4625-a8ab-b5da3b1cca67/`.
Result SHA-256:
`6524e1f10b6f7abee44b3cd743502865b799ec12b895061af03ae64915bcce08`.
Harness SHA-256:
`4765835c556ea81d6485480bb61ac623c42d2f3dd8b1884eeeb90cf8d6f61be2`.
An earlier separate successful run is retained, not overwritten.

## Explicit limits

The maintenance command was not invoked against any existing cohort. The 94
historical synthetic orders and their original failure evidence were not changed.
This does not recover the missing original per-order reasons for the first 18
failures or infer them from later aggregate success.

No PSP execution, external receipt email, provider quality evaluation, real
customer deletion, live financial change, new content publication or production
enablement occurred. These are controlled development runtime checks, not
genuine settlement, signed-in browser acceptance or full R1/R2 acceptance.
Checker and erasure/export-cleanup ownership boundaries were preserved.
The finite inference allocation and existing quotas remain disabled/unchanged.
