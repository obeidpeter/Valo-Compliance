# Small hardening

Design for the finishing plan's Phase 7 row "Small hardening: scan the built browser bundle for
secrets; a rotation runbook with a rehearsal; limits as settings; an owner and an expiry on each
advisory exception; a scheduled scan; and the gaps the security baseline finds for this row", for
SEC-002, SEC-005, SEC-007 and OPS-004. It is a proposal under the owner's delegation of 24 November.

The requirements, verbatim from the specification:
- SEC-002, "Transport, storage and secrets": "Require HTTPS, secure cookies, managed encryption at rest
  and protected secrets. Accept: no secret-bearing client bundle; sensitive backups and storage objects
  are not publicly addressable; rotation tests pass."
- SEC-005, "Abuse and quotas": "Start with configurable ceilings: anonymous reads 60/min/IP,
  authenticated reads 120/min/user, AI 5/min, checkout and export creation 10/min/user plus account
  limits. Accept: legitimate errors explain recovery; distributed abuse and financial-cost spikes
  trigger alerts."
- SEC-007, "Vulnerability management": "Scan code, dependencies and secrets on each merge;
  independently review before public launch. Accept: no open critical or high exploitable issues in
  launch paths, with lower-severity exceptions owned and time-bound."
- OPS-004, "Secrets and account ownership": "Keep secrets in environment-specific secret stores and
  managed provider accounts owned by Valo. Accept: no keys in prompts, browser bundles, commits or
  screenshots; rotation and emergency revocation are rehearsed."

## What there is

- **Secret scanning.** Every merge runs gitleaks over the repository's whole history, with a canary
  that must be found (`scripts/src/valo/merge-security.ts`). The web app's build (`artifacts/valo/.next`)
  is ignored by git, so nothing scans what the browser is sent.
- **Rotation.** The four database logins take a new password from their scripts
  (`lib/db/scripts/*-login.mjs`); the privacy keyring and the payment webhook's secret have rotation
  tests. No runbook says how to rotate each secret, what rotating it changes, or how to revoke one in an
  emergency, and nothing rehearses the logins' rotation. The incident procedure says so: "No
  replacement has been rehearsed."
- **Limits.** The request ceilings are one table in code (`lib/valo-quota-policy.ts`); three more sit
  inline (public support, staff support, refunds). None is a setting. The drafting assistant's two
  daily allowances are already the owner's versioned settings.
- **Advisories.** A critical or high advisory blocks a merge unless it is a reviewed exception
  (`REVIEWED_DEPENDENCY_ADVISORIES`, empty today). An exception has no owner and no expiry. Moderate
  and low advisories are counted and never block.
- **Scheduled scans.** None: the one workflow runs on pushes and pull requests.
- **The baseline's gaps for this row** ([security baseline](security-baseline.md#what-the-map-finds)):
  no policy on the API's answers; no test reads the web server's own headers or content types; no rule
  against starting a shell; storage probes follow redirects; the linter does not require strict
  equality; no test of the staff upload's refusals, of a token made for another site, of TRACE or of a
  folder address; no check of the built image for `.git`; no time frames or owner for advisories; no
  software bill of materials.

## The parts

### Part 1: secrets (SEC-002, OPS-004)

- **No secret in the browser bundle.** After each build of the web app in CI, a check
  (`artifacts/api-server/src/scripts/bundle-secrets.ts`) reads every file the build's static folder and
  the public folder hold, which is what a browser is sent as it is, and fails on:
  - the value of any setting the registry marks secret that is set in that job, at 16 characters or
    longer, so ordinary text does not match;
  - a secret's shape: a payment or identity provider's secret key (`sk_live_`, `sk_test_`), a private
    key, a database connection string with a password.

  A finding names the file and the setting or the shape, never the secret. Before each run the check
  plants a synthetic secret in a scratch copy and must find it, and it fails when the build's own files
  are missing, so it cannot pass by reading nothing. It runs after the foundation job's build, and after
  the database job's production build, where the job's synthetic login passwords and connection strings
  are set.
- **A rotation runbook** (`docs/valo/secret-rotation.md`): each secret the registry lists, who holds
  it, how to rotate it, what rotating it changes, and how to revoke it in an emergency.
- **A rehearsal in CI** on the job's own database, for each of the four logins: rotate the password
  with its script; the old password is refused and the new one works; revoke the login in an
  emergency, and the work that needs it stops with its own code; restore it.

### Part 2: limits as settings (SEC-005)

- Each ceiling becomes a setting in the registry, with its present value as the default and bounds the
  code already holds (1 to 10,000). The inline ceilings join the table.
- A value outside its bounds stops the server at start, as other settings do.
- Tests: the defaults are today's ceilings; a configured value is the one a request meets.

### Part 3: vulnerability management (SEC-007)

- **An owner and a date.** Each reviewed exception names the role that owns it and the date by which
  it is reviewed again. The merge check refuses one past its date, or without either.
- **Lower-severity advisories owned and time-bound.** A moderate or low advisory the audit reports must
  be recorded with an owner and a date to fix it by: 30 days for moderate, 90 for low, as development
  defaults for the owner to confirm. The check fails on one not recorded, or past its date.
- **A scheduled scan.** The workflow also runs the dependency, secret and static checks once a week. A
  scheduled workflow runs from the repository's default branch, `main`, so it starts once the workflow
  reaches `main`, which is the owner's decision.
- **A software bill of materials** made from the lockfile on each merge and kept with the run.
- **The image check** finds no `.git` in either image.

### Part 4: code rules

- Strict equality in the linter, with comparisons to null allowed (the only loose comparisons today).
- A repository rule against starting a shell: product code may not use `exec` or `execSync`, nor pass
  `shell` to `spawn` or `execFile`.

### Part 5: HTTP

- The API's answers carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
- Tests read the web server's own headers and content types: nosniff, the referrer policy, the policy
  and the content type of pages and static files.
- Tests send TRACE, and ask for a folder, of the API and the web server.
- Storage probes refuse redirects. Official sources keep following up to three redirects on their own
  host, over https, with each hop checked: that is intended, and the baseline's wording is corrected.
- Tests give the staff upload a file over its limits, a file whose content is not its kind, a Word
  package over its limits and a Word file with an entity. A note records the upload's limits and what
  happens to a refused file.
- A test presents a sign-in token made for another site, where the identity provider's library allows
  one to be made without its servers.

## What does not change

- HSTS on static files, and a policy for subdomains, wait for the production domain.
- No secret, password or key value is written anywhere; the rehearsal uses the job's synthetic ones.
- Nothing reaches an outside service.

## Slices

| Slice | What | State |
| --- | --- | --- |
| 1 | Part 1's bundle check | Built |
| 2 | Part 1's rotation runbook and the logins' rehearsal | Not built |
| 3 | Part 4 and Part 5: the code rules and the HTTP gaps | Not built |
| 4 | Part 3: advisories, the scheduled scan, the bill of materials and the image check | Not built |
| 5 | Part 2: limits as settings | Not built |

## The owner's points

1. **Time frames for lower-severity advisories**: 30 days for moderate and 90 for low are proposed.
2. **The scheduled scan** runs once the workflow reaches `main`.
