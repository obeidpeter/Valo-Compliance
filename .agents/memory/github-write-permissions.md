---
name: GitHub write-permission boundaries
description: Distinguish repository metadata permissions from effective connector permission to write workflow files.
---

Repository metadata reporting user push/admin permission does not establish that the attached connector can write Actions workflows. General source writes and workflow writes require separate operational proof.

**Why:** This project accepted source-tree writes and feature commits while targeted single-workflow tree creation returned 404. A secondary authorised source-control connection could also withhold credentials in the current context.

**How to apply:** Preserve prepared CI configuration as inactive documentation when workflow authorization is missing. Do not claim CI ran or configure required checks. Reconnect through the secure integration flow; retry the targeted capability once after authorization instead of changing visibility, buying a plan or bypassing protection.
