# Recorded-payment reminder customer slice

The supplied content merge `f9085f8d44f779bbee3b7ab75bd5a19c1996c8bc` was already an ancestor of the local development branch. Fetch/normal merge reported “Already up to date”; neither history nor the supplied candidate files was overwritten.

## Working behavior

- Reminders can retain an **original payment deadline before the reminder date**. Invoice, quotation and proposal date-order checks remain enforced.
- Customers can enter an original invoice amount and up to 40 individually referenced payment records, or retain the existing manual amount-only mode.
- Browser and server calculate the outstanding amount using integer kobo. Duplicate reference aliases are rejected rather than deducted twice. Negative recorded balances produce **zero due plus an excess to reconcile**, not a negative demand or automatic refund.
- The original values/references persist in the private canonical document and its immutable revisions; edited totals must match the structured model.
- Zero-balance records are titled “Payment record enquiry” and stop at reconciliation preflight. Missing dates remain missing; no overdue status, statutory consequence or deadline is invented.
- Financial records are excluded from the provider payload; references are also redacted when repeated in selected notes.
- The independent manual editor needs no AI consent or provider call. Labelled controls, errors and keyboard focus were checked across 360, 390, 768 and 1280 pixel widths.

## Actual executed evidence

| Check | Observed result | Retained evidence |
|---|---|---|
| API/domain suite | 65 passed; one opt-in parser-process skip | `evidence/reminder-api-tests.txt` |
| New reminder scenarios and guards | 11 passed, included in the API count | `src/lib/valo-reminder.test.ts` in the API artifact |
| Database integration suite | 49 passed | `evidence/reminder-db-tests.txt` |
| Foundation suite | 166 passed | `evidence/reminder-foundation-tests.txt` |
| Workspace type checking and OpenAPI generation | Passed | Executed locally; generated schemas/types committed |
| Supplied REM-01–04 service journeys | 4 passed; two genuine provider responses, two intentional preflight stops | `evidence/reminder-candidate-evaluation.json` |
| Private exports | Eight real worker-generated DOCX/PDF assets, checksum checked and foreign-tenant retrieval rejected | Same evaluation report |
| File parsing | DOCX ZIP/XML parsed; PDF text and each page's A4 geometry checked with Poppler; amounts and payment references found | Same evaluation report |
| Managed identity and customer UI | Two selected browser groups passed, including manual save, reload, arithmetic/error states and keyboard/mobile checks; cleanup errors zero | `evidence/reminder-browser-journey.json` |

The genuine AI responses were obtained during the first execution. A downstream PDF-reader harness failure did not invalidate those model inputs/results: reruns verified corpus, prompt/notice and provider-payload hashes and reused their idempotent records. The successful rerun made **zero new provider calls**; the report separately retains the two actual attempts. Provider usage/quota records and the synthetic service-workspace revisions/assets were retained.

Initial failures are preserved separately. They include an unavailable Python PDF module (replaced by existing `pdfinfo`/`pdftotext`), a radio-control test action, focus styling and a browser-evaluation harness error. The final focus check uses Playwright's actual CSS matcher, not a function serialized as a string. The unlayered input focus rule was corrected without weakening the assertion.

DOCX structure parsing is not a claim of manual Microsoft Word compatibility testing. The browser run used a real managed development identity, not actual verification-email delivery. Its selected reminder subset used no intercepted publication fixtures.

## Reproduce

```sh
pnpm --filter @workspace/api-server test:valo
VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-db
NODE_ENV=development VALO_RUN_REMINDER_EVAL=synthetic-development-only \
  pnpm --filter @workspace/api-server exec tsx src/scripts/reminder-evaluation.ts
NODE_ENV=development VALO_RUN_CUSTOMER_JOURNEY=synthetic-development-only \
  VALO_CUSTOMER_JOURNEY_SELECTION=reminder \
  pnpm --filter @workspace/api-server exec tsx src/scripts/customer-experience-journey.ts
```

A fresh service evaluation can incur two provider calls within existing development ceilings. Resuming the retained initial run uses `VALO_REMINDER_RESUME=1`; mismatched inputs/configuration are rejected. The real development export worker must be running; no queue/provider success is simulated.

## Unmet scope remains

This executes **four supplied customer-AI cases**, not the complete new 60-case corpus. It does not turn the four checker source families into released rules or geographic completeness, publish the candidate forms/guides/packs, complete the editorial suite, implement missing commerce, or accept R1/R2. Source/rights/publication, merchant/email setup, privacy/security/recovery/beta and commercial release gates remain distinct. Public launch, live payments, recurring billing and confidential real data remain disabled.
