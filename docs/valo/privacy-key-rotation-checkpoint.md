# Privacy signing and deletion identity across key rotation

Audit events and deletion identity hashes now record a key version. Current
keys sign new events; retained historical keys verify earlier versions. The
runtime `VALO_PRIVACY_KEYRING` secret, when configured, contains a current version
and a version-to-key mapping. It must be managed through the secure secrets
flow, not pasted into chat or committed. No real secret was changed here.

Without a configured ring, the session secret derives a **fingerprinted
version ID**, rather than silently reusing one identifier after rotation.
The legacy `session-derived-v1` alias is pinned only after an actual retained
signature verifies. Database records contain version fingerprints, not keys.
Reusing a pinned version name for another secret is rejected.

Missing historical material returns an explicit held/unavailable response.
Deletion matching checks all required tombstone key versions; an unavailable
historical key cannot silently allow an identity to provision a new workspace.
This can intentionally hold private workspace access until verification
material is restored. Public pages do not require that private lookup.

## Executed scope

- 19/19 combined isolated-key, synthetic erasure/private-storage and controlled
  privacy HTTP tests passed; typecheck passed.
- Rotation fixtures prove current signing, legacy/historical verification,
  old deletion-hash matching, missing-key holds and version-name reuse denial.
- Reviewed additive migration 0021 was applied in development, SHA-256
  `ee00d4e88fb5149a73ff302cb7badbe1dfcc5ac078cf7231c9a5cbafe9e37cb0`.
  It does not fabricate a migration baseline or apply production changes.

This does not implement the complete independent post-cutoff deletion-journal
backup/import service, prove production recovery, or erase retained support,
privacy and external-processor records. Those findings remain open. A real
operational key rotation requires securely retaining the prior verification
keys; deleting them is not an erasure mechanism or a valid way to clear holds.
