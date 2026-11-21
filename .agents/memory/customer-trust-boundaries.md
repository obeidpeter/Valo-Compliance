---
name: Customer trust boundaries
description: Owner-required origin, durable-write and in-flight membership-revocation semantics.
---

Requests must not establish trusted site identity through forwarding headers.
Compare the configured exact origin, including scheme and port. Customer writes
must have durable abuse limits and preserve saved and unsaved work on rejection.
A membership revocation committed while a request waits must prevent its write.

**Why:** Independent review reported these three current development-code issues.
The user explicitly said these are findings, not proof of a deployed exploit.

**How to apply:** Keep origin authority independent of proxy request data. Check
membership in the write transaction after blocking resource locks; use real
concurrent transactions and proxy requests for regression evidence. Do not
describe commit-order serialization as cancelling already committed work.

Development-only exports/workers require explicit development and no nonempty
deployment marker; other non-production modes are not approval. Account changes
must remove copied form values on public as well as private screens, cancel or
discard old work, and never submit old values for the next workspace. Ordinary
same-account navigation must preserve edits or offer save/discard.

**Why:** The user explicitly required these boundaries after separate security
review; cache clearing alone does not meet the customer-data boundary.

**How to apply:** Exercise distinct A/B form markers, late requests and session
loss across tabs. Keep development controls and negative results separate from
production or independent security acceptance.
