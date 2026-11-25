# A result a business can act on

The finishing plan's Phase 2 row "Results" (RUL-006, CMP-001, CMP-003, CMP-004, CMP-006, CMP-007,
EDP-012). A result says which requirements may apply and why. This design makes it say what to use,
what it costs, where to act, what Valo has not checked for this business, and how current each
requirement is.

## What there is today

**What a requirement shows.** A result groups its requirements by label. Each one shows:
- where it applies: federal, a state, or a local government area;
- its rule and version, and how the rule was released;
- why it may apply;
- the answers still to give, each linked to its question;
- a hold for Valo's review, if one applies;
- a next step;
- its sources, each with the passage, its title and where in the text it is.

**Documents.** The engine already gives each requirement the documents its rule relates
(`relatedTemplateIds`). It also gives the result the documents recommended by its likely-relevant
requirements that may become tasks (`recommendedTemplateIds`). No screen shows either, and the four
rules prepared for the owner's sign-off relate none. Under every result, the page offers business
documents from the released list's first page. It says these are optional and not chosen from the
answers.

**Fees and deadlines.** A rule records neither, and a result says nothing about either.

**Where to act.** Every result lists the same one official route, the CAC's service discovery page,
whatever its requirements are. A requirement's sources link to the passages, not to where to act.

**What is not covered.** A result's gaps are two fixed sentences, plus the rules held back:
- "State/FCT and LGA coverage is not comprehensive", naming the state;
- the high-impact sentence, naming healthcare, financial services and energy, for every result.

Since slice 3 of [the questions](requirements-questions.md), what the business does can name the
specification's industries exactly, but no gap reads them.

**Dates.** The dates already exist:
- a rule records when its sources were checked (`sourceCheckedAt`);
- its release row records when it was published (`published_at`);
- an owner-signed rule's sign-off records when the owner signed it.

A result shows only the rules' date and version.

**What must not move.** The engine's result for an old input is pinned by its checksum, in "old v1
result/hash and generated saved response remain unchanged" (`valo-checker-rich.test.ts`). A saved
result carries its own checksum, and is shown only while the checksum matches.

## What changes

### 1. The documents a requirement relates (RUL-006)

- **Each requirement lists its rule's related documents** under "Documents for this requirement",
  by the titles and links the released list gives them. A related document that is not released is
  not listed.
- **The result's recommended documents** are listed together under "Recommended documents", apart
  from the requirements. These are the related documents of the likely-relevant requirements that
  may become tasks, as the engine works them out today. The optional business documents under the
  result stay as they are.
- **The released list takes the documents' numbers.** `GET /public/catalogue` gains an optional
  `templateIds` filter, up to twenty numbers. It returns only released templates, as the list
  always does.
- **The prepared personal-data rule relates the privacy notice (TPL-29).** That rule is about
  telling people what will be done with their personal data when it is collected, which is what a
  privacy notice does. TPL-29 is held today, so nothing shows until it is released. The other three
  prepared rules relate none: their actions are filed with the authority.

### 2. Each authority's own route (CMP-007, EDP-012)

- **A rule may record its official route**: the authority's name and the page to act on.
- **Each requirement links its route**: "Where to act: Corporate Affairs Commission".
- **The result's "Official sources" lists the routes of its requirements.** For a result with
  none, the CAC's service discovery page stays, so an old result's routes are unchanged.
- **The prepared rules' routes** are each authority's own page, read before they are recorded:
  - the Corporate Affairs Commission's, for the business name;
  - the Nigeria Revenue Service's, for the company return;
  - the Nigeria Data Protection Commission's, for personal data;
  - NAFDAC's, for products.

### 3. Fees and deadlines (CMP-006)

- **A rule may record a fee and a deadline.** Each holds its words and the source passage it rests
  on. A fee also says whether it is the government's.
- **A requirement shows them only when its rule records them with a source.** Otherwise it says
  "Fee: confirm with the authority" and "Deadline: confirm with the authority".
- **A government fee is named as the authority's.** A Valo price is never shown as a fee.
- **No date is scheduled from a deadline.** Tasks and reminders are unchanged.
- **The prepared rules record none** until the owner approves the words and the passage for each.
  Until then, each says to confirm with the authority.

### 4. What Valo has not checked for this business (RUL-006, CMP-003)

- **For each industry the business chose**, the result says Valo has not checked requirements
  specific to it, since no deeper pack is released. For healthcare, financial services and energy
  it says those activities need activity-specific evidence, as the specification requires.
- **For the place given**, the result names the state's own requirements, and the local government
  area's when one is given, as not checked. A visitor who did not give the state or the area is told
  that place-specific requirements were not checked.
- **For an old input** the two fixed sentences stay as they are: the high-impact sentence when no
  industry is chosen, and the state sentence. So the pinned result does not move.

### 5. Three dates apart (CMP-004, EDP-012)

- **Each requirement shows three dates**, each with its own label:
  - "Sources checked on 24 Nov 2026";
  - how it was reviewed: "Signed off by the development owner on 24 Nov 2026", or "AI reviewed on
    24 Nov 2026" for a rule released on the reviewed route;
  - "Published on 25 Nov 2026".
- **The words follow CMP-004.** "Source checked" and "AI reviewed" appear as the labels.
  "Professionally reviewed" never appears, since no such review is recorded.
- **Where they come from:**
  - the rule's `sourceCheckedAt` gives the first date;
  - the release row's `published_at` gives the publication date;
  - the owner's sign-off, or the reviewed route's review record, gives the review date.

  The engine is handed the last two for each rule in use, beside the rules.

## What does not change

- The calculations and their checksums.
- A result's checksum for an old input. New fields are added only to requirements, which a result
  with no rules lacks. New gap sentences appear only when the answers name an industry or an area.
- Tasks and reminders. No deadline schedules anything.
- A saved result. One saved before this change shows what it was saved with: an absent field shows
  nothing, or "confirm with the authority" for a fee or a deadline.

## Settled while building it

**Slice 1: documents.**
- **A template's number.** The released list names each template by its number in the
  specification's list ("TPL-29"), apart from the address it already gives:
  - a reviewed release, by the template it was released as;
  - a staff library template, by the registered template whose title it has. The staff library
    already finds the template an entry is filed as this way, for its access level, its fill-in form
    and its category. All 40 retained template drafts have their registered titles, so each entry
    filed from one has its number.

  Any other entry has no number: a template with another title, a guide or an article.
- **The filter** takes up to twenty numbers, comma-separated, written as the list writes them. Any
  other value is refused. It finds released templates only, so a held one is never named.
- **The page asks once for every twenty numbers a result relates.** It reads every page of the
  answer, since one number can name a reviewed release and a library entry.
- **Where the documents go:**
  - "Documents for this requirement" is in the requirement's card, after its next step.
  - "Recommended documents" comes after what is still unanswered and what Valo does not cover, and
    before the official sources. It says: "These are the documents for the requirements above that
    are likely relevant. Using one does not by itself meet a requirement."
  - A premium document says "Premium".
- **When the documents cannot be loaded**, the result says so in place of the recommended documents:
  "The documents for these requirements could not be loaded. Your results above are not affected."
  It offers "Try again". The requirements are still shown.
- **The prepared personal-data rule relates the privacy notice (TPL-29).** The rule is not signed and
  TPL-29 is held, so no result shows it yet.

**Slice 2: official pages, fees and deadlines.**
- **A rule may record its authority's official page and its figures.** The figures are fees,
  deadlines, rates and thresholds, since CMP-006 names all four. Each is checked as its release is:
  - a figure is in the words its source quotes, which the release checks against the official text,
    so nothing is shown that the source does not say. A fee is the government's: a rule records only
    its source's words, never a Valo or provider charge;
  - the page is on one of the policy's official hosts, as the sources must be, on both release routes.
    The owner signs it with the rule.
- **A requirement says "Official page"**, where the design proposed "Where to act". A privacy notice
  is not filed with the regulator, so "Official page" is true of all four prepared rules.
- **A requirement shows each figure in its source's words, with the passage it rests on.** A fee is
  shown as "Government fee". When its rule records no fee, or no deadline, it says "Confirm with the
  authority" after "Fees and deadlines", "Fees" or "Deadlines". No date is scheduled from a figure.
- **A requirement these answers do not indicate shows neither** a page nor a figure, so it suggests no
  action.
- **The result's official sources** are the pages of its requirements that may apply. A released rule
  in force that is held gives no result but still sends the business to its page (CMP-007, EDP-012).
  Holds of that kind are stale evidence, conflicting versions and a changed calculation. A withdrawn
  rule, or one not yet in force, sends nobody. A result with none keeps the Corporate Affairs
  Commission's service page.
- **The summary a customer copies** names the same page and figures.
- **The owner's panel** shows the page each rule links and its figures.
- **The prepared rules' pages**, each read on 25 November 2026 before it was recorded:
  - the business-name rule: the Corporate Affairs Commission's registration portal, which calls itself
    the Commission's official registration portal and offers the steps for registering a business;
  - the company-return rule: the Nigeria Revenue Service's site, which serves the Act. Its title reads
    "Nigeria Revenue Service (NRS) | Official Tax Authority of Nigeria". The rest of the page shows a
    browser a check for robots, so where on it a return is filed was not read;
  - the personal-data rule: the Nigeria Data Protection Commission's site, which serves the Act. Its
    pages for registering data controllers, filing audits and reporting breaches are reached from it;
  - the product rule: NAFDAC's page for small businesses. It says how to register a product, points to
    the online registration portal and lists what registration costs.

  None records a figure.

**Slice 3: what Valo has not checked.**
- **A result names what the answers give that no published rule covers**, after its sentence on the
  place:
  - the local government area given, unless a released rule in force is scoped to it: "Valo has not
    checked the local government's own requirements for Ikeja.";
  - each of the specification's industries the business does, unless a released rule in force tests
    for it: "Valo has not checked requirements specific to retail/wholesale."

  The visitor's own words and "Other" name no industry, so nothing is said of them. A rule held from
  the result covers nothing, so what it would cover is still named.
- **The excluded sectors stay named on every result.** The design proposed naming them only when no
  industry is chosen. RUL-006, though, is accepted only when "excluded high-risk sectors are
  visible".
- **The sentence on the place is unchanged.** It already names the state given, or the visitor's area
  when none is.
- **Answers that name neither an area nor a listed industry add nothing.** So a result from them is
  what it was: the pinned old result among them.

## Slices

1. **Documents.** The catalogue's `templateIds` filter, the documents under each requirement and
   the recommended documents, and TPL-29 for the prepared personal-data rule.
2. **Official routes, fees and deadlines.** The rule's three optional records, carried to each
   requirement; the result's routes; "confirm with the authority"; and the prepared rules' routes.
3. **What is not checked.** The gap sentences for the industries and the place given.
4. **Dates.** The three dates, from the rule, its release row and its review.

## The owner's points

1. **The prepared rules' records.** These are proposals, each for the owner to confirm:
   - the personal-data rule's privacy notice;
   - each rule's official page. The tax authority's could be read only as far as its title;
   - each fee and deadline, with its passage, when one is recorded. NAFDAC's page for small
     businesses lists what registering a product costs. Showing those costs needs that page as one of
     the product rule's sources and the owner's approval of each figure's words.
2. **The words**, all of them proposals:
   - "Documents for this requirement";
   - "Recommended documents", with its sentence "These are the documents for the requirements above
     that are likely relevant. Using one does not by itself meet a requirement.";
   - "The documents for these requirements could not be loaded. Your results above are not
     affected.";
   - "Official page";
   - "Government fee", "Deadline", "Rate" and "Threshold";
   - "Confirm with the authority.", after "Fees and deadlines", "Fees" or "Deadlines";
   - the sentences on what is not checked: "Valo has not checked the local government's own
     requirements for …" and "Valo has not checked requirements specific to …";
   - the three dates' labels.
