# Releasing the invoice and quotation guides in development

The two articles come from `docs/content-candidates/practical-guide-candidates.md`. The invoice is `GUIDE-C01` and the quotation is `GUIDE-C02`. Each has a stable URL under `/resources`. The matching invoice and quotation templates have their own versions, permissions and reviews. Article preparation does not release a template. [Practical business guide policy](policies/practical-business-guides.md)

## Prepare the database

Use the existing development database. The article IDs fit the existing text columns. The required schema ends at `20261121190325_publisher_login`. An installation already at that revision needs no schema change for these articles.

For an unjournalled development database at `0034_runtime_identity`, verify the target identity and file hashes against the release commit. Pause writes, the worker and editorial commands. Take a fresh encrypted backup of the database and private files, retain the current privacy journal independently, and restore into an isolated development target. Record the existing counts, preservation fingerprints, cluster role attributes, memberships and runtime pins before proceeding. See the [migration and rollback procedure](phase1-migration-plan.md).

Apply only the confirmed pending files in journal order, in the transactions and with the lock limits specified by the individual runbooks. Check each file’s postconditions before the next. Keep the unjournalled database’s ledger as found.

| Order | Migration | Runbook |
| --- | --- | --- |
| 1–2 | `0035_saved_templates`, `0036_audit_append_only` | [Saved templates and audit](migrations-0035-0036.md) |
| 3–4 | `0037_source_correction_controls`, `0038_editorial_lifecycle_integrity` | [Source controls and editorial lifecycle](migrations-0037-0038.md) |
| 5 | `0039_support_lifecycle` | [Support backfill and exclusions](migration-0039.md) |
| 6 | `20261117112017_constraint_names` | [Constraint names](migration-constraint-names.md) |
| 7 | `20261117125444_workspace_row_security` | [Workspace role and application login](migration-workspace-row-security.md) |
| 8 | `20261118002215_security_signals` | [Security signals](migration-security-signals.md) |
| 9 | `20261118013843_price_change_log` | [Price history and opening rows](migration-price-change-log.md) |
| 10 | `20261120002839_prepared_candidates` | [Prepared candidate index and grants](migration-prepared-candidates.md) |
| 11 | `20261121190325_publisher_login` | [Publisher login and trigger](migration-publisher-login.md) |

Provision the workspace login for the API and worker and the separate publisher login for the publishing command. Use the two login runbooks to verify their privileges. Compare the support and price backfills with the paused preflight, confirm financial records, retention deadlines and privacy controls, and run the signed-in workspace and public catalogue smoke tests. An interrupted file rolls back in its own transaction. If a committed change requires recovery, keep writes paused, use the verified pre-change restore, replay the latest independent privacy journal, and recheck the release pin, role grants and preservation fingerprints before reopening development. PostgreSQL database dumps exclude cluster roles. Reconcile any new login or membership with the pre-change record before directing traffic to the restored database.

## Prepare the two review pairs

Run the commands in `artifacts/api-server` with `NODE_ENV=development`, the development database and private storage configured. Keep the terms, artifacts and executor reports in private storage. Example shell variables below refer to files or artifact identifiers on that host.

```sh
pnpm exec tsx src/scripts/capture-provider-terms.ts "$TERMS_PATH"
pnpm exec tsx src/scripts/finite-inference-run.ts --prepare-practical-guide-candidate GUIDE-C01 "$TERMS_PATH"
pnpm exec tsx src/scripts/finite-inference-run.ts --prepare-practical-guide-candidate GUIDE-C02 "$TERMS_PATH"
pnpm exec tsx src/scripts/finite-inference-run.ts --prepare new --practical-guide-pairs \
  "--candidate=$INVOICE_ARTIFACT_ID:$INVOICE_ARTIFACT_HASH" \
  "--candidate=$QUOTATION_ARTIFACT_ID:$QUOTATION_ARTIFACT_HASH"
pnpm exec tsx src/scripts/finite-inference-run.ts --verify-prepared "$REPORT_ARTIFACT_ID" "$REPORT_ARTIFACT_HASH"
```

Both candidates should say `awaiting_reviews`. Check that the private report contains two prepared pairs and zero holds. The file and section hashes, original prose, provider permission, worked examples and exported DOCX and PDF must pass for the same article. A newer edit requires fresh evidence. The checks use a provider-terms capture less than 24 hours old at preparation.

### Prepare the payment reminder and inventory register

Use the same capture and candidate commands with `GUIDE-C03` and `GUIDE-C04`. Supply those two new artifact references to `--prepare new --reminder-inventory-pairs`, then run `--verify-prepared` with the returned report ID and hash. Confirm both pairs are ready and the report has zero holds. Present the new package and its maximum reservation to the owner before recording an approval or admitting work. The invoice and quotation package has a different identity. The [22 November development publication decision](policies/practical-reminder-inventory-release.md) covers version 1 of each new article when both of its reviews pass. After publication, check the Guides index and open `/resources/follow-up-an-unpaid-invoice` and `/resources/keep-an-inventory-register`.

## Review and publish

Take the exact `package` object and package ID from the verified private report to the owner. The two pairs allow four provider calls, with a combined maximum reservation of **USD 1.4822016** under the versioned rate calculation, including its 10% uplift. Each call can reserve up to USD 0.3705504. The existing allocation’s shared ceiling also applies. Changed pricing, an expired approval or an unresolved hold requires a new decision before dispatch. Preparing and verifying the packet makes zero provider calls.

After written spending approval, record the exact package with `finite-allocation-approval.ts approve` as documented in that command. Use `finite-inference-run.ts --admit <report-artifact-id> <report-artifact-hash> <candidate-version-id>` for each article, then `--execute <admitted-batch-id>`. Pass the complete run report to `publish-reviewed-pair.ts <batch-id> <result-artifact-id> <result-artifact-hash>` from the dedicated publisher process. The publisher checks separate settled responses, candidate identity, current permission, policy, expiry and export bytes.

Read `/api/public/resources`, open `/resources/prepare-an-invoice` and `/resources/write-a-quotation`, and check that each checklist and example matches the reviewed article. Held or withdrawn versions stay out of the list and return 404 from the detail API.
