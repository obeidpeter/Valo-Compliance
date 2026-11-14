# Workspace data download boundaries

The privacy page requests the same-origin `/api/workspace/data-export` attachment in a temporary iframe. The application does not parse or copy the full export into a browser Blob. The server still prepares a complete JSON snapshot, paging rows into a private temporary file, before it sends attachment headers. The existing section-level privacy disclosure remains unchanged.

The iframe belongs to the privacy page. Cancel, timeout, unmount, account-boundary replacement and page hide stop pending preparation. The server observes disconnects between queries and row writes and removes scratch in `finally`. An in-flight database/provider call is not forcibly terminated; cancellation is checked when it settles. After attachment handoff the browser owns the transfer, and the app cannot confirm a saved file or revoke already delivered bytes. The UI states this limitation.

Before release, the server re-reads the original request's managed session, identity and verified primary email, then checks current workspace membership and deletion state. The original identity cannot be replaced by another account during preparation. These checks deny a new release; they do not retract earlier downloads.

`App.tsx` wraps the workspace routes in `ClerkAccountState`, which keys `AccountStateBoundary` by user, session and primary-email verification status. A changed or incoherent identity unmounts the old privacy page and its iframe. Controlled fixtures exercise this lifecycle; they are not proof of live managed-identity integration.

## Evidence and remaining scope

- `test:valo-workspace-download` checks current-session release decisions.
- `test:valo-workspace-download-db` uses disposable PostgreSQL and the actual collector, file helper and HTTP handler for paging, late denial, cancellation, cleanup and a fresh retry.
- `test:valo-workspace-download-browser` uses the actual download component with a synthetic same-origin HTTP/cookie fixture. It rejects full-export fetch/Blob/JSON processing in the app and checks a download over 8MB, keyboard access, narrow width, cancellation and bounded errors. It does not test the full app's visual design or live identity provider.
- The full-page `privacy-data-browser.ts` fixture retains privacy scope and account-boundary coverage with the native attachment transport. It still requires the running development product CSS.

The retained `docs/valo/evidence/privacy-data-v2-browser.json` is historical evidence for the earlier fetch/Blob implementation and its recorded source hashes. It is not acceptance evidence for the current native download. Do not replace that historical result with an unexecuted pass; use reports from the exact current test execution.

This remains a synchronous, regenerable workspace download. It is not a durable export job and does not resume a snapshot after process restart. Worker/restart guarantees, full coordinated privacy fulfilment and large staff-prepared case exports remain separate work; the latter still uses its existing bounded in-memory result path. Production hosting, managed-session and supported-browser acceptance remain required.
