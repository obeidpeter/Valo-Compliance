# Publication policy for templates that state the law

Status: **proposed. The product owner has approved no text of this file.** The owner approves it as a
whole, by its checksum, and the code then holds that checksum. Until then no template can be
published under it.

This policy is for templates whose words say what Nigerian national rules require. The owner's
recorded authority for templates ([operational-publication-authority.md](operational-publication-authority.md))
says that claims about law need a source-backed policy of their own. The guidance policy
([guidance-publication-policy.md](guidance-publication-policy.md)) is one, but only for guides. This
is the one for templates, as [the reviewed route's design](../../architecture/reviewed-route.md),
part 4, proposes.

## The policy

1. **What may be published.** Premium templates whose claim map places a statement of Nigerian
   national law, starting with TPL-31, the data processing agreement. A template is a starting
   document that its users complete. A template whose claim map states nothing about the law is
   released under the templates' own policy, never this one.
2. **Where.** Nigeria as a whole. A template makes no claim about a state, the FCT or a local
   government until a later decision allows it.
3. **Subjects.** Personal data, contracts, company governance, workplace safety, regulated sectors
   such as food, employment and tax. Every one is treated as high impact: the enhanced checks always
   run.
4. **Every statement of law is tied to its source.** Each sentence that says what the law requires
   is bound to an exact passage of an official text that Valo holds a copy of. A sentence that
   interprets a passage is recorded as an interpretation. A term the parties choose is recorded as a
   term and is never presented as a legal duty. A practical suggestion is recorded as optional
   practice.
5. **Numbers.** A rate, fee, penalty, threshold or deadline appears only when the quoted passage
   contains that number. A figure the parties choose is left for them to enter.
6. **Contracts.** A contract template states the assumptions it makes about its parties and its
   use, and lists the clauses it leaves for the parties to settle. A material uncertainty about the
   law holds the whole template.
7. **Never.** An opinion on one business's position; a statement that a business complies or is
   exempt; a promise that a completed document is valid or enforceable; a claim of review by a
   lawyer, tax adviser, regulator or other specialist; a filing made for a customer.
8. **Official text is explained, not copied.** A template does not reproduce official text beyond a
   short quotation: no more than 20 words in a row from a passage it cites.
9. **Sources.** Only texts fetched from the official hosts in the policy. A source counts as
   current only under the rule in decision 0017's point 2, as a guide's source does.
10. **Checks before release.** The mechanical checks, two separate AI reviews that do not see each
    other's result, the enhanced checks and both file formats. No person signs each template. An AI
    review is never called a professional review.
11. **What every template shows.** "AI drafted and reviewed; not reviewed by a Nigerian legal, tax
    or sector specialist", the date its sources were checked, what it covers, its limits, what it
    assumes, the clauses it leaves open and its official sources.
12. **Staying published.** Sources are checked daily. A template is reviewed again every 30 days. A
    changed source or a failed check takes the template down until it passes again.
13. **Stopping.** The owner can pause the AI and withdraw any template at once.
14. **Development only.** This policy allows publication in the development environment. Public
    launch, production and sales need their own approvals.

## The official hosts

A template's sources, the links in its own words and the places searched for later amendments must
be on one of these hosts, the same as for guides:

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
- `budgetoffice.gov.ng` (Budget Office of the Federation, which serves the Finance Acts)

## What approving this file means

Approval is the product owner's alone, and it is of this file as a whole:

- the fourteen points above and the host list below them;
- the standard for calling a source current: the amendment record of decision 0017's point 2,
  knowing that it cannot prove that no later change exists;
- the basis of a template's rights record: the provider's terms for the wording of its draft, and
  point 8 for official text, with no copyright opinion claimed;
- that the drafts of these templates were written in the owner's own ChatGPT account, as the
  retained intake manifest records;
- that each published template needs two AI reviews before it is first published and two more every
  30 days, paid for from an allocation the owner approves separately;
- that each of those reviews is sent with the official passages the template rests on. A template's
  review is refused before it is sent if it measures more than 64,000 by the budget's cautious
  count, which counts every byte as a token, as a guide's review is.

Approving this file publishes nothing and spends nothing.

## How the code holds to this file

- The publisher checks a template that states the law only against this policy, never against the
  templates' own policy.
- The policy counts as approved only while this file is, byte for byte, the file the owner approved.
  The approved file's SHA-256 is kept in `template-law-policy.ts`, which today holds none. Any later
  edit to this file ends an approval until the owner approves the new text.
- While this file is not the approved text, every template that states the law is held with the
  reason `policy_not_owner_approved`.
- The owner's restriction file (`operational-publication-restrictions.json`) narrows this policy as
  it narrows the others: a suspension, or an exclusion of templates or of Nigeria, stops these
  templates too.
