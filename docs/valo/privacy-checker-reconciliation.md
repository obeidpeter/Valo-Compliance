# Reconciled private information, checker and erasure work

The normally merged parents are application checkpoint
`198e91003ed17d2ff872fb3938aedb4ff3dd25c6` and incoming development
`a274cb02cbb71c10bcefc84d3d2db773608784de`. No history was replaced or forced.
The information unit was also preserved on a private checkpoint branch before
reconciliation. The existing draft application PR remains the review location.

## Combined behavior

The customer/staff information workflow, private messages and generated typed
contracts were retained alongside the incoming rich checker and authenticated,
bounded erasure/recovery controls. Customer replies remain separate from
verification. Staff inspection includes history/messages and scoped actions;
resolved erasure holds can advertise the actual implemented release operation.

Sealed inventories and authenticated cleanup were not replaced with the older
unbounded replay path. The new privacy-message section is included in bounded
erasure. Cleanup fixtures remove the sealed tombstone before its protected
inventory. Both information transitions and held-erasure transitions survive.

Migration numbers collided between concurrent branches. Incoming hardening
remains **0022**; the unchanged information SQL is now **0023**. The earlier
0022 information execution receipt is retained as historical evidence from
before the collision. Its bytes/hash are unchanged. Reviewed hardening 0022
was applied only in development, SHA-256
`8766ba62ee2065953ff62ba68cece0e914b2de6d17ab4dac728551f4b7b9052e`.
Canonical OpenAPI was regenerated after merging both sets of schemas.

## Executed combined checks

| Group | Result |
|---|---|
| Development database | 103 passed, zero failed/skipped |
| Engineering/traceability | 174 passed, zero failed/skipped |
| Rich checker | 26 passed, zero failed/skipped |
| Runtime/account boundaries | 45 passed, zero failed/skipped |
| Erasure signature/lock controls | 10 passed, zero failed/skipped |
| Erasure database/kill/recovery | 16 passed, zero failed/skipped |
| Workspace typecheck | Passed |

Groups overlap and must not be added as independent acceptance cases. The
checker group is runtime/semantic evidence, **not the source-backed 80-case
acceptance or eligibility to publish real rules**. No new paid model call,
email, merchant action or content release ran.

The first combined kill run did not reach upload acceptance. Its queue fixture
could be consumed by the always-on development dispatcher before the child
claimed it. The subprocess fixture now uses a saved-revision-bound, legitimate
retry state that dispatcher does not consume; it still runs unmodified
`executeExport`, reaches the actual controlled upload-accepted barrier, is
SIGKILLed and proves later authenticated cleanup. Customer queue creation has
separate tests. Original failure output is retained; no gate was waived.

## Outstanding, not owner-configuration excuses

Large resumable exports, complete independent post-cutoff journal
backup/import, external privacy fulfilment, merchant dispute submission and
decisions, finite inference work binding/liability reconciliation, eligible
content and complete formal acceptance remain incomplete. The merged rich
checker does not create an eligible rule or a nationwide-completeness claim.
Production recovery/geography/retention and sensitive operational approvals
remain separate. R1/R2 are unaccepted; live operation and new spending stay off.
