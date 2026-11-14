# Account transition privacy regression

**Historical initial checkpoint.** The later
[runtime-boundary checkpoint](runtime-boundary-security-checkpoint.md) adds
request cancellation, cross-tab session-end handling, scoped notifications,
profile save/discard navigation and 13 executed controlled browser checks.
The original evidence and limitations below are retained, not presented as the
latest implementation inventory.

Application implementation: `92fadef424e625b31840441b5bde157c6c480134`.
This follows the independent source review of `3596655`; that review did not
review these new changes. **This is not independent security acceptance.**

The old cache-only behavior was reproduced using the actual profile component:
after a controlled A→B identity transition, A's copied local form remained.
The new boundary remounts the entire identity-sensitive subtree and creates a
fresh query/mutation client for each identity/session/verification scope.
Old queries are cancelled, old caches cleared and profile/checker callbacks
guarded by their originating account epoch. Incoherent loaded identity views are
hidden; initial unresolved identity does not block free public content.

Page-hide scrubs the subtree; a restored persisted page forces a fresh load.
Saved server documents are not deleted. Unsaved forms are deliberately cleared
at account transitions; the sign-out control advises saving first.

[Actual browser results](evidence/account-switch-browser.json) bind the source
hashes and compiled product CSS. Seven controlled checks passed:

1. Legacy cache-only counterexample reproduced.
2. Copied profile fields reset on account change.
3. B's submitted profile contained no A marker.
4. A delayed A workspace response did not repopulate B.
5. Public checker copied facts reset on sign-out.
6. Controlled page lifecycle cleared and recreated private form state.
7. The actual profile component reflowed at 360px and advanced native focus.

These use actual React screens and Chromium, **controlled identity/API inputs**,
not real Clerk account switches. Real multi-account/other-tab session tests,
native BFCache behavior, all target browsers/devices, assistive technology and
independent review remain unproved. Setup/selector fixture failures were corrected
and retained locally; none was counted as an application acceptance pass.

The CI workflow now runs the controlled regression after building real Next CSS.
Local proof does not claim the new CI run passed. R1/R2 gates remain unaccepted,
publication remains zero and neither launch nor live finance was enabled.
