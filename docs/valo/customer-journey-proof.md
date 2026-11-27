# P0 customer journey — actual development execution

The retained machine result is `evidence/p0-customer-journey.json`. All **11 grouped
browser checks passed** against the running Valo application, managed Clerk
development instance, PostgreSQL, separate development export worker and private
App Storage. These are not the 80-rule, 60-customer-AI or 60-editorial suites.

## Executed behavior

1. Customer signup through Clerk's actual UI; workspace denied before verification.
2. Supported development test-email verification; real managed session and workspace.
3. Every Nigerian state/FCT selectable; explicit unknown preserved; marketing
   declined; profile saved and reloaded.
4. Manual document editing, autosave, reload and saved preview.
5. Actual DOCX/PDF jobs and browser downloads from the same saved revision.
   Checksums matched private file metadata; DOCX XML and PDF extraction contained
   the supplied text and naira glyph. Anonymous retrieval returned 401.
6. A fresh browser context signed in and reopened the saved profile/document.
   The document screen had no horizontal overflow at a 360px Chromium viewport.
7. Two tabs could not silently overwrite: stale save displayed a conflict, retained
   local text and saved only after explicit conflict resolution.
8. Restoring a document revision appended a new revision and preserved prior
   history and its original hash.
9. Two separately verified synthetic businesses could not substitute document,
   revision, export-list, file or export-retry IDs. Bidirectional document
   substitution failed; a spoofed workspace header/query was ignored.
10. A frozen valid session cookie was first accepted, then denied after actual
    provider session revocation, including private file access.
11. UI logout removed private endpoint access.

## Reproduce

```sh
NODE_ENV=development \
VALO_RUN_CUSTOMER_JOURNEY=synthetic-development-only \
pnpm --filter @workspace/api-server run test:valo-customer-journey
```

The runner refuses non-development/provider-live instances and deployment mode.
It uses the official Clerk testing helper for development bot detection, not an
application auth bypass. The helper derives the actual development FAPI; forcing
the production proxy originally caused the provider's protect-check screen.
No provider security setting was weakened. Credentials and session cookies stay
in memory, not reports, traces or source. Synthetic provider identities are deleted
after the run. Synthetic application rows/private export objects are currently
retained in development; this is **not** proof of account-deletion completion.
If rerunning, refresh the partial traceability report hash after checking the new
result. Existing hash bindings are historical, not a declaration of ongoing health.

## Limits and remaining gates

- Development test-email codes do not demonstrate real inbox delivery, password
  recovery, expired links, suspended accounts, staff MFA or identity production callbacks.
- Headless Chromium and DOCX/PDF parsing are not actual Word, Safari/iOS,
  screen-reader or real-device acceptance.
- Revision restoration is **not** an isolated database/object disaster restore.
  RPO/RTO, 35-day retention feasibility, deployed worker access/scale-down and
  staging/production migration permissions remain unproved.
- These are manual business drafts, not 12 completed guided templates or
  rights-cleared published catalogue items. No source/legal publication gate passed.
- All 127 formal requirements remain traced; these partial checks clear no
  whole-requirement blocker or release gate. R1 is not accepted and R2 stays gated.
  Public launch, live/recurring payments and confidential real data remain disabled.

## Git history and repository privacy

Normal merge `b742026dee838eb727f806500093208ba6a17aec` has local application parent
`1eaa449745136d355599b822532c6c4fbb60db01` and remote parent
`8c5c8013944bed70183c40784fb6ef49f30768fc`. Its resulting application tree was
unchanged. The remote parent's earlier application/specification histories were
preserved; no force push or replacement repository was used.

GitHub's authenticated and unsigned APIs initially both reported public access.
The authorized correction returned HTTP 200; fresh verification showed private=true
and unsigned 404. See `evidence/p0-github-privacy-correction.json`.
This does not retract prior public copies, prove main protection enforcement or
claim an application-source push/CI run. Synchronization evidence is recorded separately.

The subsequent [bounded public-exposure audit](public-exposure-audit.md) records
the scanned history, redacted findings, GitHub traffic limitations and remaining
security/privacy risks. It is not launch approval or assurance that no copies exist.
