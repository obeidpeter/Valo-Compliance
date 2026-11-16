# Generated-export retention

Completed document exports previously left `valo_file_assets.retention_at` empty,
and neither download authorization nor the worker enforced it. New exports now
receive a fixed deadline at successful completion. `VALO_EXPORT_RETENTION_DAYS`
accepts an integer from 1 to 365; the development default is 30 days. Changing the
setting affects newly generated files only. This implements a configurable
product policy; it does not approve a legal retention schedule or production use.

Expired files have no download link and return HTTP 410 even when cleanup is
delayed. The service rechecks expiry and the asset generation after private
storage retrieval, before releasing bytes. Owners can regenerate the same saved
revision through the existing retry endpoint. Regeneration rotates the queue and
object identities, preserves request aliases and source hashes, and cannot revive
a superseded delivery. The UI explains expiry without presenting it as loss of
the saved draft.

The worker reserves at most five due entries per dispatch, releases those locks,
then locks authenticated privacy authority before jobs and assets. A legal hold,
unverifiable privacy history or erasure-owned workspace prevents retirement.
Invalid bindings and held rows back off so another batch can progress. Detaching
the expired asset, fencing the job, retaining a cleanup reservation and appending
the expiry audit event commit together. Existing orphan cleanup owns physical
deletion, persisted retries and repeated late-upload removal. It rechecks privacy
authority, including a hold added after retirement. No document/revision, order,
entitlement, payment, reconciliation or privacy case is deleted by retention.

The `EXPORT_RETENTION_BACKLOG` operational alert counts expired ready assets even
while their processing is delayed. A missing reservation cannot silently make an
expired download usable or disappear from that counter. Resolving a privacy hold
is a separate authorized action, never an alert-suppression step.

## Existing data and rollout

No SQL migration or automatic backfill is included. Historical assets with a null
deadline retain their current behavior and require a separate inventory and
owner-approved schedule before production acceptance. Never infer that a null
deadline authorizes deletion, and never change financial or privacy retention to
clear an export alert. The new code has not been activated in the native workspace
by this PR; production resources remain uncreated.

The subsequent [legacy inventory workflow](phase2-retention-inventory.md) prepares
read-only counts, exclusions and a fingerprint-bound dated proposal. It does not
apply deadlines or authorize cleanup of historical files.

After review and merge, take the existing verified database/private-file backup
and independent privacy journal, preserve native preview overrides, then deploy
the reviewed build. Use a new synthetic export to verify deadline, download denial,
regeneration, failed-delete recovery and hold protection. Confirm existing records
are unchanged and all temporary test objects are removed. No full migrator is
needed against the development database's unadopted ledger.

Do not roll back to code that releases expired bytes. If an application rollback
is required, hold export creation/download and retain cleanup journals while
fixing forward. A previously retired asset must not be restored without the
current privacy journal and an explicit recovery review. Legacy policy approval,
production storage/hosting, actual ingress checks and production recovery remain
launch gates.

## Validation

The isolated PostgreSQL suite exercises expiration during retrieval, transaction
rollback, concurrent retirement, generation fencing, physical-delete failure,
late upload, real application regeneration, authenticated holds, malformed-key
fairness and preservation of financial and revision history. Storage in that
suite is controlled, not native-provider proof. The existing process/worker suite
also expires a generated file through the actual running dispatcher. Both run in
hosted CI; no existing development database is used by these tests.
