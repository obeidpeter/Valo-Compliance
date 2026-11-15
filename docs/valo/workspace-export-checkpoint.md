# Private workspace export checkpoint — development only

The application now retains an authorized export request, bounded attempts and
private complete artifact across application restarts. The customer can retry
an interrupted request, retrieve a prepared result, or discard it. Metadata
requests are small; the browser does not fetch/parse the full export into a Blob.

Preparation streams each named section from a fixed PostgreSQL snapshot with
pagination and complete row counts. Membership reads do not retain a SHARE lock
through preparation. Short metadata writes retain commit-ordered authorization.
Current managed session/user and workspace access are rechecked before release.
Disconnect cancels preparation and removes local scratch before awaiting remote
cleanup. Unknown/late uploads retain durable cleanup reservations. Leases fence
crashed/superseded attempts; an incomplete attempt restarts a **new dated whole
snapshot**, never appends pages from a different snapshot.

Complete JSON artifacts use native private Replit App Storage with streaming
upload/retrieval, checksum readback, expiration, no public URLs, current download
authorization and byte-range retrieval. Artifact keys are reserved before upload,
included in privacy-erasure inventory, and remain available to repeated cleanup.
Privacy fencing stops later publication. Cleanup rotates reservations to avoid
starvation; failure never implies successful deletion.

## Executed evidence

See [machine-readable results and saved source revision](evidence/workspace-export-development.json)
and its retained raw logs:

- New integration: **10 passed, 0 failed**, real PostgreSQL and native private
  App Storage for the full HTTP/restart path; separate controlled failure port.
- Related download/session/customer-access/erasure regressions:
  **43 passed, 0 failed**.
- Browser: **9 controlled checks**, actual component, keyboard/mobile, native
  large attachment, cancellation/unmount/account-change/reload, errors/timeout.
- Workspace typecheck and Next production build passed.
- Recorded complete native result: **11,797,601 bytes / 5,001 rows**, no duplicates.
  Mid-build disconnect cleanup **49 ms**; concurrent membership revocation commit
  **3 ms**. These are one development run, not service-level guarantees.
- Real child process SIGKILL tested. Its owned fixture lease was advanced for
  recovery; no claim that production recovery time was measured.

HTTP session revocation/suspension use a controlled reader through the real
session-validation function, not a real Clerk account revocation. The public
360px preview rendered; the signed-in full-app screen was not visually verified.
Existing preview HMR 502 and Clerk development/CSS warnings remain.

## Scope and remaining acceptance

This is a complete export of its **named sections**, not a claim to complete
privacy fulfilment: external processors, identity records, other people's
activity and private document file bytes are excluded. Receipt of browser bytes
does not prove a local file was saved. Expiration is a development application
policy, not a Nigerian statutory period.

Migrations `0027` and `0028` were reviewed/applied only to development. They do
not establish staging/production migration or backup guarantees. Production
compatibility, independent assessment, the 35-day recovery policy, provider and
owner approvals, full formal 80/60/60 evaluations and R1/R2 acceptance remain
outstanding. No AI calls, merchant actions, messages, quota increases, launch or
live payments were performed for this unit.
