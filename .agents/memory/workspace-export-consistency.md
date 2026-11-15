---
name: Private workspace export consistency
description: Why export snapshots, access checks, and restart semantics must remain separate.
---
Keep a consistent data snapshot separate from live authorization. Never retain a
membership lock throughout preparation or treat snapshot-era membership as
current permission.

**Why:** Independent review found that long preparation delayed revocation.
PostgreSQL's in-process snapshot also cannot survive preparer process death;
splicing later pages would misrepresent the exported data's consistency.

**How to apply:** Recheck current session, user and membership before release.
Resume an incomplete request as a new explicitly dated whole snapshot, preserving
attempt history and never combining snapshots. A completed verified private
artifact can be reused. Reserve every object before upload so late completion
remains fenced and included in erasure/recovery cleanup.
