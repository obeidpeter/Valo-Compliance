# The audit trail

Part of the finishing plan's Phase 3 row "The audit trail", for ADM-009.

The requirement, verbatim from the specification:
- ADM-009: "Record sensitive access, publication, role change, refund and recovery actions with actor,
  object, reason and timestamp. Accept: application users cannot modify audit history; tampering and
  excessive privileged access generate alerts."

## What there was

**The histories.** Most sensitive actions already write a row the database will not change:

| Action | History | Guard |
| --- | --- | --- |
| A staff read | `valo_staff_access_audit` | No update; deletes only of synthetic test identities' rows; no TRUNCATE (0036) |
| A role change | `valo_staff_role_changes` | No update or delete; no TRUNCATE (0032, 0036) |
| A reviewed publication, hold or withdrawal | `valo_publication_audit` | No update or delete (0007) |
| A source hold or safety control | `valo_safety_control_audit` | No update or delete (0037) |
| A refund's status | `valo_refund_transitions` | No update or delete, except an erasure replacing a reason with the projection it recorded first (0016, 0029) |
| A dispute, a payment concern, a support case | their transition and event tables | No update or delete (0025, 0031, 0039) |
| A staff-library release, hold or withdrawal | `valo_manual_changes`, `valo_manual_holds`, `valo_manual_withdrawals` and the others | No update or delete |
| A rule's sign-off or change | `valo_rule_owner_signoffs`, `valo_rule_changes` | No update or delete; no TRUNCATE |

**The gaps.**
1. Two histories had no guard at all:
   - `valo_events`, each workspace's activity;
   - `valo_privacy_events`, each privacy case's history. Its hash chain shows a changed row only when the case is next read.
2. TRUNCATE skips row triggers, and only seven tables refused it, so most histories could be emptied in
   one statement.
3. A staff access row said why a person read something but not what they read. Only the refund,
   reconciliation, dispute-hold and editorial-record reads named it, in their reason's words.
4. The operator tools record no operator and no reason:
   - restoring a backup and removing old backups;
   - the reviewed route's publisher, whose row names a fixed service label and gives the manifest's digest
     as its reason;
   - the recovery controls.
5. Nothing raises an alert when someone tries to change a history, and nothing counts privileged reading.
   A refused change reaches the error handler as an unexpected failure: it is logged and answered with a
   503.
6. Staff have no screen for the access history, the safety-control history, price changes or refund
   transitions.

**The limit every guard shares.** The application's own database login owns every table. A trigger stops
every login that cannot disable it, the customer role among them, and the application's own code, which
never disables one. But the owning login can disable a trigger, or switch triggers off for its session.
Until the histories belong to an owner the application cannot act as (slice 5), a guard is a rule the
application keeps, not one it cannot break. The integrity checks in slice 3 are there to show it was
broken.

## The slices

1. **Guards** (this change): the two unguarded histories, TRUNCATE on every history, and the object of each
   staff read.
2. **Operator actions**: the restore and backup-removal tools, the reviewed publisher and the recovery
   controls record who ran them, on what, and why.
3. **Alerts**:
   - an attempt to change a history, refused by its guard, becomes a security signal and an alert;
   - a periodic integrity check finds a history row that is gone or changed, however that happened;
   - privileged reading above a threshold raises an alert.
4. **A staff viewer** for the histories that have none.
5. **Later, with Phase 8's migration login**: the histories owned by a role the application login cannot
   use, so that it can no longer disable their guards.

## Slice 1: the guards

**A workspace's activity** (`valo_events`) is never changed. Its rows are removed in only two cases:
- a verified deletion request removes them at its activity step: a deletion case for the workspace,
  verified and processing, whose erasure is at `activity_text`;
- the cleanup of a workspace that belongs to a synthetic test identity (`synthetic-` or
  `privacy-fixture-`), which tests and fixtures remove. This is the exception 0036 made for staff
  access rows.

**A privacy case's history** (`valo_privacy_events`) is never removed, except with a synthetic test
identity's workspace. A row changes only as an erasure replaces its reason with the projection the erasure
recorded first in `valo_privacy_redactions`, as a refund transition's may (0029). Every other column must
stay as it was.

**TRUNCATE.** Every table whose rows a trigger guards against deletion now refuses TRUNCATE too. That is
the 7 that already did and 29 more, the two above among them. A cascade that would reach one of them is
refused with it. The migration test checks the rule on the whole schema, not on a list, so a new history
that refuses deletes but not TRUNCATE fails the build.

**What each staff read names.** `valo_staff_access_audit.object` holds a list's kind alone, or a record's
kind and ID:

| Read | Object |
| --- | --- |
| The staff overview of an area | `staff_overview:<area>` |
| Staff assignments | `staff_assignments`, or `staff_assignments:<identity>` for one person's |
| Source and safety controls | `source_controls:<area>` |
| A version's publication record | `content_version:<id>`, `rule_version:<id>` |
| The privacy queue, one privacy case | `privacy_cases`, `privacy_case:<id>` |
| The support queue, its assignees, one case | `support_cases`, `support_assignees`, `support_case:<id>` |
| The library entries a support reply may cite | `library_entries` |
| Content escalations, one escalation | `support_escalations`, `support_escalation:<id>` |
| The refund queue, one refund | `refunds`, `refund:<id>` |
| Payment concerns, one concern | `payment_concerns`, `payment_concern:<id>` |
| One dispute, one dispute action, a test dispute's order | `dispute:<id>`, `dispute_action:<id>`, `order:<id>` |

- A check constraint holds the form: a lower-case kind, then optionally a colon and up to 200 characters
  without spaces.
- Rows written before the column existed read `unrecorded`, since nobody can now say what they read.
- The column has no default, so every new row must name its object.

**What did not change.** The customer role's privileges are the same: it never deletes or changes either
history. No row is rewritten: adding the column changes no existing row's values, and the guards are new
triggers. Erasure keeps working as it did, through the two exceptions above.

## Tests

- **The migration test**, for each new migration, tracked and unjournalled:
  - the upgrade keeps every row, including the activity and privacy histories, and an interrupted
    migration leaves rows and schema as they were;
  - an earlier access row reads `unrecorded`, and a new row without an object, or with a malformed one, is
    refused;
  - an activity row is never changed. It is removed only by a deletion request at its activity step, not
    before it and not while the request is held, or with a synthetic workspace;
  - a privacy history row is not removed with a real workspace. A reason changes only to the recorded
    projection, and a change to anything else is refused even then;
  - every table that guards its rows against deletion refuses TRUNCATE, and a cascade from the workspaces
    table is refused.
- **The erasure test** now shows the guard refusing a change to a case's history. It makes its corrupt
  copy in one transaction with the guard off, as a damaged restore could hold one, and the replay still
  refuses it.
- **Two staff reads** record their object: a privacy case read over HTTP, and the finance overview.

## What comes next

Slice 2: the operator tools record who ran them and why.
