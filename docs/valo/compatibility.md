# Replit compatibility findings — not a production approval

Retrieved platform documentation is preserved under `evidence/platform/` with retrieval metadata. These are platform sources, not evidence for Nigerian legal claims.

| Proof point | Documentation finding | Measured result / disposition |
|---|---|---|
| Next.js versus selected web artifact | The selected bootstrap was adapted to the owner's original Next.js choice, not treated as permission to substitute Vite. | Next.js 15.5.29 strict typechecking, production build and managed proxied development serving passed. Validated artifact configuration now uses a Node server. No production launch or worker compatibility is inferred. |
| Separate background workers | Reserved VM supports persistent tasks and worker configuration; autoscale is request-driven. | No worker deployment started; no hosting commitment authorised. Production access to queue DB and private storage is unmeasured. |
| Production schema publishing | Tables, indexes, constraints and RLS policies are carried by publishing; unsupported objects require separate treatment. | pg-boss objects, functions, triggers, roles and grants must be inventoried and migration-tested. Build/start must not mutate production schema. |
| Private storage | Files are project-scoped, not automatically tenant-scoped. | Development private SDK storage, tenant-scoped exports and negative retrieval checks were executed; the verified-account browser report checked eight private files. Separate production worker/storage access and backup remain unproved. |
| Recovery | Platform recovery facilities and retention do not establish a 35-day joint database/object backup. | Gate blocked pending an authorised retained-backup design and destructive-in-isolated-target restore exercise. No retention claim. |
| Clerk | Replit-managed status confirmed; dashboard access authorized. Server rechecks supported provider sessions and verified primary email. | Actual verified-account/profile and four customer-document browser workflows passed in the retained nine-group report. Current transactional membership revocation races passed. Recovery, privileged MFA and independent identity assessment are not inferred from those results. |
| Chromium | Development uses real controlled Chromium rendering with remote requests blocked. | Real private PDF/DOCX outputs were inspected and the customer browser report checked eight files. Production binaries, resource/load targets and independent renderer assessment remain unproved. |
| Geography | Processor location is an approval prerequisite in the brief. | No real confidential data permitted. No region or processor approval inferred. |

Documentation establishes an option, not measured deployment compatibility. Production publishing is deliberately not attempted because owner approval is absent. P0 is not passed.

## Operational checks still required

1. Confirm actual schema, queue migration and least-privilege worker connectivity in development; preserve scripts and SQL.
2. Prove worker access to private exports with negative tenant tests.
3. Render and reopen both DOCX and PDF for the exact immutable revision; verify disclosure, scope and source-check date.
4. Back up synthetic database and file objects, restore into a clean isolated target and compare hashes/counts. Establish the requested retention separately.
5. Measure process restart/retry/idempotency, concurrency and stale jobs.
6. Recheck current Paystack webhook and verification documentation at implementation time. Merchant mode is not configured; neither timestamped nor legacy signature mode is assumed.
7. Execute the original roadmap's now-imported G0–G5 criteria and obtain their required operational approvals. Receipt is not acceptance.
