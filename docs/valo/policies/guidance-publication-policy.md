# Guidance publication policy

Status: **proposed. The product owner has not approved this policy.** No guide can be published
under it until the owner approves it and the approval is recorded in this file
([decision 0017](../../architecture/decisions/0017-clear-guidance-holds.md)).

This policy is for guides that say what Nigerian national rules require. The owner's recorded
authority for templates ([operational-publication-authority.md](operational-publication-authority.md))
says that claims about law need a source-backed policy of their own. This is that policy.

## The policy

1. **What may be published.** General guides about Nigerian national rules and official federal
   processes, starting with GUD-01 to GUD-30. A guide is general information.
2. **Where.** Nigeria as a whole. A guide makes no claim about a state, the FCT or a local
   government until a later decision allows it.
3. **Subjects.** Company and business-name records, tax administration, personal data, consumer
   transactions, food and regulated products, and employment. Every one is treated as high impact:
   the enhanced checks always run.
4. **Every statement of law is tied to its source.** Each sentence that says what the law requires
   is bound to an exact passage of an official text that Valo holds a copy of. A sentence that
   interprets a passage is recorded as an interpretation. A practical suggestion is recorded as
   optional practice and is not presented as a legal duty.
5. **Numbers.** A rate, fee, penalty, threshold or deadline appears only when the quoted passage
   contains that number.
6. **Never.** An opinion on one business's position; a statement that a business complies or is
   exempt; a guarantee; a claim of review by a lawyer, tax adviser, regulator or other
   specialist; a filing made for a customer.
7. **Official text is explained, not copied.** A guide explains in its own words, names the
   section and links to the official address. It does not reproduce official text beyond a short
   quotation: no more than 20 words in a row from a passage it cites.
8. **Sources.** Only texts fetched from the official hosts in the policy. A source counts as
   current only under the rule in decision 0017's point 2.
9. **Checks before release.** The mechanical checks, two separate AI reviews that do not see each
   other's result, the enhanced checks and both file formats. No person signs each guide. An AI
   review is never called a professional review.
10. **What every guide shows.** "AI drafted and reviewed; not reviewed by a Nigerian legal, tax or
    sector specialist", the date its sources were checked, what it covers, its limits and its
    official links.
11. **Staying published.** Sources are checked daily. A guide is reviewed again every 30 days. A
    changed source or a failed check takes the guide down until it passes again.
12. **Stopping.** The owner can pause the AI and withdraw any guide at once.
13. **Development only.** This policy allows publication in the development environment. Public
    launch and production need their own approvals.

## The official hosts

A guide's sources, the links in its own words and the places searched for later amendments must be
on one of these hosts:

- `icrp.cac.gov.ng` and `www.cac.gov.ng` (Corporate Affairs Commission)
- `nass.gov.ng` (National Assembly)
- `www.nrs.gov.ng` and `taxid.nrs.gov.ng` (Nigeria Revenue Service)
- `ndpc.gov.ng` (Nigeria Data Protection Commission)
- `www.ncc.gov.ng` (Nigerian Communications Commission, which serves a copy of the Nigeria Data
  Protection Act)
- `fccpc.gov.ng` (Federal Competition and Consumer Protection Commission)
- `nafdac.gov.ng` and `www.nafdac.gov.ng` (National Agency for Food and Drug Administration and
  Control)
- `www.pencom.gov.ng` (National Pension Commission)
- `nipc.gov.ng` and `m.nipc.gov.ng` (Nigerian Investment Promotion Commission, which serves copies
  of the Business Facilitation Act and the Labour Act)
- `fmino.gov.ng` (Federal Ministry of Information and National Orientation)

## What approving this file means

Approval is the product owner's alone, and it is of this file as a whole:

- the thirteen points above and the host list below them;
- the standard for calling a source current: the amendment record of decision 0017's point 2,
  knowing that it cannot prove that no later change exists;
- the basis of a guide's rights record: the provider's terms for Valo's own wording, and point 7 for
  official text, with no copyright opinion claimed;
- that the thirty drafts, GUD-01 to GUD-30, were written in the owner's own ChatGPT account;
- that each published guide needs two AI reviews before it is first published and two more every 30
  days, paid for from an allocation the owner approves separately.

Approving this file publishes nothing and spends nothing.

## How the code holds to this file

- The publisher accepts a guide only under this policy, never under the templates' policy.
- The policy counts as approved only while this file is, byte for byte, the file the owner
  approved. The approved file's SHA-256 is kept in `guidance-policy.ts`; it is empty today. Any
  later edit to this file ends the approval until the owner approves the new text.
- Until then every guide is held with the reason `policy_not_owner_approved`, and its rights record
  is not cleared, because the basis of that record is point 7.
- The owner's restriction file (`operational-publication-restrictions.json`) narrows this policy as
  it narrows the templates' one: a suspension, or an exclusion of guides or of Nigeria, stops guides
  too.
