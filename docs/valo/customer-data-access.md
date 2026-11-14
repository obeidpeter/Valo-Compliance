# Customer application-data access

## Working scope

The authenticated JSON download returns schema version 2 with the previously
included application records plus:

- Export-job metadata tied to the business and saved revision.
- File checksums, size, format, creation and retention metadata.
- Workspace activity authored by the requesting identity only.

Queries run in one repeatable-read transaction with current membership
authorization. Explicit projections omit private storage locators and queue
identifiers. A section exceeding 5,000 records or the existing aggregate size
limit fails explicitly; it does not return a silently truncated file.

The same bounded result can be prepared for a verified, assigned privacy case.
That case remains **partially fulfilled**. Existing prepared results are
immutable and retain their original schema and scope.

## Not included or accepted

No Word/PDF bytes, direct storage links, membership list, other people's activity,
full system/staff audit archive, managed identity-provider data, external
processor data or unlinked public contact request is included. Physical erasure,
provider fulfilment, retention decisions and full rights-request completion
remain separate incomplete work. Large-workspace assisted streaming is not
implemented; a request must not be marked complete just because it was saved.

## Reproduce

Use synthetic development data only:

```sh
VALO_RUN_DB_TESTS=synthetic-development-only pnpm --filter @workspace/api-server test:valo-db
NODE_ENV=development VALO_PRIVACY_FIXTURES=owned-synthetic-development-only pnpm --filter @workspace/api-server exec tsx src/scripts/privacy-case-proof.ts
NODE_ENV=development VALO_RUN_PRIVACY_BROWSER=synthetic-development-only pnpm --filter @workspace/api-server exec tsx src/scripts/privacy-data-browser.ts
pnpm run typecheck
```

The browser runner uses actual product React components and compiled product CSS
with explicitly controlled API responses and identities. It checks keyboard
download, 360px reflow, downloaded JSON and rejection of an old-account response.
It is **not** managed Clerk sign-in, real-device or full WCAG acceptance.
The database test's failed-export/file row is metadata-only: it does not create
an object or prove a new Word/PDF render.

Initial browser harness failures (HTML content type and an incorrect fixture
response envelope) are retained separately, not counted as product or provider
quality results. The real privacy-cases API returns an array.

No email, payment, AI inference or external erasure is executed by these checks.
