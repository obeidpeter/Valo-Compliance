# Staff role governance

IAM-002 / SEC-006 implementation: an active permanent system administrator with a recently verified managed session and MFA may verify a target and grant, replace or revoke an application role. The provider target must be the exact selected identity, active and unlocked with verified primary email. Roles are never accepted from browser claims, an automation key or an editorial worker. This change provisions no real identity or initial administrator.

Self-grants/renewals are denied. Emergency system access cannot administer roles. Emergency assignments last 5–60 minutes, require an incident reference and reason, and expire on the database wall clock. Every current finance, privacy and operational guard uses both the expiry predicate and a post-lock current-assignment check so waiting on a writer cannot extend access. New source/support/commercial guards must use the same helper when their private branches are combined; their final union is an integration requirement.

A serialised transaction rechecks current authority and expected revision, prevents losing the last permanent system assignment, persists the assignment and its immutable before/after audit together, and deduplicates exact retries by actor/request key. Target verification happens outside the transaction but is checked for freshness after locks; committed revocation during provider lookup blocks the mutation. A saved receipt can be read on exact retry even when the provider subsequently fails. Revocation does not depend on the target provider being available. Existing grants and historical access records remain preserved.

The system panel shows current assignments, effective expiry and immutable role-change alerts. It requires target verification and explicit confirmation of the exact fields; editing a duration/revision invalidates confirmation. An unknown response retains the original request body/key for deliberate retry, with no automatic grant retry. Existing account isolation clears private interface state. Sensitive changes also emit the existing internal structured log event, without sending external email or messages.

Validation registered in normal CI includes actual disposable PostgreSQL races, audit-write rollback and append-only enforcement, expired-role denial across current guards, expiry during a held row lock, managed-session HTTP negative cases and concurrent mutual administrator revocation. Controlled browser coverage uses the real component/generated client/private account boundary, checking exact confirmation, lost response retry, alerts, keyboard controls and 360px layout. Local syntax/targeted semantic checks are not substitutes for the exact CI database/browser result. No production identity, actual role assignment, deployment or native database migration has been changed.

Phase 2 integrates the merged Phase 1 foundation (`994b1f6`) and registers the unapplied staff migration as `0032_staff_role_governance.sql`, index 31, timestamp 1794705000003. The original branch's reserved 0034 number and older timestamp must not be used: Drizzle would skip that timestamp on a tracked 0031 database. All 31 applied SQL files remain unchanged. Other unmerged branches must renumber their pending migrations after this one when integrating.

The database rejects emergency assignments with NULL expiry or durations outside 5–60 minutes. Privacy and operational reads carry the server verification timestamp and recheck its freshness after assignment lock waits. The PostgreSQL suite observes actual blocking before letting that verification expire; both reads must deny access. See [the Phase 2 migration plan](phase2-staff-migration-plan.md) for the tracked and unadopted development paths, preservation tests and rollback boundaries.

## First administrator

The first permanent system administrator is created once with the shipped
operator command, never with hand-written SQL:

```sh
VALO_STAFF_BOOTSTRAP=first-system-administrator \
  node artifacts/api-server/dist/staff-bootstrap.mjs <user_id> <operator-label> "<reason, 20+ characters>"
```

It verifies the managed account is active with a verified primary email, takes
the same lock as every role change, refuses when any permanent system
administrator already exists, and records an ordinary immutable role change whose
actor is `operator-bootstrap:<operator-label>`. All later grants go through staff
role administration.
