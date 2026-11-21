# Earlier GitHub public exposure: bounded audit

Audit date: 13 November 2026 (UTC). Repository: `obeidpeter/Valo-Compliance`.
This is an exposure investigation, **not independent launch/security approval**.

## Outcome

- **Public availability is confirmed.** Earlier unsigned and authenticated reads
  succeeded. Product specifications, roadmap, execution instructions and requirement
  registers were publicly retrievable; their read-only import is recorded in
  `evidence/specification-import.json`. These contain internal product planning,
  not merely public marketing material. Whether any of that material was subject
  to a confidentiality obligation remains an owner classification decision.
- **No operational credential exposure or real customer-record exposure was
  confirmed within the inspected scope.** This is not proof that none occurred.
  No credential was tested against a provider, printed, or rotated.
- Current GitHub metadata reports private visibility; an unsigned API read returns
  404. This closes that access path now, but cannot retract previous copies.
- **Dependency risks remain:** the current lockfile scanner reported 10 high,
  10 moderate and 2 low findings, zero critical. They are not evidence of
  exploitation or caused by the public-repository incident.
- No source, settings, history, billing, deployment, payments or release gates
  were changed by this investigation.

## Evidence and timeline

| UTC | Observation | Evidence |
| --- | --- | --- |
| 16:34:22 | Repository creation and a GitHub `PublicEvent` | `evidence/public-exposure-github.json` |
| 17:23:18 | Read-only import explicitly observed public visibility and retrieved 10 specification/register files | `evidence/specification-import.json` |
| 20:57:27 | Both unsigned and authenticated metadata returned 200 and `private=false` | `evidence/p0-github-privacy-correction.json` |
| 20:58:34 | Authorized privacy correction returned 200 and `private=true` | Same |
| 21:01:05 | Authenticated private metadata and unsigned 404 | Same |
| 21:19:40 | Fresh private metadata, unsigned 404, traffic/fork/event reads | `evidence/public-exposure-github.json` |

These observations support a public exposure window on this date, not a continuous
access log or exact proof of every transition between observations. Local commit
timestamps do not establish when a commit was uploaded or publicly reachable.
The historical scan deliberately includes local and post-correction material too.

## Exact scan scope

Starting working tree was clean at
`9095e1afd4a51b08423a71bd7fbf7fa257fabc7e`.

1. All 27 commits reachable through local refs (`git rev-list --all`), including
   full commit metadata/messages; repository is not shallow.
2. All 661 unique reachable blobs, 5,655,272 bytes, without file-size or path
   exclusions; no NUL-containing binary blobs were found. Each blob was scanned
   once; the manifest records one representative pathname, not every rename.
3. All 464 tracked current files, separately scanned.
4. GitHub branches, tags and **all two pull requests**, one page each with no next
   page. Three branches were returned and no tags. Their tips and both PR head/base
   commits are contained in the scanned history:
   - `main`: `650e60d855da5fab61b98f3ec7d89c4c29c7fc57`
   - `docs/specification-baseline`: `871899483093363ec69d765e2d16fa1d88e0836e`
   - `feature/valo-p0-foundation`, PR 2:
     `9095e1afd4a51b08423a71bd7fbf7fa257fabc7e`
   - Earlier publicly imported tip:
     `8c5c8013944bed70183c40784fb6ef49f30768fc`
5. GitHub's recursive feature-tip tree was not truncated: all 464 remote blobs
   are present in the scanned blob inventory. The local `main` label differs
   from GitHub `main`; the actual remote commit was checked, not assumed from
   that local label.

Reproduction: `python3 scripts/audit-public-exposure.py` produces
`evidence/public-exposure-history.json`. The recorded file is the snapshot before
this audit's new files are committed; a later run intentionally scans its own
then-current refs and tracked files and will have different counts.
Remote scope is preserved in `evidence/public-exposure-remote-scope.json`.

### Method and redaction

The local read-only heuristic checks provider token formats (GitHub, OpenAI,
Stripe/Clerk-style, AWS access IDs, Google and Slack), private-key headers,
credential-bearing URLs, JWTs, quoted/unquoted credential assignments, email
addresses and confidentiality markers. Exact regexes, refs, commit IDs, blob IDs,
paths and line numbers are in the evidence. Matched values and commit identities
are never emitted by the script. The script does not read environment secrets.

This is a bounded regex audit, not Gitleaks/TruffleHog, entropy analysis, credential
validation or exhaustive DLP. The three platform scans below supplement it but
do not provide an independent full-history secret scan.

## Candidate review

| Historical matches | Disposition |
| --- | --- |
| 0 provider tokens, private-key headers, JWTs or quoted literal-secret matches | No matches under these rules; not universal absence |
| 5 credential-URL occurrences across blob versions | Two synthetic localhost CI database URLs; two source-fetch credential-rejection fixtures; one deliberately fake schema-error redaction fixture |
| 2 unquoted secret occurrences | The synthetic CI database password in two workflow versions, not a workspace/provider/production credential |
| 9 email-pattern occurrences | Synthetic fixture/contact addresses and URL-rejection test strings; no real customer record confirmed |
| 201 confidentiality-marker occurrences | Development restrictions, requirements, privacy copy, generated requirements/catalogue data and test-output references, not a customer dataset |
| 54 commit-metadata email occurrences | Author/committer identity metadata, two occurrences per commit; values withheld here. These identity/contact fields were available with reachable Git history and should be treated as personal metadata, not credentials |

Current-tree scan returned 79 candidates; these fall within the same reviewed
categories. Reviewed source includes the workflow, source-fetch rejection tests,
schema-push redaction test, support/validation fixtures, synthetic customer-journey
script and specification/register/documentation marker locations. SQL files in
the inventory are schema/migration files; the filename inventory contains no
`.env`, PEM/P12, SQLite or dump files. The CSV is the requirements register.
Filename screening alone cannot rule out data hidden in other file types.

The workflow's database credentials serve an ephemeral GitHub Actions PostgreSQL
service, and checkout disables persisted credentials. Those literals are not
evidence of a leaked live account. Changing them would not remediate a demonstrated
live credential exposure.

The product roadmap/specifications and ordinary Git identity metadata were
available through history. Their availability must not be confused with a
confirmed theft, anonymous clone, or disclosure of customer records. Do not
rewrite history to remove them as part of this audit.

## GitHub traffic and audit limits

- Clone and view endpoints returned HTTP 200, each reporting `count=0`,
  `uniques=0`, with daily entries from 31 October through 13 November.
- Fork listing returned HTTP 200 and zero entries; current repository metadata
  also reports zero forks.
- Events returned three records: one public event and two PR events. Events
  are not an audit log of content reads.
- Secret-scanning alerts returned HTTP 404 with the explicit message **“Secret
  scanning is disabled on this repository.”** This is unavailable coverage, not
  zero alerts. No paid feature was enabled.
- Owner type is `User`, not an organization. No organization/enterprise audit
  log is applicable to this personal repository through that API. An owner
  security-log export was not provided or accessed; the owner's account security
  log may provide additional visibility-change context, not a complete record
  of anonymous downloads.

Traffic is a rolling aggregate, may lag, does not identify all readers, and is
not a record of every raw/API/archive request. In particular, the documented
unsigned API read and specification import succeeded despite zero traffic totals.
Zero reported clones/views/forks therefore **cannot establish zero copies**.
Detached forks, caches, downloaded archives, deleted refs, remote unreachable
objects and third-party mirrors are not excluded by these results.

## Current-source scanner results and remaining security work

All three platform scanners completed:

| Scanner | Result |
| --- | --- |
| Dependency / OSV | 0 critical, 10 high, 10 moderate, 2 low |
| Static code analysis | 0 results; `incomplete=false` |
| Privacy/dataflow | 0 reported vulnerabilities |

Redacted package/advisory IDs, versions, fixes and locations are in
`evidence/public-exposure-platform-scans.json`. All dependency locations are
`pnpm-lock.yaml`. Highest priorities:

- `body-parser` 2.3.0: compressed-request denial of service.
- `postcss` 8.4.31: file/source-map disclosure advisories.
- `undici` 7.29.1: TLS-validation bypass, cross-origin cache disclosure and
  process-crash advisories.
- `uuid` 9.0.1: buffer bounds risk.
- `zod` 3.25.76 and 4.6.5: oversized-collection resource exhaustion.

These are scanner findings, not reproduced exploits. Assess reachability and
direct/transitive dependency ownership, then upgrade compatible parents/packages
and rerun the relevant checks. Major-version changes (notably uuid and Zod v3)
need compatibility testing. Dependency remediation is separate from correcting
a confirmed exposed credential; no blanket package upgrades were made here.

## Remediation, uncertainty and release boundaries

The privacy correction was already in place and remains verified. No confirmed
operational secret was found to rotate. If a later finding confirms one, stop
using it and use the secure environment-secrets workflow for **owner-approved
provider revocation/rotation**, without printing values; preserve incident
evidence and assess provider access logs. Merely changing a workspace value does
not revoke an old provider credential.

Not examined: ignored/untracked local files, runtime environment values, database
rows, App Storage, third-party logs/copies, historical deleted refs not retained
locally, Actions logs/artifacts, PR comments/attachments, releases/assets, or
encoded/encrypted/compressed payload contents. These results neither certify
those surfaces nor authorize accessing real customer data.

Remaining decisions/risks:

1. Owner classification of publicly reachable internal planning and Git identity
   metadata; if contractual confidentiality applies, assess incident response
   obligations without claiming this audit makes that legal determination.
2. Reported dependency vulnerabilities and lack of independent full-history
   secret scanning remain security-review work.
3. Prior copies remain unknowable from this evidence. No deletion assurance is
   possible from making the repository private.
4. Existing source-rights, legal currency, privacy/processor, release and
   infrastructure blockers stay in force. No public launch, live/recurring
   payments, confidential customer data or new paid commitments are authorized.

History was preserved, and no push, force-push, repository visibility change,
billing change or production deployment was performed.

## Verification of this deliverable

Eight synthetic detector smoke cases passed, one for every rule; result objects
contained only location/rule fields and no matched values. Evidence assertions
confirmed the 27-commit/661-blob scope, inclusion of all enumerated PR tips and
all 464 GitHub feature-tree blobs, and an unchanged starting HEAD.
`git diff --check` passed. No application behavior changed, so no workflow restart,
browser test or deployment was needed.
