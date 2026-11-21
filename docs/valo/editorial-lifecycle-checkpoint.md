# Editorial lifecycle execution and publication rechecks

The original 60-case corpus is unchanged. Its ten lifecycle cases now dispatch
to a concrete isolated runner instead of an unimplemented switch branch. The
runner requires a local dedicated seed database named
`valo_lifecycle_seed_<16–32 lowercase hex characters>` through
`VALO_EDITORIAL_LIFECYCLE_DATABASE_URL`. It must differ from the application
database and belong to the configured test connection. Each case clones that
seed to a new invocation-owned database and drops only that clone afterwards.
No native application row or retained private object is edited by the runner.

The seed must contain genuinely retained eligible manifests, actual independently
reviewed receipts, source/rights/export bytes and current source bindings. The
real publisher validates those prerequisites in a rollback-only transaction.
Missing genuine evidence produces a specific prerequisite hold. An empty seed,
synthetic pass flags, an unrelated review, or an embedded manifest alone cannot
be reported as original-suite acceptance. C057 additionally requires a current
governed rule, matching retained review artifacts and a second actually retained
changed source snapshot; synthetic affected/unaffected workspaces are then
created only in the isolated copy.

The adapters execute content/snapshot immutability and artifact-binding denials,
current policy narrowing, a forward-only freshness boundary, new-discovery and
download withdrawal, source dependency and notification fan-out, a real child
SIGKILL after publication commit, and two blocked publisher calls racing a
committed mandatory hold. Customer-owned draft history and an actually downloaded
file are checked for preservation in the withdrawal exercise. External notices,
provider calls and merchant actions are never dispatched.

The actual publisher now shares its complete transaction validator with the
rollback checker. It re-reads current owner scope and time after artifact I/O,
before the publication write. Its optional test time can only advance. Model and
prompt identities must exactly match each retained review. An optional
`docs/valo/policies/operational-publication-restrictions.json` may remove already
authorised classes, jurisdictions or explicitly allowed original-guidance IDs;
it cannot add permissions. Without that file the existing operational policy
bytes remain unchanged. Invalid restriction content fails closed.

Additive migration0035 makes captured source snapshots append-only and creates a
separate read-only editorial reviewer role. The C052 executor now records actual
drafter and reviewer publication-call, publication-SQL and policy-SQL denials with
six current-run audit IDs. An explicitly scoped role cannot regain publisher
authority through the shared development connection wrapper. This does not
claim independently provisioned production service credentials.

Seven local guard tests passed before CI: narrowing, no backdating, database
isolation, exact original corpus, absent-baseline holds, final expiry and final
policy reread. Real PostgreSQL role/source-history/clone tests are registered in
CI. Genuine original-case results, production publication, formal EDP010,
source80, R1 and R2 acceptance remain unclaimed until their own evidence exists.
Migration0035 has not been applied to the native development database.
