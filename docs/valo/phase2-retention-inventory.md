# Legacy export retention review

PR #39 enforces retention on newly generated files. It intentionally assigns no
deadline to historical files. A null deadline is unresolved policy, not permission
to delete an object. This increment supplies a reproducible, read-only inventory
and a dated proposal; it includes no migration, backfill or apply command.

## Inspect and prepare

Use the existing private operator environment and expected `instance_id` from
`valo_runtime_identity`. Do not place a database URL or credentials in a shell
command, report or PR. After building the API, run from `artifacts/api-server`:

```sh
VALO_RETENTION_INSPECTION=read-only node dist/export-retention-inventory.mjs inventory EXPECTED_DATABASE_UUID
VALO_RETENTION_INSPECTION=read-only node dist/export-retention-inventory.mjs plan EXPECTED_DATABASE_UUID EFFECTIVE_AT_UTC RETENTION_DAYS GRACE_DAYS
```

The effective time must be future-dated and canonical, for example
`2027-01-01T00:00:00.000Z`. Durations are explicit integers from 1 to 365 days;
there is no default proposal. A proposed deadline is the later of creation plus
retention and effective time plus grace. Thus historical age cannot silently make
every file expire immediately. These values are product-policy proposals, not a
legal retention determination or approval.

Keep full JSON in a private operator directory. It contains opaque asset,
workspace and job identifiers but no file bodies, storage paths, user identities,
privacy messages or credentials. Share only the aggregate counts, creation-date
range, proposed deadline range and fingerprints for review. Exit 0 means every
inspected asset has a deadline and passes structural checks; exit 2 means coverage
needs review; exit 1 means inspection failed. None means launch approval, proof of
physical deletion, a verified backup or authenticated privacy clearance.

The database enforces a repeatable-read, read-only transaction. Inspection binds
the expected database identity and environment, caps inventory at 10,000 assets,
and times out queries after ten seconds. A larger inventory fails rather than
issuing a misleading partial proposal. No worker, storage provider or identity
service is called. Production inspection would still require a separately created,
authorized rehearsal database; this tool creates no infrastructure.

## Exclusions and later activation

Only unassigned, ready, structurally valid exports can appear in a proposal.
Already assigned deadlines are preserved. Missing/mismatched cleanup reservations,
invalid storage bindings and future creation timestamps block an entry. Every
workspace with a deletion case is excluded, even if its raw status says rejected
or released. Erasure-owned workspaces are excluded too. Inspection does not have
authority to authenticate or resolve those privacy histories.

Before any separate implementation applies a proposal:

1. Have the owner approve the exact environment, counts, duration, grace, deadline
   range and proposal fingerprint. Prepare exclusions for separate investigation.
2. Verify a fresh database/private-file backup and independent current privacy
   journal, retaining their receipts. A fingerprint is only a drift detector, not
   a signature or authorization token.
3. Re-read the inventory at the approved effective time, authenticate current
   privacy authority, and reject changed assets, reservations, source generations,
   privacy history or database identity. Acquire privacy locks before job/asset
   locks. A changed fingerprint requires a fresh proposal and review.
4. Use a reviewed atomic update and audit receipt that assigns only the approved
   null deadlines. Repeating or interrupting the operation must be safe. This PR
   deliberately does not supply that mutation path.
5. Verify future deadlines before workers reach them, then check download denial,
   regeneration and cleanup with disposable fixtures. Keep original drafts,
   revisions, commerce records, holds and erasure journals intact.

Before a deadline is reached, an approved rollback may restore only deadlines
assigned by that exact receipt. After expiry/retirement, never restore access with
old code or revive files without current privacy authority. Fix forward through
regeneration and keep cleanup journals. Production activation, retention approval
and restoration acceptance remain separate launch gates.

## Validation

The isolated PostgreSQL suite verifies all public rows remain unchanged across
inspection/proposal creation; stable snapshots produce stable fingerprints;
asset, reservation and privacy changes invalidate them; unauthenticated privacy
status cannot release an exclusion; wrong database identity rolls back; grace
prevents immediate expiry; and CLI failures do not disclose connection values.
