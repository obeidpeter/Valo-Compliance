# Privacy HTTP role and deletion-history boundary

Privacy staff endpoints now validate the active managed session, verified
primary email and fresh MFA, then an **independent privacy** assignment.
They no longer require a finance assignment. The production route still
obtains user/session information from Clerk. The controlled HTTP harness
injects raw auth/session/user responses into the same session-validation
function and router, exercising active/revoked sessions, mismatched session
ownership, unverified email, MFA, HTTP methods, same-origin checks, the real
database role check and request transitions. It does not claim a real
privileged Clerk sign-in or real TOTP challenge was exercised.

Workspace resolution and write authorization now check retained deletion
tombstones. A restored `active=yes` membership cannot write, and deleting the
membership row and its ownership mapping cannot cause the same identity to
create a new workspace UUID: resolution also checks the retained identity HMAC.
Recovery still requires a post-cutoff deletion journal and
remains a development-only partial workflow; managed-identity deletion and
external processors remain held.

Actual checks: **22/22** combined HTTP, synthetic erasure/native-storage and
workspace PostgreSQL tests passed; workspace typecheck passed. HTTP cases
exercise privacy-only allow, finance-only deny, revoked/stale-MFA deny,
unauthenticated deny and hostile-origin deny. No provider inference calls,
email, real payment, public publication, production erasure or R1/R2
acceptance is claimed.
