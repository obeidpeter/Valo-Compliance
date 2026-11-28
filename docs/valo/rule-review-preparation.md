# Preparing a rule for its two reviews

This note is for the person who runs commands in the development environment. It covers one step on
the reviewed route: building a requirements-check rule prepared in the repository into a candidate
that is ready for its two AI reviews ([the reviewed route](../architecture/reviewed-route.md), part 3).

The command calls no AI model, approves nothing and releases nothing. Today it keeps no rule at all:
see "Why every rule is held today" below.

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
