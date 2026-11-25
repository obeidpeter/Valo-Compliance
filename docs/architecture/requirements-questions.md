# The requirements check's questions

Design for the finishing plan's Phase 2 row "The questions" (RUL-001). It is a proposal under the
owner's delegation of 24 November.

The requirement's text, verbatim:

> RUL-001  Configurable questionnaire  [R1 · Must] Use progressive questions driven by activity, legal
> form, locations, employment, turnover period, product type and personal-data handling. Accept:
> irrelevant questions are skipped, progress is clear, and the user can return to previous answers.

## What there is today

**Nineteen questions, fixed in the web app.** The check's six steps and their nineteen questions are
written into `artifacts/valo/src/lib/checker.ts` (`CHECKER_STEPS`) and drawn by `screens/checker.tsx`.
Three of them are skipped by an earlier answer, by `asked()`:

- the product types, unless the business manufactures or imports goods;
- the local government area, when the business has no premises;
- the seven details of the turnover figure, when turnover does not apply.

**The engine skips them its own way.** `missingQuestions` in `lib/valo-core/src/checker.ts` decides
which questions a result lists as "Still unanswered". It repeats the three skips in its own code, and
the two disagree:

- The page asks the product types only when the business manufactures or imports, but the engine
  lists them as still unanswered unless it does neither. A visitor who answers "I do not know" to
  either question is told to answer one the page never showed.
- The engine counts "Not applicable" as unanswered, and the page counts it as an answer. A visitor
  who says turnover or employees do not apply is told that the question is still unanswered.
- A rule for one local government area needs the area. When the business has no premises the page
  skips the question, and the rule then lists it as still needed. No such rule is released yet.

**The rules read none of the nineteen.** The four rules prepared for the owner's sign-off (decision
0020, `artifacts/api-server/src/modules/editorial/owner-rule-candidates.ts`) are calculations that read
only the check's "optional details": four closed panels, one for each kind of rule. Their questions
are in `components/rich-checker-fields.tsx`:

| Panel | Rule | Questions |
| --- | --- | --- |
| Optional name and operator details (signed in only) | CAMA s.814, a business name | 12, with 4 on the name's wording and 5 for each partner |
| Optional company and accounting details | NTAA s.11, a company's return | 8 |
| Optional product and activity details | NAFDAC Act (Cap F33), product registration | 15 |
| Optional personal-data details | NDPA s.27, telling people how their data is used | 23 |

Each panel asks all of its questions at once and skips none. A panel shows whether or not a rule
that reads it is released. Nothing fills its answers from the main questions, so the legal form is
asked three times in three vocabularies, and whether the business holds personal data twice. A
visitor who opens no panel gets "More information needed" from every one of these rules.

**Fixed choices.** The state is chosen from the 36 states and the FCT. What the business does, the
kinds of product and the local government area are typed in the visitor's own words. The
specification lists twenty industries (VALO-TRD-001, "Industry taxonomy and depth"), but the check
does not use them.

**Progress and return.** The page counts sections: "3 of 5 sections answered". "Back", the strip of
steps and the review's "Change" links return to earlier answers. In a result, only a question of an
optional panel has a link to its place.

**What is fixed.**
- Each rule's calculation is pinned by its file's checksum (`sourceFamilyAlgorithmHashes` in
  `checker-rich.ts`, checked by `valo-checker-rich.test.ts`). Changing it means a new version and the
  owner's review again.
- Saved results are checked against their hashes when they are read.
- Signed scenarios read their answers with `checkerFactsSchema`.

So the answers keep their fields and types. They gain no default and no required field.

## What changes

### 1. One questionnaire, held as data

A new module, `lib/valo-core/src/checker-questionnaire.ts`, holds every question the check can ask:
the nineteen, and each rule's questions. For each question it records:
- the answer it fills (`legalForm`, or `rich.privacy.controllerRole` for a rule's question);
- its step;
- its words: the question, its hint, and the label of each choice;
- what kind of answer it takes;
- its choices, which a test holds equal to the answers' schema;
- which of "I do not know", "Skip for now" and "Not applicable" it offers;
- when it is asked.

"When it is asked" is a condition on earlier answers, written as data:

```ts
type When =
  | { answer: string; is: readonly Value[] }    // the answer is one of these; a list holds one of them
  | { answer: string; isNot: readonly Value[] } // the answer is none of these; no answer is none of them
  | { all: readonly When[] }
  | { any: readonly When[] };
```

The module imports nothing that needs the server, so the same file runs in the browser and on the
server. The web app draws the steps and their questions from it. The engine's `missingQuestions` reads the same conditions. So the page
and the result cannot disagree on what was asked.

The three disagreements are settled:

- **The product types** are asked when the business manufactures or imports goods, or does not know
  whether it does. The result lists them as still unanswered only when they were asked.
- **"Not applicable" is an answer.** The result's "Still unanswered" lists a question that was
  asked, and answered "I do not know", skipped, or not answered at all. A rule that cannot decide on
  "Not applicable" still says what it needs, under that rule.
- **The local government area** is asked once a state is chosen, whether or not the business has
  premises, since a business run from home is in an area too. Before a state is chosen, a result
  that needs the area links to the state's question.

A result saved before this change keeps the list it was saved with.

### 2. The rules' questions in the main flow

**Only a released rule's questions are asked.** A new public route, `GET /checker/questions`, lists
the rules the check would use today: each one's identifier, version, title, and the kind of rule it
is. It applies the same release checks as the engine, through a function the engine and the route
share. It returns no customer data. Like the check, it counts against the per-visitor limit on
public reads. The page reads it once.

**A rule's questions appear in the step they belong to**, as ordinary questions under a line naming
the rule they are asked for. The business-name and company questions go under "Your business", the
product questions under "What it does", the personal-data questions under "Personal data". The four
closed panels are removed.

The business-name questions ask for the business's exact name and its people's names, so they are
asked only of a signed-in visitor, as today. A visitor who is not signed in sees, in their place,
that one requirement needs these details, and the links to sign in that keep the answers.

**A rule's question is asked only when its answer can change what the rule says.** Its condition
follows the rule's calculation. For the personal-data rule:
- whether the business uses information about people who can be identified comes first;
- the six ways the business can be connected to Nigeria follow only when it does, and each one only
  until one of them holds;
- what the information is used for, and who decides how it is used, follow after that;
- the household and legal-claim questions follow only when the purpose or context names them.

When the business says it uses no such information, three questions follow: which kinds of
information it keeps, whether decisions about people are made automatically, and whether people are
profiled. The rule's calculation reads them, to catch a business that does not count customers'
phone numbers as personal data.

**A test proves the conditions against the calculations.** For each rule, it makes a seeded walk
through the questionnaire. At each step it gives an asked question one of its answers: yes, no, each
choice, "I do not know", "Skip for now", "Not applicable", or nothing. Sometimes it changes an
earlier answer instead, which leaves later answers hidden. At every state it checks:

- everything the rule's calculation says it still needs is a question the page shows now;
- changing any question the page does not show, to any of its answers, changes nothing the rule
  says: its label, its reason, what it still needs, or its hold for Valo's review.

The rules' prepared scenarios are checked the same way.

The calculations are pinned by their checksums, so the conditions cannot fall out of step quietly. A
new version of a calculation needs the owner's review again, and this test runs on it.

The second check also makes it safe to leave out an answer that a changed choice hides. Such an
answer is kept on the page, and comes back if the choice is changed back. But it is not sent with the
check or saved with its result, as with the nineteen today: when turnover does not apply, a turnover
figure typed before is not sent. By the test, leaving it out cannot change what the rule says. So a
saved result holds the answers the page showed, and the review lists exactly those.

### 3. Earlier answers fill a rule's answers, when they mean exactly the same

An earlier answer fills a rule's answer only when it settles that answer. The questionnaire lists
each case:

| Earlier answer | The rule's answer it fills |
| --- | --- |
| How is the business set up? Sole proprietor | Business name: one individual operates under the name. Company return: not incorporated as a company. |
| Partnership | Business name: a partnership or firm. Company return: not incorporated as a company. |
| Limited company | Business name: a company. Company return: its records describe a company, incorporated as a company. |
| Company limited by guarantee | Business name: a company. Company return: its records describe a company limited by guarantee, incorporated as a company. |
| Incorporated trustees | Company return: its records describe incorporated trustees, not incorporated as a company. |
| A company, as above, and "Registered" with the CAC | Company return: incorporated in Nigeria. |
| Which state is the business in? Any state or the FCT | Personal data: the organisation operates in Nigeria. |
| Do you collect or keep customer or staff personal data? Yes | Personal data: the business uses information about identifiable people. |
| Which kinds of product? Exactly one of the Act's six categories, listed in section 4 below | Product registration: the product is of that category. |

The cases left out are the ones where the earlier answer does not settle the rule's answer:
- "No" to the personal-data question does not fill anything. It asks about customers and staff
  only, and the rule asks about anyone.
- A sole proprietor's tax records are not filled either, since one may trade without a registered
  business name.

A filled answer is worked out from the earlier answer each time and never stored apart from it. The
page shows it in the flow as answered: "From your answer to ‘How is the business set up?’", with a
link to that question. It is not asked again. Changing the earlier answer changes the filled answer
with it. If the visitor had answered the rule's question themselves before the earlier answer
settled it, their own answer is kept, hidden, and comes back if the earlier answer changes again.

A saved check stores the answers it sent, filled ones included. When it is loaded again, a rule's
answer equal to what its earlier answer fills is read as filled, so it keeps following that answer.

### 4. Fixed choices for what the business does, its products and its area

**What the business does.** The visitor chooses one or more of the specification's twenty
industries. Each is stored as the specification writes it, for example "retail/wholesale". They can
still add their own words. Both go into the same answer, up to ten entries in all, as today.
- A saved or profile answer in the visitor's own words is kept, and shown as typed.
- A rule can test for an industry by its exact name.
- The results row of this phase uses the chosen industry to say which industries the check does not
  cover yet.

**The kinds of product.** The visitor chooses from the six categories that section 1(1) of the
product-registration rule's Act names, in the copy the rule was prepared from
(`docs/content-candidates/source-evidence/nafdac_cap_f33.txt`): "processed food, drug, drug product,
cosmetic, medical device or water". They can add "Other products" in their own words. The categories
are stored as the rule's own values (`processed_food` and the rest), so that exactly one chosen
category fills the rule's answer.

**The local government area.** The area is chosen from its state's areas, as the official list in
the First Schedule to the 1999 Constitution names them, once an official copy of that list has been
read.
- The list's source is recorded the way each rule's sources are: where the copy was read, when, and
  what it covers.
- An area typed before is kept and shown as typed.
- If no official copy can be read, the area stays free text, and this design says so.

The profile screen's state and area take the same lists, so a profile filled in after this change
matches the check.

### 5. Progress, and returning to an answer

**Progress counts questions, not sections**, and only the questions asked: "9 of 14 questions
answered".
- An answer that opens or skips questions changes the total, so the line counts the questions asked
  for the answers given so far.
- A step's tick means every question it asks has an answer, "I do not know" and "Skip for now"
  included. The exact turnover figure, which is optional, never holds a step back.

**Every question can be returned to.**
- The review lists every question asked, in order, each with its answer and a "Change" link to its
  place. Filled answers say where they came from. Skipped questions are not listed.
- A result's "Still unanswered" links each question to its place, the nineteen included, as the
  optional panels' questions are linked today.

## What does not change

- The answers' fields and types, so saved checks, saved results and signed scenarios read as they did.
- Each rule's calculation and the code that hands it the answers. Their checksums stay the same.
- The engine's results: the same labels, from the same calculations. "Still unanswered" changes as
  described in section 1.
- The check's route, its per-visitor limit, and how a result is saved and compared.

## Slices

1. **The questionnaire as data.** The nineteen questions and their conditions move into
   `checker-questionnaire.ts`, and the page and `missingQuestions` both read them. This slice
   settles the three disagreements.
2. **The rules' questions in the main flow.** This slice adds:
   - the route that lists the rules in use, and the release checks it shares with the engine;
   - each rule's questions and conditions;
   - the test that proves them;
   - the filled answers.

   The optional panels go.
3. **Fixed choices.** The industries, the kinds of product, and the local government areas from an
   official copy of the list.
4. **Progress and links.** Progress counts questions. The review and "Still unanswered" link every
   question, and a filled answer links to the answer that filled it.

Each slice keeps every test that ran before it.

## The owner's points

1. **The words.** These are proposals:
   - the new questions;
   - the line naming the rule a question is asked for;
   - the line for a filled answer;
   - the progress line;
   - what a visitor who is not signed in sees in place of the business-name questions.

   The rules' questions keep the words they were given for the optional panels. More people will
   read them in the main flow, so the owner may want them plainer, keeping each question's meaning.
2. **The filled answers.** Each row of the table in section 3 claims that the earlier answer means
   exactly the rule's answer. A wrong row would answer a rule's question for the visitor, wrongly.
   Confirm each row, or strike it.
3. **"Not applicable" counts as an answer** in "Still unanswered", and a rule that cannot decide on
   it still says what it needs.
4. **The local government area is asked of a business without premises.**
5. **The lists.** The twenty industries are the specification's, verbatim. The kinds of product are
   the product-registration Act's. The local government areas wait for an official copy of the
   First Schedule; until one is read, the area stays free text.
