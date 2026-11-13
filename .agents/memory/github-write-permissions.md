---
name: GitHub write-permission boundaries
description: Distinguish repository metadata permissions from effective connector permission to write workflow files.
---

Repository metadata reporting user push/admin permission does not establish that the attached connector can write Actions workflows. General source writes and workflow writes require separate operational proof.

**Why:** This project accepted source-tree writes and feature commits while targeted single-workflow tree creation returned 404. A secondary authorised source-control connection could also withhold credentials in the current context.

**How to apply:** Preserve prepared CI configuration as inactive documentation when workflow authorization is missing. Reconnect through the secure integration flow and retry the targeted capability once; this restored workflow writes here. Observe actual check runs before claiming CI success. Do not change visibility, buy a plan or bypass protection.

Recheck the intended repository's private visibility immediately before uploading new source, even when a previous check confirmed it private.

**Why:** Repository state changed independently during coordinated work while connector access remained valid. Authorization success alone does not preserve the owner's private-repository constraint.

**How to apply:** If metadata reports public visibility contrary to that constraint, hold uploads, preserve work in Replit and identify the required owner action. Do not change visibility or publish source as a workaround.
