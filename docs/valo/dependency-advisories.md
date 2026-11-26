# Dependency advisories, their time frames and the bill of materials

What each merge checks in the packages Valo installs, how long an advisory may stay, and what is kept
with each run. It covers SEC-007, "Vulnerability management": "Scan code, dependencies and secrets on
each merge; independently review before public launch. Accept: no open critical or high exploitable
issues in launch paths, with lower-severity exceptions owned and time-bound." It also maps to OWASP ASVS
5.0.0 V15.1.1, V15.1.2 and V15.2.1 in the [security baseline](../architecture/security-baseline.md),
part 3 of [small hardening](../architecture/small-hardening.md) (slice 4). The time frames are
development defaults for the owner to confirm. This note is not an independent review, which SEC-007
asks for before public launch.

## What each merge checks

The workflow's two scan jobs run on every push and pull request:
- **Dependencies and secrets** (`scripts/src/valo/merge-security.ts`): `pnpm audit` on the lockfile,
  and gitleaks over the repository's whole history. Each first finds a canary it must catch.
- **Static rules** (`scripts/src/valo/merge-static.sh`): Semgrep, with a canary of its own.

The checks keep counts and places, never the text they matched
([merge security](merge-security-and-recovery.md)).

## How long an advisory may stay

| Severity the audit reports | What the merge needs |
| --- | --- |
| Critical or high | None open. A reviewed exception is set aside only within the part of the dependency tree that was reviewed. It names its owner and is reviewed again within 30 days. |
| Moderate | Recorded with its owner, and fixed within 30 days of being recorded. |
| Low | Recorded with its owner, and fixed within 90 days of being recorded. |
| Informational | Counted, and nothing more. |

- **Where they are recorded:** in `scripts/src/valo/security-reports.ts`.
  - A reviewed exception goes in `REVIEWED_DEPENDENCY_ADVISORIES`, with `owner` and `reviewBy`.
  - A moderate or low advisory goes in `RECORDED_LOWER_ADVISORIES`, with its severity, `owner`,
    `recordedOn` and `fixBy`.
  - Both lists are empty: on 26 November 2026 the audit reported no advisory of any severity.
- **The owner of a record** is a role the specification names: the Engineering lead or the Security
  lead. The owner names who holds each role, outside this public repository.
- **The merge fails** on:
  - an advisory that is not recorded, or is recorded at another severity;
  - a record without its owner, or with a malformed date;
  - a record made after today, or ending beyond its time frame;
  - a record past its date, even when the audit no longer reports its advisory. Remove a record once
    its advisory is fixed.
- **Dates** are days in UTC, and the gate reads them on the day it runs. A record still stands on its
  last day.

## Each week

The workflow also runs both scan jobs once a week, on Mondays at 05:41 UTC, so an advisory published
after the last merge is found. Its other jobs skip a scheduled run. GitHub starts a schedule only from
the repository's default branch, `main`, which holds only the first commit. The weekly run therefore
starts once the workflow reaches `main`, which is the owner's decision.

## The bill of materials

On each merge, and each week once the workflow is on `main`, the dependency job makes a software bill
of materials from the lockfile (`scripts/src/valo/sbom.ts`). It keeps the bill with the run as the
`software-bill-of-materials` artifact.
- **The format:** CycloneDX 1.5 JSON.
- **For each package:** its name and version, its registry address as a package URL, its checksum,
  and what it depends on. Each is marked as needed at run time (`required`) or only by development
  tools (`excluded`).
- **For the bill itself:** the commit, and the lockfile's own SHA-256.
- **A package that stops it:** one from anywhere but the registry, or without a checksum.
- **On 26 November 2026** it listed 447 packages: 288 needed at run time and 159 by development tools
  only.

## Updates outside an advisory

- `.github/dependabot.yml` asks for weekly update proposals, each release at least seven days old,
  as the minimum release age in `pnpm-workspace.yaml` and `.npmrc` requires.
- GitHub reads that file from `main` too, so no proposal is made until the work reaches `main`.
- No time frame is set for adopting a routine update when no advisory needs it. That is the owner's
  decision (the design's owner points).
