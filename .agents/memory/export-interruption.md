---
name: Export interruption invariants
description: Why application leases and durable object reservations must remain independent of transport retries
---

Queue durability does not repair application export state. Keep bounded application-level recovery, including queued deliveries whose application claim rolled back, and fence superseded workers before file reservation/completion.

**Why:** Review found that process death on the final attempt left an export permanently running. A transport delivery can remain claimed while the application transaction rolls back. An upload accepted remotely can also finish after the client dies or an earlier deletion succeeds.

**How to apply:** Preserve one visible export identity across retries, reserve object keys before network writes, bind ready state/assets atomically, and retain cleanup evidence/tombstones for late writes. Never remove a referenced historical file merely to clear an error. Re-prove kernel-kill/restart behavior when changing queue, renderer or storage behavior.
