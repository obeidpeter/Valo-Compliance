# Logins of their own for drafting and review

Design for the finishing plan's Phase 7 row "Logins of their own for drafting and review, as the
publisher has", for SEC-006. It is a proposal under the owner's delegation of 24 November.

The requirement, verbatim from the specification: SEC-006, "Privileged operations": "Require staff
MFA, least privilege and time-bounded break-glass access. Isolate drafting, review and publisher
service credentials. Accept: no actor bypasses content gates or accesses private drafts without
permission; automation cannot grant roles, change policy or suppress its own audit evidence."

## What there is

- **Three logins.**
  - The application's own (`DATABASE_URL`), which owns the tables.
  - Customer requests' (`valo_workspace_login`), which may become the workspace scope and nothing else
    (decision 0008).
  - The publisher's (`valo_publisher_login`), which may become the publisher role and nothing else.
    The database publishes a content version only in a session that logged in as it, and its
    connection string goes only to the command that publishes (decision 0017, point 6).
- **Drafting runs on the application's login.**
  - Three code paths add content: the template preparer (`modules/editorial/operational-preparation.ts`)
    and the guide preparer (`guidance-preparation.ts`) add a prepared candidate or a candidate version,
    and the reviewed route's command (`ai-lanes/inference-reviewed-publication.ts`) adds a version with
    its two reviews.
  - Each switches to the drafter role (`SET LOCAL ROLE valo_content_drafter_dev`) for that one insert.
  - The operator commands that prepare run them, and so does the worker's preparation job. The API
    only asks for a preparation (`valo_source_review_preparations`); the worker carries it out.
  - No login is a member of the drafter role. The application's login reaches it because it is a
    superuser in CI ("That login can switch to any role", decision 0017). So anything holding the
    application's connection string, the API included, can add a candidate.
- **Review runs on the application's login too.**
  - The reviewed route's AI reviews (`modules/editorial/operational-review.ts`) record their attempts in
    `valo_publication_ai_attempts`, and keep each review's record in object storage.
  - The editorial pipeline (`modules/editorial/pipeline.ts`) reserves its three runs, one drafting and
    two reviewing (`draft`, `factual`, `challenge`), in one statement in `valo_editorial_runs`.
  - The finite dispatcher records every lane's spend in the inference ledger, through its functions.
  - The reviewer role (`valo_content_reviewer_dev`) can read policies, versions and source snapshots,
    and records nothing.
- **What already keeps the gates.** Only the publisher's login publishes, and the publisher checks a
  candidate's reviews, sources and policy before it does. The drafter and reviewer roles cannot
  publish, and the publisher refuses to act as either.
- **People's reviews are not a service.** The acceptance reviews and the reviewed guides' source checks
  are staff actions through the API, under staff roles, MFA and their histories. They stay so.

## The parts

### Part 1: a drafting login

- **`valo_drafter_login`.** A migration creates it without a login. It may become the drafter role and
  nothing else, and holds nothing of its own (NOINHERIT), as the publisher's does. Each environment
  enables it with a password from its secret store, sent only as a SCRAM-SHA-256 verifier
  (`lib/db/scripts/drafter-login.mjs`), and stores its connection string as
  `VALO_DRAFTER_DATABASE_URL`, which must lead to the application's own database.
- **The database adds content only from it.** A content version, and a prepared candidate, are added
  only in a session that logged in as the drafting login, as a version is published only in the
  publisher's. The application's login is refused, even after switching to the drafter role.
- **Its own connection** (`drafterDb`), which only the three drafting paths use. A repository rule keeps
  other code from naming it, and the API's settings do not read it.
- **Who holds it.** The operator commands that prepare, the reviewed-pair command, which saves the
  reviewed version, and the worker, whose preparation job drafts. The API does not need it, and no API
  code names it. On a self-hosted machine the supervisor gives it to the worker alone, and the
  publisher's connection to neither the API nor the worker. Replit's secrets reach every workflow, so
  there the API's process holds it, though no API code uses it.
- **Found before the work.** Each preparation checks first that drafting can log in, so a missing
  login stops it before it reads, renders, saves or pays for anything. The worker records the login's
  code, `VALO_DRAFTER_LOGIN_UNAVAILABLE`, on a preparation request it could not carry out.
- **Tests add content as drafting does.** A fixture adds a synthetic candidate on drafting's own
  connection (`test-support/drafted-content.ts`). A fixture undone with the rest of its test's own
  transaction cannot use a second connection, so that transaction becomes the drafting login for the
  insert, which only the test cluster's owner, a superuser, may do.
- **The policy a candidate names** stays on the application's login: the preparers record the
  policy's version and hash, and refuse a stored policy whose hash differs. The publisher checks the
  policy again.

### Part 2: a review login

- **`valo_reviewer_login`**, as part 1, for the reviewer role, with `VALO_REVIEWER_DATABASE_URL`.
- **The reviews' records only from it.** The reviewer role gains what recording an AI review's attempt
  needs on `valo_publication_ai_attempts`, and the database records an attempt only from the review
  login. So the drafting login cannot record a review of what it drafted, and the API cannot record one
  at all.
- **The editorial pipeline** reserves a drafting run and two review runs in one statement. Its slice
  either splits them, the drafting run on the drafting login and the review runs on the review login, or
  leaves the pipeline on the application's login and records that as the gap it is.
- **The inference ledger** stays on the application's login, through its functions: it is spend
  bookkeeping for every lane and for customers' drafts, not a review's outcome.

## What does not change

- The publisher's login, its checks and who holds it.
- Staff actions, people's reviews among them, stay on the API under staff roles.
- The application's login still owns the tables, so it can still switch a guard off. A login of its own
  for migrations waits for Phase 8 ([audit trail](audit-trail.md)).
- No AI model is called, and nothing is published.

## Slices

| Slice | What | State |
| --- | --- | --- |
| 1 | Part 1: the drafting login, its guard and connection, the three drafting paths on it, the tests' fixtures through it | Built |
| 2 | Part 2: the review login, and the reviews' attempts only from it | Not built |

## The owner's points

1. **Two more passwords** in each environment's secret store, as the publisher's: the Replit
   development database takes each migration and enables each login by hand, with its runbook.
2. **Who runs the drafting commands** holds the drafting login's connection string, as whoever
   publishes holds the publisher's.
