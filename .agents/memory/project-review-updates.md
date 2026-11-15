---
name: Project review updates
description: Keep draft pull-request summaries concise and current without accumulating progress logs.
---

Replace the draft pull request's current reviewed snapshot when updating status,
and link retained evidence instead of appending another historical progress log.

**Why:** The user asked after replacing the accumulated log with a concise summary.

**How to apply:** Preserve historical evidence separately and keep the current
snapshot factual about implementation, executed checks and unresolved work.

Check exact reviewed-commit ancestry and existing merge parents before claiming
a pull request is unintegrated; also inspect its current GitHub state.

**Why:** An earlier status snapshot called source unmerged even though normal
development history already contained it. A fetched branch tip alone does not
establish whether the reviewed source is present.

**How to apply:** Verify the exact supplied commit first; do not create duplicate
merges or infer source absence from an old handoff or pull-request description.
