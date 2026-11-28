# A template that states the law, on the reviewed route

This note is for the person who runs commands in the development environment. It covers preparing a
template whose words say what Nigerian national rules require, such as TPL-31, the data processing
agreement, for its two AI reviews ([the reviewed route](../architecture/reviewed-route.md), part 4).

Preparing calls no AI model, approves nothing and releases nothing. Its two reviews, and its release,
are not built yet. Today no such template is kept at all: see "Why every such template is held today"
below.

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
AI reviews that follow will not be either.
