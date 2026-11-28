# A template that states the law, on the reviewed route

This note is for the person who runs commands in the development environment. It covers preparing a
template whose words say what Nigerian national rules require, such as TPL-31, the data processing
agreement, for its two AI reviews, the reviews themselves and its release
([the reviewed route](../architecture/reviewed-route.md), part 4).

Preparing calls no AI model, approves nothing and releases nothing. Today no such template is kept at
all, so none can be reviewed or released: see "Why every such template is held today" below.

## What must be in place

1. **The drafting login.** Apply its migration and enable it as
   [the drafting login note](migration-drafter-login.md) says, and give the command its connection
   (`VALO_DRAFTER_DATABASE_URL`). Without it the command stops with `VALO_DRAFTER_LOGIN_UNAVAILABLE`
   before it reads, renders or keeps anything.
2. **A watch on each official address the template rests on**, checked by the daily source check within
   the last day. TPL-31 rests on the Nigeria Data Protection Act 2023 and the Commission's General
   Application and Implementation Directive 2025, the same addresses the privacy guides rest on.
3. **A copy of the AI provider's terms taken within the last day**, as for a guide:
   `capture-provider-terms.ts` writes it ([preparing a guide](guidance-preparation.md) says how).

## Running it

From the repository root:

```sh
pnpm --filter @workspace/api-server exec tsx src/scripts/finite-inference-run.ts --prepare-law-template-candidate TPL-31 /path/to/terms.json
```

Only a template with a claim map is accepted. TPL-31 is the first; the others follow family by family.
Any other template, or a call without the terms file, stops with `FINITE_RUN_ARGUMENTS_INVALID`.

## What it prints

One line of JSON. Its `state` is one of two.

- `held`: the template is not ready. `reasons` lists what holds it, apart from the two reviews,
  `failedChecks` names any mechanical check that failed, and `rightsProblems` says why its rights
  record does not clear it. No candidate is kept.
- `awaiting_reviews`: nothing but the two reviews holds it. The candidate is kept as a private file,
  and appears in the staff Content area among the items awaiting their reviews.

It can also stop before it prints:

- `TEMPLATE_HAS_NO_BOUND_SOURCE`: no capture held the words of a passage the template's claims rest
  on. Wait for the daily source check, then run it again.
- `FRESH_ACTUAL_PROVIDER_TERMS_REQUIRED`: the copy of the provider's terms is more than a day old.

## Its two reviews

The reviews are AI checks: a factual check and a separate challenge, each given the template, what it
assumes and leaves open, its sources whole, the measure of the words it repeats from them and each
text's amendment basis, and neither the other's verdict. A contract is not general content, so each
also runs the five enhanced checks. They are never legal, tax or regulatory review. Run each command
from the repository root, as above.

1. `... finite-allocation-approval.ts prepare <package.json> --law-template-pairs` writes a package of
   this kind. It admits the review pairs of templates that state the law and nothing else, and no other
   package admits them, the templates' own among them. Only the owner approves it, with `approve`, as
   any package; approving it allows spending up to the allocation's cap.
2. `... finite-inference-run.ts --prepare <package id> --candidate=<artifact id>:<sha256>` plans the
   pair for a prepared template and writes the private report. It calls no model. `--prepare new
   --law-template-pairs --candidate=…` plans it under a new package of this kind, for the owner to
   approve. A request that measures more than the policy's limit, 64,000, is refused before it is sent.
3. `... finite-inference-run.ts --admit <report id> <sha256> [<version id>]` admits the pair under the
   approved package. It calls no model and reserves nothing.
4. `... finite-inference-run.ts --execute <batch id>` sends the two reviews and prints the run report.

No person signs each such template (the policy's point 10), so nothing else is asked for. Before
admitting the pair, and again before sending it, the template is built again from its retained draft
and the passages its claim scope records, its ten checks run again under the policy as it stands, and
both its files inspected again. What stops it:

- `SAVED_PLAN_INPUT_CHANGED`: the template's draft, the intake manifest or the policy has changed since
  the candidate was kept. An approval of the policy that has ended is such a change.
- `SAVED_PLAN_MECHANICAL_HOLD`: a check fails now, for instance because a source is no longer current.
- `SAVED_BODY_NOT_EXACT_CURRENT_INTAKE`, `TEMPLATE_CLAIM_SCOPE_MISSING` or `TEMPLATE_CLAIM_SCOPE_CHANGED`:
  the template built again is not the candidate that was kept. Prepare it again.
- `SAVED_PLAN_EXPORT_HOLD` or `SAVED_EXPORT_CHECK_CHANGED`: a file no longer passes its inspection as it
  did.
- `CANDIDATE_ALREADY_SAVED` or `CANDIDATE_UNAVAILABLE_OR_STALE`: a version is stored under its number,
  or its review date has passed. Prepare it again.
- `WORK_OUTSIDE_PACKAGE` or `CANDIDATE_OUTSIDE_PACKAGE_KIND`: the package is not of this kind.

## Releasing it

`... publish-reviewed-pair.ts <batch id> <result artifact id> <sha256>` reads the report `--execute`
printed, saves the template as a version with its two reviews, and hands it to the publisher, which
checks it against the policy for templates that state the law, never the templates' own: the template
built again, its rights record, its ten checks measured again, its two reviews and the enhanced checks
they ran, both files, and a current capture of each source. A template that fails a gate is saved and
held. What stops the release:

- `POLICY_NOT_TRUSTED`: the policy it was prepared under is not the policy as it stands, approved.
- `TEMPLATE_CLAIM_SCOPE_MISSING`, `OPERATIONAL_BODY_OUTSIDE_REVIEWED_ORIGINAL` or
  `MECHANICAL_EXECUTION_ATTESTATION_INVALID`: the version is not the template built again, or a check
  no longer passes.
- `RIGHTS_EVIDENCE_INVALID`: its rights record is not one of its own kind, or has run out.
- `SOURCE_CURRENT_CAPTURE_REQUIRED` or `SOURCE_PASSAGE_SNAPSHOT_MISMATCH`: a copy it is bound to is no
  longer the current one, or no longer holds its passage or a quotation.

Once released, it is shown only while the policy it was released under is that policy as it stands,
approved, and while the provider's permission for its wording is current. An edit to the policy file
ends the approval, and takes every such template off the site until it is released again.

## Why every such template is held today

A template that states the law is released only under the policy for templates that state the law,
[template-law-publication-policy.md](policies/template-law-publication-policy.md), which the owner
approves as a whole, by its checksum. The owner has approved no text of it. Until then the command
prints `held`, with these among its reasons:

- `policy_not_owner_approved`: the policy is not approved;
- `rights_not_cleared` and `check_not_passed:rights`: the rights record's basis is that policy;
- `check_not_passed:scope`: the scope check asks for the approved policy too.

Any other reason is something the template itself lacks: a source not current
(`source_unresolved:<passage>` and `legal_scope_unverified`), a file that failed its inspection, or a
claim no longer bound to its passage. Nothing here is a legal, tax or regulatory review, and the two
AI reviews that follow are not either.
