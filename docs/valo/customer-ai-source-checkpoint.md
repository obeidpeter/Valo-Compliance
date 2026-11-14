# Customer-AI instructions, saved revisions and private exports

This is further **partial implementation**, not acceptance of R1, R2, a publication manifest, or the required sixty-case customer-AI suite.

## Working changes

- An optional, bounded drafting instruction is separate from business notes. It is redacted, checked for unsupported/injected requests, and cannot populate missing names, dates or financial facts. It never becomes document body text. The combined selected-note/instruction allowance remains 20,000 characters; daily limits remain 30 reserved requests per workspace and 120 globally.
- The private composer now preserves unticked notes in a manual draft, matching its stated privacy behavior. Unticked notes are explicitly excluded from the AI request and preview.
- Two exact supplied cases ran through the real application services: `CAI-CAND-INV-01` and `CAI-CAND-QUO-01`. The invoice has an actual provider response and usage receipt. The quotation asks for its absent issue date without making an AI call. Neither infers tax treatment or delivery.
- Both cases were accepted into private documents, edited, reloaded and checked against immutable earlier revisions. Four private DOCX/PDF exports were retrieved through the authorised download service and inspected using actual document/PDF readers.

## Actual results

| Check | Retained result |
| --- | --- |
| API unit/contract/render tests | 115 total: 114 passed, zero failed, one skipped |
| Database integration tests | 58 passed at the preceding service revision; subsequent changes are client note selection and reader checks, not persistence behavior |
| Supplied source cases | Two executed, two passed; **not sixty** |
| Actual provider invocation | One retained invoice invocation; quotation preflight zero |
| Successful rerun | Both exact previews reused; zero additional model calls |
| Private downloaded artifacts | Two DOCX and two PDF; no repeated same-version exports |
| Public eligible templates / guidance / rules | 0 / 0 / 0 |

The first source-case run failed the reader comparison and is preserved in `evidence/customer-ai-source-pilot-initial-failure.json`. Poppler joined the visually separated “Business A” in extraction. The actual Word text and a rasterized invoice PDF were inspected before correcting the comparison. The revised check ignores only extraction whitespace and still rejects changed party letters, amounts or currency. **No renderer, candidate content, publication check or quota was weakened.**

Primary receipts:

- `evidence/customer-instruction-checkpoint.json`
- `evidence/customer-ai-source-pilot.json`
- `evidence/customer-instruction-api-tests.txt`
- `evidence/customer-instruction-db-tests.txt`

These are synthetic development cases through server services below HTTP identity/rate middleware, not a new browser identity test or real-user beta. The newly changed signed-in composer was type/code checked, not browser-verified. Microsoft Word UI compatibility remains unverified. Provider billing remains unknown, not zero.

## Still required

The complete source-backed 80-rule, 60-customer-AI and 60-editorial acceptance packages remain unaccepted. Published content floors and full catalogue/editor/customer journeys remain incomplete. R2 prerequisites have not passed.

Editorial reservations remain a real limit, not a global provider outage; no alternate lane or higher cap was used. Expiring review plans must be refreshed and revalidated before execution. The connected Resend key is sending-only, not missing; an approved sender, selected verified test recipient and actual acceptance/delivery proof remain necessary. Automatic dispatch is separately off so merely supplying addresses cannot release an old backlog.

Real merchant sandbox execution, commercial decisions, independent security/privacy and beta work, production-shaped migration/recovery, broader accessibility/mobile checks and remaining implementation are still outstanding. These are not all external credential blockers. Public launch, live payments and confidential real customer data remain disabled.
