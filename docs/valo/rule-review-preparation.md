# A rule on the reviewed route

This note is for the person who runs commands in the development environment. It covers the reviewed
route for a requirements-check rule prepared in the repository: building it into a candidate that is
ready for its two AI reviews, running those reviews, releasing the rule once both have passed, and
restoring an earlier version ([the reviewed route](../architecture/reviewed-route.md), part 3).

Preparing calls no AI model, approves nothing and releases nothing. The reviews run only under a
package of rule reviews the owner approves. Today no rule is kept at all: see "Why every rule is held
today" below.

## What must be in place

1. **The drafting login.** Apply its migration and enable it as
   [the drafting login note](migration-drafter-login.md) says, and give the command its connection
   (`VALO_DRAFTER_DATABASE_URL`). Without it the command stops with `VALO_DRAFTER_LOGIN_UNAVAILABLE`
   before it reads, renders or keeps anything.
2. **A watch on each official address the rule rests on**, checked by the daily source check within
   the last day. These are the addresses the owner's panel shows for the rule (Staff → System →
   "Requirements check: rule sign-off"), and the same watches serve both routes.
3. **The guidance policy as the owner approved it.** A rule is released under the guidance policy, on
   either route. If the policy file is edited, that approval ends, and the command holds the rule.

## Running it

From the repository root:

```sh
pnpm --filter @workspace/api-server exec tsx src/scripts/finite-inference-run.ts --prepare-rule-candidate <rule>
```

`<rule>` is the rule's id, as the owner's panel shows it: `cac-business-name-814`,
`ndpa-27-collection-information`, `ntaa-11-company-return` or `nafdac-f33-product-registration`.

## What it prints

One line of JSON. Its `state` is one of two.

- `held`: the rule is not ready. `reasons` lists what holds it, apart from the two reviews. No
  candidate is kept. Fix the cause and run the command again.
- `awaiting_reviews`: nothing but the two reviews holds it. The candidate is kept as a private file.
  It appears in the staff Content area, in the list headed "Templates, guides and rules awaiting their
  reviews". `id` and `candidateArtifact` name it.

`version` is the rule's next version: the number after every version either route has stored. If the
owner signs a version of the rule under that number first, the candidate's review ends, and the list
says so; prepare it again.

## Its two reviews

The reviews are AI checks: a factual check and a separate challenge, each given the rule, its scenarios,
its records and its sources, and neither the other's verdict. They are never legal, tax or regulatory
review. Run each command from the repository root, as above.

1. `... finite-allocation-approval.ts prepare <package.json> --rule-pairs` writes a package of the rules'
   kind. It admits the review pairs of the four rules and nothing else, and no other package admits
   them. Only the owner approves it, with `approve`, as any package; approving it allows spending up to
   the allocation's cap.
2. `... finite-inference-run.ts --prepare <package id> --candidate=<artifact id>:<sha256>` plans the
   pair for a prepared rule and writes the private report. It calls no model. `--prepare new
   --rule-pairs --candidate=…` plans it under a new package of the rules' kind, for the owner to
   approve.
3. `... finite-inference-run.ts --admit <report id> <sha256> [<version id>]` admits the pair under the
   approved package. It calls no model and reserves nothing.
4. `... finite-inference-run.ts --execute <batch id>` sends the two reviews and prints the run report,
   with `publicationAccepted: false`. Their attempts are recorded on review's own login
   (`VALO_REVIEWER_DATABASE_URL`).

Before admitting the pair, and again before sending it, the rule is built again from its own sources
and records and must be exactly the candidate that was kept. What stops it:

- `SOURCE_CURRENT_CAPTURE_REQUIRED`: a copy the rule is bound to is no longer the current one, or was
  not checked within the last day. Its release will ask for the same. Wait for the daily source check,
  or prepare the rule again.
- `SOURCE_PASSAGE_SNAPSHOT_MISMATCH`: that copy no longer holds the rule's passage or its quotations.
  Prepare the rule again.
- `SAVED_PLAN_INPUT_CHANGED` or `SAVED_PLAN_MECHANICAL_HOLD`: the rule, its records or the guidance
  policy have changed since the candidate was kept, or something now holds it. Prepare it again.
- `CANDIDATE_ALREADY_SAVED`: a version of the rule is stored under its number. Prepare it again.
- `CANDIDATE_UNAVAILABLE_OR_STALE`: the candidate's review date has passed. Prepare it again.
- `WORK_OUTSIDE_PACKAGE`: the package is not of the rules' kind.

## Releasing a reviewed rule

Once both reviews have run, the rule's release request is assembled from that run, then planned and
applied. Run each command from the repository root, as above.

1. `... rule-release.ts request <batch id> <result artifact id> <sha256> [--reason "<what changed>"]`
   reads the report `--execute` printed. It builds the rule again, checks each review against the
   batch, and makes the rule's bundle with both reviews. It calls no model and releases nothing. It
   prints one line of JSON:
   - `state: "ready"`: the request is kept as a private file, named by `request`, with the rule's
     `manifestHash`.
   - `state: "held"`: a review held, or found something. `reasons` lists what the gate holds, and
     nothing is kept. Prepare the rule again for another pair of reviews.
   A version that replaces a released one needs `--reason`, of 20 to 1,000 characters: the businesses
   that saved a result under the earlier version are told it.
2. `... rule-release.ts plan --request=<id>:<sha256>` plans the release: whether the registry would
   admit it, its scenarios, and how many saved profiles' results would change. It changes nothing.
3. `... rule-release.ts apply --request=<id>:<sha256> --confirm <manifest hash>` releases it as the
   rule's next version. Its sources' copies are checked again first.

What stops it:

- `REVIEW_NOT_SETTLED_BY_APPROVED_BATCH`, `REVIEW_BINDING_CHANGED` or `REVIEWS_NOT_INDEPENDENT`: a
  review is not the one the batch settled for this candidate. Use the report `--execute` printed.
- `RULE_RELEASE_REASON_INVALID` or `RULE_RELEASE_REASON_REQUIRED`: the reason is too short or too long,
  or a released version is being replaced without one.
- `RULE_RELEASE_BLOCKED:<reasons>`: the plan is not ready, for the reasons given.
- `RULE_RELEASE_NOT_CONFIRMED`: the hash given to `--confirm` is not the request's manifest hash.
- `RULE_RELEASE_VERSION_CHANGED`: another version of the rule was stored first. Prepare it again.
- The stops of the section above, since the rule is built again first.

## Restoring an earlier version

`... rule-release.ts restore <rule> <version>` prepares a stored version of the rule, earlier than its
latest, as its next version: that version's words, condition and calculation, with the repository's
sources, claims, scenarios and records, built from today's copies of its sources. It prints one line of
JSON, as the preparation above does, with `restores` naming the version. Then run its two reviews and
release it as above: its release request's reason begins "Restores version N of this rule", and
`--reason` adds to it.

What stops it:

- `RULE_VERSION_UNKNOWN`: no version of the rule is stored under that number.
- `RULE_VERSION_ALREADY_CURRENT`: that is the rule's latest version.
- `RULE_RESTORE_SOURCES_CHANGED`: that version quotes its sources otherwise than the repository does.
  Restore its text by preparing it in the repository.
- A failed critical scenario, at `plan`: the restored rule must give today's scenarios their results.

## Why every rule is held today

Each rule's rights record adopts each version's wording by the development owner's signature, and this
route has none. So the command holds all four rules with "No rights record covers this rule on the
reviewed route", and the gate's `rights_not_cleared`. This is the owner's to decide: whether a version
released on this route is adopted, and on what basis. Until then, release a rule on the owner's
sign-off.

Other reasons you may see:

- "… has no copy of its official source checked within the last day": the daily source check has not
  read the address, or read it more than a day ago. Check the watch.
- "Today's copy of … does not hold passage …", or "… does not hold the words the rule quotes": the
  official copy has changed. The rule's passages are checked again before it is released on either
  route.
- A reason from the text's amendment record: the record is out of date or leaves something open. It
  is renewed by searching again, as `guidance-amendments.ts` records.
- `check_not_passed:<check>`: one of the rule's ten mechanical checks failed on the exact candidate.
