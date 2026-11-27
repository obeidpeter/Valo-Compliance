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
- **A rotation runbook** (`docs/valo/secret-rotation.md`): each secret the registry lists, and the
  operator's backup secrets, with who holds it, how to rotate it, what rotating it changes, and how to
  revoke it in an emergency.
- **A rehearsal in CI** for each of the four logins (`artifacts/api-server/src/platform/login-rotation.test.ts`,
  foundation job): the work stops with the login's own code while the database still has the old
  password; rotated with its script, the old password is refused and the new one works; revoked in an
  emergency with its sessions ended, the work that needs it stops with its own code and the process
  carries on; restored, the work goes on.
  - It runs on a PostgreSQL cluster of its own that asks for passwords, with every migration applied,
    not on the job's own database: a login belongs to the whole cluster, so rotating it there would
    change it under the job's other tests.
- **What designing the rehearsal found, and slice 2 fixed:**
  - A login the database refused (a wrong password or a revoked login) failed with PostgreSQL's own
    error, not the login's code. Each login's pool now gives such a refusal the login's code
    (`lib/db/src/login-pool.ts`), and the workspace login's gives the scope's. The worker's record of
    a preparation reads the code under a failed query too.
  - No pool listened for an idle connection's failure. pg-pool emits it on the pool, and an emitter's
    error with no listener throws, so ending a login's sessions in an emergency, or a database restart,
    would have stopped the API or the worker. Every pool now reports such a failure, and the API and
    the worker log it as `db.connection_failed`, by its login and code.

### Part 2: limits as settings (SEC-005)

- Each ceiling becomes a setting in the registry, with its present value as the default and bounds the
  code already holds (1 to 10,000). The inline ceilings join the table.
- A value outside its bounds stops the server at start, as other settings do.
- Tests: the defaults are today's ceilings; a configured value is the one a request meets.

Built (slice 5), with a note of every limit ([request limits](../valo/request-limits.md)):
- **The settings.** Each of the 23 ceilings has a setting of its own in the registry, `VALO_LIMIT_`
  and its bucket's name, with today's ceiling as its default and its example (`lib/valo-quota-policy.ts`,
  `quotaLimit`). Unset or empty, a setting gives the default. Its value must be a whole number from 1
  to 10,000, written plainly.
- **The inline ceilings join the table**, each with a bucket of its own:
  - staff support actions (20 a minute, 200 a day). They had shared customers' support buckets, with
    their own ceilings written where they were counted;
  - public support requests from one network address (20 and 100), and from everyone together (100
    and 1,000);
  - refunds (10 and 50), whose buckets were in the table already but whose ceilings were written
    again where they were counted.
- **At start.** The API and the worker read every limit before anything else they do: a value outside
  its bounds stops either one, naming the setting.
- **Where requests meet them.** Every count reads its ceiling from its setting, and so do the worker's
  alerts on callers at a limit.
- **The tests:**
  - the defaults are today's ceilings, every setting is registered, and a set value is read;
  - each value outside the bounds is refused;
  - the real API entry stops at start on one, before it listens;
  - the shipped worker stops on one before any effect;
  - in the database, a ceiling set by its setting is the one the count meets.

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

Built (slice 4), with a note of the time frames and the bill
([dependency advisories](../valo/dependency-advisories.md)):
- **Owners and dates** (`scripts/src/valo/security-reports.ts`):
  - the owner of a record is a role the specification names, the Engineering lead or the Security
    lead;
  - a reviewed exception names its owner and is reviewed again within 30 days of its review. The
    design gave no bound; 30 days is a development default, as the others are;
  - a moderate or low advisory is recorded in a list of its own, at its severity, with its owner, the
    day it was recorded and the day to fix it by.
- **What the merge check refuses:**
  - an advisory not recorded, or recorded at another severity;
  - a record without its owner, with a malformed date, made after the day of the check, or ending
    beyond its time frame;
  - a record past its date, even once the audit no longer reports the advisory, so a fixed one's
    record is removed.

  Both lists are empty: the audit reports no advisory of any severity.
- **The weekly run:** on Mondays at 05:41 UTC the workflow runs its two scan jobs, and its other jobs
  skip a scheduled run. A test reads the workflow and keeps it so.
- **The bill:** the dependency job makes a CycloneDX bill of materials from the lockfile and keeps it
  with the run.
  - It lists every package with its registry address, checksum and dependencies, and whether it is
    needed at run time.
  - A package from anywhere but the registry, or without a checksum, stops it.
- **The image check** lists every file in each image and finds no `.git`, `.svn` or `.hg`. It must find
  the image's own files first, so it cannot pass by reading nothing.

### Part 4: code rules

- Strict equality in the linter, with comparisons to null allowed (the only loose comparisons today).
  Built (slice 3a): `eqeqeq` in `.oxlintrc.json`, and the baseline's linter test requires it.
- A repository rule against starting a shell: product code may not use `exec` or `execSync`, nor pass
  `shell` to `spawn` or `execFile`. Built (slice 3a): `no-shell` (`scripts/src/valo/architecture-check.ts`)
  reads the API's, the web app's and the libraries' product code, `scripts/src`, `scripts/ops` and the
  database scripts, TypeScript and JavaScript modules alike. It refuses `exec` and `execSync` taken
  from `child_process` by import, `require` or a dynamic import, and, in a file that takes anything
  from it, any `shell` option, since a call can reach the option through a wrapper such as
  `promisify`. Nothing in the repository did either.

### Part 5: HTTP

- The API's answers carry `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.
  Built (slice 3a), and the reflection test requires it of every answer. The identity provider's
  answers, passed through its proxy, keep the provider's own policy: they are its scripts, its JSON
  and its redirects, and a policy that runs nothing is not Valo's to set on them. The proxy's test
  shows both.
- Tests read the web server's own headers and content types: nosniff, the referrer policy, the policy
  and the content type of pages and static files. Built (slice 3a), in the compiled frontend's check
  in the foundation job: every page, a script of the build's, an image and a text file.
- Tests send TRACE, and ask for a folder, of the API and the web server. Built (slice 3a): the
  reflection test for the API, and the compiled frontend's check for the web server. What they found:
  - The API answers TRACE, its own folder and two others with a JSON 404, as an address it does not
    have, and repeats nothing sent.
  - The web server sends a folder of its build's files to the same address without the slash, which
    the app's own page answers, listing none of the folder's files.
  - The web server answers TRACE with 405 for a file, and with its error page, a 500, for a page: the
    runtime of Next's middleware refuses the method before Valo's code runs, so the middleware cannot
    answer it. Neither repeats what was sent. A 405 for pages would take a server in front of Next,
    of Valo's own or the host's, and is left to the launch.
- Storage probes refuse redirects. Official sources keep following up to three redirects on their own
  host, over https, with each hop checked: that is intended, and the baseline's wording is corrected.
  Built (slice 3b):
  - every anonymous probe of private storage now goes through one function
    (`platform/anonymous-object.ts`), which takes a redirect as its answer. The production storage
    probe already did; the three others followed redirects, as `fetch` does by default;
  - its test asks a server of its own, whose first answer is a redirect, and finds the probe never
    asks for the redirect's target. A second test finds no other product source addressing the
    storage service.
- Tests give the staff upload a file over its limits, a file whose content is not its kind, a Word
  package over its limits and a Word file with an entity. A note records the upload's limits and what
  happens to a refused file. Built (slice 3b): `modules/manual-library/files.test.ts`, with every file
  made in the test, and [the staff upload's limits](../valo/staff-upload-limits.md). The upload runs
  no XML parser: it reads a document's text with patterns, so no entity is ever expanded, and it
  refuses a declared one before reading.
- A test presents a sign-in token made for another site, where the identity provider's library allows
  one to be made without its servers. Built (slice 3b): the identity middleware moves from `app.ts`
  to `middlewares/identity.ts`, unchanged, so the test uses the API's own. Given a synthetic
  instance's key, the library checks a token itself. A token made for Valo's site signs its holder
  in; one made for another site or for none, signed with another key or past its time, signs no one
  in.

## What does not change

- HSTS on static files, and a policy for subdomains, wait for the production domain.
- No secret, password or key value is written anywhere; the rehearsal uses the job's synthetic ones.
- Nothing reaches an outside service.

## Slices

| Slice | What | State |
| --- | --- | --- |
| 1 | Part 1's bundle check | Built |
| 2 | Part 1's rotation runbook and the logins' rehearsal | Built |
| 3a | Part 4, and Part 5's policy, headers, content types, folders and TRACE | Built |
| 3b | Part 5's storage redirects, the staff upload's refusals and the token made for another site | Built |
| 4 | Part 3: advisories, the scheduled scan, the bill of materials and the image check | Built |
| 5 | Part 2: limits as settings | Built |

## The owner's points

1. **Time frames for advisories**: 30 days for moderate and 90 for low are proposed, and a reviewed
   critical or high exception is reviewed again within 30 days.
2. **The scheduled scan** runs once the workflow reaches `main`. So do Dependabot's weekly update
   proposals, which GitHub also reads from `main`.
3. **A time frame for routine updates**, when no advisory needs one, is not set.
4. **The limits' production values**: today's ceilings are development defaults. Each is a setting, so
   the production values can be set without a change to the code.
