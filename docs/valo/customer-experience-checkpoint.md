# Valo customer-experience checkpoint

Development only. R1 and R2 are not accepted. Public launch, live payments and confidential customer data remain disabled.

## Actual behavior

- About, Contact and signed-out account-access help exist. Sign-in, verification and suspended-account error states link to access help rather than demanding verified access to request help.
- Public access-support submissions create durable tickets without querying account existence. Idempotency, a honeypot and transactional minute/day contact, socket and global limits apply. Confirmation explicitly says saved, not emailed.
- Released resources and industry pages read eligible live content. Resource detail renders text, disclosure, scope, limitations and source links, not arbitrary HTML. Guidance catalogue links lead to resources; template links lead to template detail and field-label-only previews.
- Template operations recheck the current publication policy, rights applicability and membership. Published-template counts exclude guidance. **There are still zero genuinely eligible publications**; positive published-master creation/download and actual withdrawal/history preservation are not proved by this checkpoint.
- Private checker, assessment history, tasks, notification preferences, purchases, account and privacy routes are reachable. Checker results still cannot invent Nigerian recommendations without released evidence.
- Account embeds managed identity settings. It explicitly distinguishes deleting an identity account from deleting Valo workspace data.
- Privacy requests are durably saved and visible after reload. They are requests, not completed correction/deletion. A real private JSON download includes the scoped structured workspace records; it excludes file bytes, managed identity/provider-wide data and unlinked public intake. Large exports fail explicitly for assisted handling rather than silently truncating.
- Purchases reports unavailable because settlement/history are not implemented. No fabricated empty transaction history, charged order, receipt or refund is presented.
- Staff screens read content metadata, support queues, finance availability or safety switches. Server-side active area-specific assignments and recent managed MFA are mandatory. Staff reads are audited. There is no self-enrolment, role-grant, payment or publication override UI. No real staff assignment was provisioned.
- The original hero remains exact. Private own-draft exports are distinguished from catalogue masters; library copy no longer requires routine professional review. Developer evidence stays separate from the customer navigation.
- Mobile navigation supports keyboard activation, Escape and focus return. Purchases has a page heading. The development framework control no longer takes the first tab stop.

## Executed proof

Machine-readable results and their hashes are in `evidence/customer-experience-checkpoint.json`; the requirements register binds the saved source revision.

- Full workspace TypeScript check passed.
- Foundation: 166 passed; its 80 engine fixtures are synthetic, not the required source-backed Nigerian rule acceptance suite.
- API units: 38 passed.
- Database regression: 49 runner tests passed, including 10 in the new access/privacy/staff suite (9 leaf cases).
- Publication-boundary regression: 12 passed. This is not the formal 60-case editorial acceptance suite.
- Browser: 9 groups passed. Seven use actual running routes, managed test identity and/or durable PostgreSQL records. Two use explicitly browser-intercepted resource/template fixtures for rendering/link/safety wiring; neither creates a publication nor proves a real master download.
- Browser proof includes actual verification, private page access, saved privacy request/reload, JSON file download, denial of customer staff access, and banning the owned synthetic account before submitting the same public help form successfully.
- Real proxy rejected three public mutations: hostile origin, mismatched scheme and mismatched port, including hostile/multi-hop forwarded headers.
- Chromium desktop and 360px responsive keyboard checks passed. This is not physical iOS/Android testing, assistive-technology review or WCAG certification.
- Initial failed browser checks were retained: framework-control focus and missing purchases heading were corrected before the passing run. Synthetic identities and owned rows were cleaned up; no email delivery was claimed.
- Reviewed additive SQL `0009_customer_access.sql` was applied transactionally to development. This does not adopt a migration ledger for the existing database or prove production migration/recovery.

## Reproduction

Use only the existing development/test identity instance and synthetic data:

```sh
pnpm run typecheck
pnpm --filter @workspace/scripts run test:valo
pnpm --filter @workspace/api-server run test:valo
NODE_ENV=development VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server run test:valo-db
NODE_ENV=development VALO_PUBLICATION_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server run test:valo-publication
NODE_ENV=development VALO_RUN_CUSTOMER_JOURNEY=synthetic-development-only pnpm --filter @workspace/api-server exec tsx src/scripts/customer-experience-journey.ts
```

The browser runner requires the configured development domain, managed test identity and Chromium. It does not require a password or secret to be pasted into chat.

## Still incomplete or dependent

Original-form rights must bind the actual applicable Replit account/integration/provider contract. No plan's commercial-use clause is assumed. Real independent evidence/review/export gates and first eligible release remain required; commercial licence acceptance before sales is separate.

Merchant sandbox configuration and an approved price/refund policy are missing; commerce lifecycle implementation/testing is incomplete independently of those credentials. Transactional-email configuration, delivery evidence and named support routing remain missing. Named staff identity/MFA setup and privileged browser proof are still required. Public intake currently queues for staff, not delivery.

Privacy request fulfilment across all systems, legal holds, backup re-delete, approved retention/processors/geography, production worker/storage compatibility and measured production-shaped recovery remain unproved. Independent security/privacy/usability reviews and the complete 80/60/60 acceptance evidence remain mandatory. No R2 capability is activated through this checkpoint.
