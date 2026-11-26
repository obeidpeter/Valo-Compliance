# The security baseline

Design for the finishing plan's Phase 7 row "The security baseline. No mapping to OWASP ASVS exists,
only scans and tests. Write control, code and cited test for each, with a check that the citations
exist", for SEC-001 to SEC-008. It is a proposal under the owner's delegation of 24 November.

The map is Valo's own. It is not an assessment, a verification or a certification, and nothing in it
accepts a requirement. The register names "Security / independent assessor" as the owner of each of
SEC-001 to SEC-008, and gives each the same risk: "Passing builds and generic scans are not
independent security acceptance." The map is for that assessor to start from.

The baseline, verbatim from the specification (VALO-TRD-001 v1.1, section 20, "Security and abuse
prevention"): "Use OWASP ASVS Level 2 as the proposed application-security verification baseline.
Map applicable controls to evidence; do not claim certification merely because a scanner was run.
[S19]" Its source S19 is "OWASP: Application Security Verification Standard", and the source context
adds: "Level 2 is a proposed Valo target, not a certification claim."

The requirements it bears on, verbatim from the specification:
- SEC-001, "Object-level authorisation": "Validate tenant membership and specific resource permission
  in every API, background job, search query and download. Accept: automated negative tests enumerate
  cross-tenant ID substitutions across all private entity types."
- SEC-002, "Transport, storage and secrets": "Require HTTPS, secure cookies, managed encryption at rest
  and protected secrets. Accept: no secret-bearing client bundle; sensitive backups and storage objects
  are not publicly addressable; rotation tests pass."
- SEC-003, "Input and output controls": "Use parameterised database access, schema validation,
  sanitised rich text and a restrictive content-security policy. Apply CSRF protection to
  cookie-authenticated mutations. Accept: stored/reflected XSS, injection and cross-site mutation tests
  pass."
- SEC-004, "Renderer and network isolation": "Render only approved templates and sanitised content;
  disable remote network access in the PDF worker unless explicitly allowlisted. Accept: document text
  cannot fetch cloud metadata, local files, private URLs or execute embedded script/macros."
- SEC-005, "Abuse and quotas": "Start with configurable ceilings: anonymous reads 60/min/IP,
  authenticated reads 120/min/user, AI 5/min, checkout and export creation 10/min/user plus account
  limits. Accept: legitimate errors explain recovery; distributed abuse and financial-cost spikes
  trigger alerts."
- SEC-006, "Privileged operations": "Require staff MFA, least privilege and time-bounded break-glass
  access. Isolate drafting, review and publisher service credentials. Accept: no actor bypasses content
  gates or accesses private drafts without permission; automation cannot grant roles, change policy or
  suppress its own audit evidence."
- SEC-007, "Vulnerability management": "Scan code, dependencies and secrets on each merge;
  independently review before public launch. Accept: no open critical or high exploitable issues in
  launch paths, with lower-severity exceptions owned and time-bound."
- SEC-008, "Monitoring and response": "Alert on repeated denied access, bulk exports, role changes,
  signature failures and unusual payment/AI activity. Accept: a tabletop incident demonstrates
  containment, evidence preservation, privacy escalation and customer communications."

## What there was

- **Scans and tests.** Every merge runs the dependency and secret checks and the static checks with
  their canary. The tests for SEC-001 to SEC-008 run in CI and are cited in the CI evidence register:
  the tenant substitution tests, row-level security, the cross-site, stored markup and reflection
  tests, the renderer's isolation, the limits, staff roles and fresh factors, and the incident
  rehearsal.
- **No map.** Nothing said which of the standard's requirements Valo meets, which it leaves to the
  identity provider or the host, which do not apply, and which it does not meet.

## The standard

- **OWASP ASVS 5.0.0**, of May 2025. On 26 November 2026 the project's own README names 5.0.0 as the
  latest stable release, and 5.0.1, a patch, as the next.
- **Levels 1 and 2**: the 70 requirements of Level 1 and the 183 more of Level 2, 253 in all. Level 3
  is left out: the specification proposes Level 2.
- **Identifiers** in the form the standard asks other documents to use, `v5.0.0-<chapter>.<section>.<requirement>`,
  so a later version's renumbering cannot change what one means.
- **Its text stays at the source.** The standard is licensed CC BY-SA 4.0. The register holds only
  its identifiers and levels, and Valo's own words about Valo; read each requirement in the standard.
- **The file read**: the standard's own CSV at
  `https://github.com/OWASP/ASVS/raw/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv`,
  whose SHA-256 the register records. The check pins the list's own digest: the SHA-256 of one line
  `<identifier> <level>` for each Level 1 and 2 requirement, in the file's order. To recompute it from
  the file:

  ```sh
  python3 -I -c 'import csv,hashlib,sys; r=[x for x in csv.DictReader(open(sys.argv[1],encoding="utf-8")) if x["L"] in ("1","2")]; print(hashlib.sha256("".join(x["req_id"][1:]+" "+x["L"]+"\n" for x in r).encode()).hexdigest())' OWASP_Application_Security_Verification_Standard_5.0.0_en.csv
  ```

## The register

`docs/registers/security-baseline.json` holds one entry for each requirement, in the standard's
order. Each has its identifier, its level and a status, the Valo requirements it bears on, and:

| Status | What the entry holds |
| --- | --- |
| met | Valo's control, the code that holds it, and the tests or CI steps that show it |
| partly met | the control, its code, what shows the part that is done, and the gap: what is not done or not shown |
| untested | the control and its code, and the gap: no test or CI step shows it yet |
| not met | the gap: what is needed |
| not applicable | the reason: Valo has nothing the requirement is about |
| identity provider | the reason: what the sign-in provider does for Valo and what the launch review must check; and what Valo does itself |
| host | the reason: what the hosting platform must do once one is chosen, to check at launch |

- **Evidence is what CI runs.** A test counts only if the CI evidence register cites it, so its job
  fails when it does not pass (decision 0010). A CI step counts only if the workflow runs it in the
  named job, so a failure fails the job. This change cites 25 tests for the first time, the map's
  own check among them.
- **Code is named by path**, and where one function holds the control, by `path#symbol`, which must
  be found in the file. A path that moves breaks the check, so the map cannot go quietly stale.

## The check

`scripts/src/valo/security-baseline.test.ts`, in the foundation job's scripts suite, fails when:
- the register's entries are not the standard's 253 Level 1 and 2 requirements, at their levels, in
  its order;
- an entry's status is not one of the seven, or it lacks what its status needs;
- a path does not exist, or a named symbol is not in its file;
- a test is not cited in the CI evidence register, or a step is not in its job;
- an entry bears on a requirement the register does not hold, or none, unless it does not apply;
- an entry's words begin as the standard's do ("Verify that"), the sign of text pasted from it;
- the design's count for a status differs from the register's, or the design leaves out a requirement
  that is not met.

A fixture test shows each of these failing. What the check cannot judge is whether a control meets
its requirement: an entry can still claim more than its evidence shows. That is the assessor's to
judge, and the reason the map is not an assessment.

Two more tests in the same file hold what the map counts on:
- **The linter keeps refusing** `eval`, code built from strings, raw HTML in JSX and `javascript:`
  addresses in JSX, as the lint step applies its configuration (1.2.2, 1.3.2, 3.2.2).
- **No address carries a secret.** No path or query parameter in the API contract is named as a
  token, key, secret or password (14.2.1).

And the reflection test (`routes/valo-reflection.integration.test.ts`) now also requires of every
answer HSTS for a year, a same-origin referrer policy and, for text, its character set; sends each
query value twice and keys that would reach every object's prototype, and finds the prototype
unchanged; and sends every read in the contract, as each kind of caller, and finds no table changed
but the counts reads keep (3.4.1, 3.4.5, 4.1.1, 15.3.6, 15.3.7, 3.5.3).

## What the map finds

| Status | Requirements |
| --- | --- |
| met | 59 |
| partly met | 41 |
| untested | 21 |
| not met | 5 |
| not applicable | 63 |
| identity provider | 54 |
| host | 10 |

- **Not met**: a key management policy (v5.0.0-11.1.1) and an inventory of keys and algorithms
  (v5.0.0-11.1.2); protection levels for sensitive data, and requirements for each (v5.0.0-14.1.2);
  an inventory of what is logged, where, for whom and for how long (v5.0.0-16.1.1); and logs sent to a
  system apart from the machine that wrote them (v5.0.0-16.4.3).
- **Not applicable** are mostly whole chapters Valo has nothing of: OAuth and OpenID (Valo is neither
  a server nor a client of its own; sign-in is the provider's), WebRTC, GraphQL and WebSockets; and
  LDAP, XPath, LaTeX, JNDI, memcache, SAML and encryption in Valo's own code.
- **The identity provider's**: passwords, second factors, recovery, session lifetimes and the
  sign-in cookies. Valo's own part around them is mapped where it has one: it confirms each session
  with the provider, live on sensitive routes and at least once a minute elsewhere, and staff routes
  require both factors, verified recently.
- **The host's**: TLS, certificates, redirects at the edge, request boundaries at the load balancer,
  a network allowlist and the database's transport.

What is left falls to the plan's later rows and to the launch:
- **Small hardening** (Phase 7): HSTS on static files and subdomains once the domain is known; a
  policy of `default-src 'none'` and `frame-ancestors 'none'` on the API's answers; tests that read
  the web server's own headers and content types; a rule against starting a shell; no redirects on
  storage and source downloads; strict equality in the linter; tests of the staff upload's refusals,
  the authorized party, TRACE and a folder address; a check of the built image for `.git`; time frames
  and an owner for advisories; a software bill of materials.
- **Alerts that reach a person** (Phase 7): logs to a system of their own, and an inventory of them.
  Each request's log line now names its route (16.2.1), and refused input is now counted as a security
  event (16.3.3).
- **Documents**: the key policy and inventory, protection levels, field-level authorization rules,
  the ways in with the strength each needs, and the staff upload's limits; and, in the processor
  review, the host the identity provider's script sends its telemetry to (`clerk-telemetry.com`),
  which the pages' policy allows.
- **The launch review**: the identity provider's settings and the host's, for the 64 entries that are
  theirs.

## What does not change

No application code changes, and no migration. The register and its check are records and a test.

## Settled while building it

- **Level 2, not Level 1.** The plan row did not name a level; the specification proposes Level 2,
  so the map takes Levels 1 and 2.
- **Untested is a status of its own.** A control in the code that no test shows is neither met nor
  missing; calling it met would claim what no check shows, and calling it not met would hide that it
  is built.
- **The identity provider's and the host's are their own statuses**, not "met": Valo has not verified
  either's settings, and the reason says what the launch review must read.
- **Evidence is only what CI runs on every merge**: cited tests and workflow steps. A probe run by
  hand, a document or a review is not evidence here.
- **A test that passes shows the control behaves as the test asks**, not that it meets the
  requirement. Where a test covers part, the entry is partly met and says which part.
- **The reflection test's own reads count for a visitor of their own**, named in `X-Forwarded-For` as
  the web server's page renders do, so the tests before it in the database job cannot use up its read
  limit, nor it theirs.

## The owner's points

1. **The independent assessor.** The map is for them; nothing here is their assessment, and the
   register names them as SEC-001 to SEC-008's owner.
2. **A second factor for customers** (v5.0.0-6.3.3). Staff must use both factors; customers sign in
   with one. Level 2 asks for more than one for everyone. Requiring it is the owner's decision.
3. **The minute after a session ends** (v5.0.0-7.4.1, v5.0.0-7.4.2). Sensitive routes refuse an ended
   session or a disabled account at once; everyday routes do within a minute, when Valo next asks the
   provider (decision 0003). Asking on every request would cost a provider call each time.
4. **The staff area's own hostname** (v5.0.0-3.5.4). The staff area is part of the one application, on
   its origin. If the assessor counts it as an application of its own, it needs a hostname of its own.
5. **The launch review** reads the identity provider's settings and the host's for the 64 entries
   that are theirs, and records what it finds.
