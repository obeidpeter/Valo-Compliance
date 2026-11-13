# Replit compatibility findings — not a production approval

Retrieved platform documentation is preserved under `evidence/platform/` with retrieval metadata. These are platform sources, not evidence for Nigerian legal claims.

| Proof point | Documentation finding | Measured result / disposition |
|---|---|---|
| Next.js versus selected web artifact | Selected artifact is React/Vite; user prefers Next.js. A Node-capable runtime does not require a Vite UI. | Owner decision requested before substantial frontend implementation. Neither choice is silently accepted. |
| Separate background workers | Reserved VM supports persistent tasks and worker configuration; autoscale is request-driven. | No worker deployment started; no hosting commitment authorised. Production access to queue DB and private storage is unmeasured. |
| Production schema publishing | Tables, indexes, constraints and RLS policies are carried by publishing; unsupported objects require separate treatment. | pg-boss objects, functions, triggers, roles and grants must be inventoried and migration-tested. Build/start must not mutate production schema. |
| Private storage | Files are project-scoped, not automatically tenant-scoped. | Tenant-keyed paths, server authorisation, download isolation, worker access and renderer handling require proof. |
| Recovery | Platform recovery facilities and retention do not establish a 35-day joint database/object backup. | Gate blocked pending an authorised retained-backup design and destructive-in-isolated-target restore exercise. No retention claim. |
| Clerk | Development provisioning succeeded; management dashboard access reported unavailable. | Email verification/recovery still need actual customer-flow tests. Staff MFA policy needs an available managed configuration route; do not emulate local authentication. |
| Chromium | Node deployment support does not establish native Chromium runtime dependencies or isolation. | Need a real render with egress blocked, resource limits and isolated HTML. |
| Geography | Processor location is an approval prerequisite in the brief. | No real confidential data permitted. No region or processor approval inferred. |

Documentation establishes an option, not measured deployment compatibility. Production publishing is deliberately not attempted because owner approval is absent. P0 is not passed.

## Operational checks still required

1. Confirm actual schema, queue migration and least-privilege worker connectivity in development; preserve scripts and SQL.
2. Prove worker access to private exports with negative tenant tests.
3. Render and reopen both DOCX and PDF for the exact immutable revision; verify disclosure, scope and source-check date.
4. Back up synthetic database and file objects, restore into a clean isolated target and compare hashes/counts. Establish the requested retention separately.
5. Measure process restart/retry/idempotency, concurrency and stale jobs.
6. Recheck current Paystack webhook and verification documentation at implementation time. Merchant mode is not configured; neither timestamped nor legacy signature mode is assumed.
7. Obtain original roadmap criteria before declaring any P0–P5 gate accepted.
