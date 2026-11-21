# Dispute customer and finance checkpoint

**R1/R2 remain incomplete and unaccepted.** This application unit follows the
saved transport checkpoint and preserves the normally merged disabled inference
allocation work. It does not enable merchant execution, inference spending,
email dispatch, live payments or launch.

## Implemented behavior

- A verified customer can save explicitly consented, selected-order statements
  against an existing verified test dispute. Email comes from verified identity;
  name, phone, service circumstances and optional delivery facts are supplied
  explicitly. This does not create a bank dispute or independently prove delivery.
- Finance has read-only detail/history plus prepare, cancel, single execute and
  canonical-reconcile controls. Actual finance role and fresh MFA are enforced
  server-side. Bodies cannot supply authority, uploaded filenames or source hashes.
- Intents bind dispute/provider/order/transaction, immutable purchase terms,
  selected statement bytes, policy, decision, amount and an idempotent request.
  Uncertain refunds and other acceptance intents reserve their amounts. A changed
  source or revoked role prevents dispatch.
- Receipt evidence is generated from the actual immutable test purchase. It is
  not a customer document, delivery assertion, bank decision or government tax
  invoice. The provider filename and exact checksum are durable before object PUT;
  no signed URL is retained. No arbitrary customer attachment upload was added.
- Decline uses the acknowledged provider filename. Fraud declines also need acknowledged
  structured evidence. Unverified classifications remain held, not guessed.
  Current official operations, empty successful upload responses and short-lived
  destination validation are covered by the retained transport checks.
- An unknown mutation is never automatically re-sent. A later canonical match
  records the merchant response, source hash and timestamp, not a final bank win.
  Archived/null observations remain ambiguous. Terminal observations do not
  newly suspend access or erase an existing refund/dispute hold.
- Database uniqueness, one-attempt limits and immutable transition history cover
  duplicate clicks and racing requests. Privacy fencing blocks new evidence
  sharing; resumable erasure cancels only provably unsent intents. Unknown
  liabilities and financial evidence/history remain explicitly retained pending
  policy/hold review, not falsely declared erased from Valo or the provider.
- Customer/finance forms preserve unsaved input on refresh and use one navigation
  guard per page, with uniquely labelled native dialogs. Account-boundary reset
  remains separate from ordinary same-account navigation protection.

## Executed evidence

See [exact results and limitations](evidence/dispute-actions-development.json),
[native dispute run](evidence/dispute-actions-development.txt),
[HTTP/transport run](evidence/dispute-http-current.txt),
[customer/privacy regression](evidence/dispute-privacy-regression.txt),
[refund regression](evidence/dispute-refund-current.txt) and
[typecheck](evidence/dispute-actions-types.txt).

Counts overlap; do not add them or call them formal 80/60/60 acceptance.
The native dispute checks use real PostgreSQL, local HTTP and real Chromium PDF
rendering with `pdftotext` reading, but controlled PSP responses and controlled
staff-session resolution. The new signed-in pages still need genuine browser/MFA
journey review. Source passages/hashes are retained in
[current official technical retrieval](evidence/paystack-dispute-source-retrieval.json).

Only additive development SQL 0025/0026 was applied. No production migration or
existing-database baseline adoption was claimed. SQL 0024 remains available for
the separately saved large-export unit. The normal reconciliation with shared
head `7b6a356` incorporated its `7c3ec83` ancestry, shared DB-free dispute schema,
terminal-state regression and updated preparation/editorial work. The present
dispute checkpoint does not replace that unit's independent review or evidence.

## Remaining boundaries

Real provider execution requires the actual test merchant configuration, its
explicitly configured signing mode, sandbox checkout guard and the separate
default-off `VALO_SANDBOX_DISPUTES_ENABLED` switch. A genuine authorized test
dispute and selected records are also required. Its availability is unverified,
not proven unsupported. Merely setting a credential does not authorize action.
No undocumented final bank-outcome mapping or unsafe automatic retry was added.

The full source-backed/customer-AI/editorial acceptance, eligible publication,
remaining privacy/export work and gated R2 are not completed by this checkpoint.
The 35-day recovery target, production compatibility and sensitive operational,
commercial and processor decisions remain separate. See earlier reports as
historical evidence rather than current all-product completion claims.
