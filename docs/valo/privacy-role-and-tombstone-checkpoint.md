# Privacy HTTP role and deletion-history boundary

Privacy staff endpoints now validate the active managed session, verified
primary email and fresh MFA, then an **independent privacy** assignment.
They no longer require a finance assignment. The production route still
obtains user/session information from Clerk; the controlled HTTP harness
injects only its test identity resolver into the same router, exercising
actual Express methods, same-origin checks, the real database role check,
request transitions and error statuses. It does not claim a real privileged
Clerk sign-in was exercised.

Workspace resolution and write authorization now check retained deletion
tombstones. A restored `active=yes` membership cannot write, and deleting the
membership row cannot cause the same identity to recreate its workspace after
synthetic erasure. Recovery still requires a post-cutoff deletion journal and
remains a development-only partial workflow; managed-identity deletion and
external processors remain held.

Actual checks: **22/22** combined HTTP, synthetic erasure/native-storage and
workspace PostgreSQL tests passed; workspace typecheck passed. HTTP cases
exercise privacy-only allow, finance-only deny, revoked/stale-MFA deny,
unauthenticated deny and hostile-origin deny. No provider inference calls,
email, real payment, public publication, production erasure or R1/R2
acceptance is claimed.
