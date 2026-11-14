# Development customer trust-boundary checkpoint

These are fixes for independently reported development-code findings, **not
evidence that a deployed exploit occurred**. No public launch, live payments,
confidential data, repository visibility change or paid upgrade is authorised.

## Implemented controls

- Mutation origin is compared to one server-configured **exact origin**, including
  scheme and port. Request `Host`, `Forwarded`, `X-Forwarded-Host` and
  `X-Forwarded-Proto` cannot establish that identity. Clerk proxy URLs use the
  same configuration. Development derives HTTPS origin only from the server's
  `REPLIT_DEV_DOMAIN`; production must explicitly configure `VALO_TRUSTED_ORIGIN`.
  No production URL or approval is invented.
- Profile writes:20/minute and200/UTC day; document creation/revisions:30/minute
  and600/UTC day; support/enquiry tickets:3/minute and20/UTC day per verified
  identity. PostgreSQL counts are durable, atomic and committed with successful
  writes. Failed/conflicting writes do not modify saved content.429 responses
  include `Retry-After`, an explicit message and unchanged saved data. Unsaved
  input must remain in the editor; retry does not silently overwrite revisions.
- Resource locks precede a fresh active-membership check inside each write
  transaction. A revocation committed while a request waits prevents its write.
  Shared membership locks then serialize the write against later revocation;
  this is a commit-order guarantee, not a claim that an uncommitted revoke can
  retrospectively cancel a committed write.
- Live catalogue and coverage reads use current immutable eligible published
  versions, freshness, current applicable policy and rights bindings. Counts do
  not come from inventory/targets. Generic operational forms do **not** count as
  checked regulatory coverage. Coverage classification is hash-bound and cannot
  relabel an operational template as a location/industry guidance pack.

## Rights correction

Earlier immutable candidate records quoted generic ChatGPT/OpenAI terms and,
for recorded authoring, the Replit Commercial Agreement. Those quotations did
**not** establish which account contract governs this workspace. Their claimed
clearance cannot be used as current publication evidence.

The new versioned rights-applicability record identifies the actual configured
Replit-managed OpenAI integration, but leaves the account contract and commercial
template-reuse scope **unverified**. No Pro, Enterprise or personal ChatGPT
contract is assumed. A plan/configuration fact was requested without asking for
credentials. The record must bind actual account, integration and provider terms,
passage locators, retrieved text hashes and commercial-use scope before clearance.
The publisher checks those exact applicable passages, not whichever generic
ownership clause happens to be available. Discovery rechecks the binding too.
Preparation fails before further metered AI calls if applicability is unknown.

No customer sales licence, copyright/exclusivity guarantee, non-infringement
assurance or professional review is asserted. Commercial owner acceptance before
sales remains a separate unresolved requirement. Historical model/usage records
and failed publication evidence are retained, not rewritten.

## Current product/configuration facts

- Private `obeidpeter/Valo-Compliance`, existing feature branch and draft PR2;
  no force push or visibility change. GitHub main-protection enforcement remains
  a separate blocked/unproved gate.
- Replit-managed verified customer identity and server OpenAI integration are
  configured. The retained customer browser report passed nine groups and
  checked eight private files. It is not a full recovery/MFA/identity acceptance.
- Three operational candidates were held by actual independent AI reviews.
  No legitimate operational publication or real withdrawal/history drill has
  been achieved. Current eligible content counts remain zero for real reasons,
  not hardcoded public catalogue totals.
- Reminders can be opted into and durably scheduled but email delivery remains
  held without actual configured/delivered-provider proof. Service tickets are
  saved enquiries, not bookings or delivery claims.
- Existing development schema was applied through reviewed SQL and has no
  Drizzle ledger. Fresh CI uses registered migrations. Existing-database
  adoption, production deployment/worker/storage/recovery, privacy/processor
  approvals, independent security, real-user beta and complete R1 content remain
  unaccepted. R2 stays locked.

## Execution evidence

`evidence/customer-security-checkpoint.json` records executed test counts, output
hashes and real development-proxy outcomes. Synthetic nonzero catalogue/coverage
adapter fixtures prove data-dependent behavior only; they are not Nigerian
content, publication evidence or the separate80/60/60 acceptance suites.
Earlier reports keep their original dates/counts; see the current checkpoint
instead of treating a historical failed/blocked setup as current configuration.
