---
name: Privacy erasure and recovery
description: Keep deletion separate from accountable usage history and backup replay.
---

Erasure of customer content must not erase provider usage, financial records,
security evidence or quota accounting merely to make the deletion appear
complete. Represent retained categories as policy decisions still awaiting
review, not as statutory retention claims. Record per-system outcomes and
never describe partial application erasure as complete account deletion.

**Why:** Deleting model usage or financial history can undercount spend or
rewrite settlement evidence; claiming that retained/external systems were
erased would mislead the requester.

**How to apply:** Minimise or redact private payloads while retaining necessary
metering and immutable records. Require a reviewed retention policy and
external processor outcomes before complete-fulfilment claims.

Apply retention exceptions field by field. Financial or audit retention does
not automatically justify keeping copied private statements, checkout URLs,
free-text reasons or earlier full workspace snapshots.

**Why:** The user explicitly required private-copy minimisation without deleting
genuine usage history, shared records or minimum accountable financial facts.

**How to apply:** Establish ownership through workspace and payment references
before removing links. Do not infer ownership of public intake from an email.
Keep signed cleanup locators until acknowledged; treat unlinked legacy records
and external processor copies as unresolved rather than falsely erased.

A database restored to a point before deletion cannot contain a later
tombstone by itself. Recovery needs a separately preserved, authenticated
post-cutoff deletion journal, imported and replayed before restored access is
opened. Keep its verification key outside the journal payload; a payload that
supplies its own verification key cannot establish independent authority.
Re-delete private objects, including delayed writes, after restoring
both the database and its object storage.

**Why:** A local restore drill proves neither managed backups nor resurrection
prevention unless it includes the deletion events absent from the old backup.

**How to apply:** Quarantine access first, replay verified deletion and
revocation events into the isolated restore, and verify tenant/object scope
before opening customer traffic. Do not call a local replay production RPO/RTO
evidence.
