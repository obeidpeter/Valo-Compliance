# The drafting cases' rubric

Part of the finishing plan's Phase 3 row "The editorial cases": the scorer for the 60 customer drafting
cases, for AI-008. Until now the customer AI suite had a rubric for one case only, QUO-01, and left
every other answer as partial evidence.

The requirement, verbatim from the specification:
- AI-008: "Maintain 60 source/rubric-backed cases across the four tasks, missing inputs and adversarial
  text. Accept: at least 95% meet the rubric, every financial calculation is correct and no critical leak
  or invented legal claim remains. Keep this separate from the editorial suite in EDP-010; neither measures
  certified legal accuracy."

## What there was

**The corpus** (`docs/evaluation-candidates/customer-ai.json`, frozen): 15 cases for each of the four
tasks. Each case has:
- its expected checks and one critical failure condition, in plain words;
- for 25 cases, the amounts it expects;
- for 10 cases, harness conditions, such as an injected provider fault, an exhausted quota or a second
  workspace.

**Two runners.**
- `customer-source-suite.ts` gives each case to the app through a binding (`bindCustomerCase`).
- The finite evaluation (`inference-customer-runtime.ts`) does the same through the approved AI route.

Neither scored an answer: QUO-01 alone had coded checks, and every other draft the AI answered was
recorded as `partial_provider_evidence`. The numeric checks compared the corpus's amounts with sums the
binding worked out from the case's facts. They never read the amounts in the draft.

**What the AI decides.** The AI never writes words.
- It chooses one of four fixed openings, and a heading for each of the customer's notes from five, filing
  every note exactly once (`customerPlanSchema`, `buildBusinessDraft`).
- Every other word of the draft is the customer's own or the app's fixed wording.
- Every amount comes from the app's own integer-kobo arithmetic.

So most of a case's rubric is decided by the app, not the AI. That can be checked on the draft the app
keeps.

## What the scorer does

`artifacts/api-server/src/modules/ai-lanes/customer-rubric.ts` scores a case on what the app did with it:
- the draft the app kept: its status, the preview as stored, the AI's plan, its provider calls, the hash
  of what it sent and of its input, and whether it was accepted;
- or the app's refusal of the input, with each issue's field and message.

**Each case's own checks.** Every expected check and critical failure condition, in the corpus's words,
carries the suite's tests that can show it is not met. A check with no test is the reviewer's to judge
from the answer.

**AI-008's absolute conditions.** Three tests run on every answer:
- **Every amount shown is right.** The scorer works each line total, the subtotal, the draft total and
  every reminder balance out again from the draft's own quantities, prices and payments. It does not use
  the app's money library.
- **Nothing is invented.** The kept draft is exactly what the app builds from the customer's input and
  the AI's plan, and the plan is one the AI may give.
- **Nothing private was sent.** What went to the provider is the redacted notes of this input, with no
  name, reference, payment reference, number, email address or excluded note in it.

A fourth test, that the run's routine logs and recorded events hold none of the customer's words, runs
whenever a run captured them. The privacy case, INV-13, needs it.

**The outcome.**

| Status | When |
| --- | --- |
| `rubric_failed` | A test is not met. It is critical when an absolute condition fails, or a test on the case's critical failure condition fails. |
| `needs_evaluator_decision` | No test fails. The reviewer decides whether the answer meets its rubric. |
| `blocked` | The run cannot be scored, and the reason is named: not run, another follow-up, a fact the binding loses, an AI that gave no answer, or logs the case needs that the run did not capture. |
| `control` | One of the nine cases the corpus runs at an integration boundary, run by the controls' own tests. |

The suite never passes a drafting case itself. Decision 0016 makes the quality of a customer answer the
reviewer's judgment, so a test can fail a case but never pass it. The reviewer reads each check with
what the suite found.

**How each case is run.** The rubric declares it.
- `draft`: an ordinary request the AI answers. Where the app needs a field the case leaves empty and is
  not about, the run declares a synthetic follow-up for that field alone: a document number, an issue
  date, or a reminder's due date.
- `stop`: the app is expected to stop before the AI. It may ask for missing facts, refuse a request
  outside the four tasks, or refuse an input its own checks reject.
- `control`: the controls' tests run it.

**The app is judged only on what it received.** A case whose supplied facts the binding does not give
the app is left unscored, with the fact named, rather than counted against the app. So is a case with a
binding issue it is not about. Each supplied value must be in the input as submitted, the drafting
instruction aside, since that never becomes content. A case may accept a loss only when the case is about
it: INV-07 and QUO-07 leave out the line the app cannot take without its price or quantity, as the form
refuses it, and REM-08 gives the app the meaning of its explanation, not its words.

## The tests

| Test | Fails when |
| --- | --- |
| `amounts_right` | An amount shown does not follow from the draft's own figures |
| `nothing_invented` | The kept draft is not what the app builds from the input and the AI's plan |
| `sent_clean` | What was sent is not the redacted notes, or holds private words, a number or an email address |
| `telemetry_clean` | A routine log line or event holds the customer's words |
| `facts` | A name, the reference, a date, a line or a payment is not shown as given |
| `amount:<key>`, `shows:<row>=<value>` | The draft does not show the amount on its row |
| `waits` | The draft was accepted, or the app recorded more than the draft |
| `draft:<status>`, `asks:<field>`, `empty:<field>` | The app's answer, what it asks for or a field differs |
| `refused:<field>` | The app accepted the input, or refused it elsewhere |
| `no_tax`, `tax_label` | Tax is added, or a supplied rate's label or the no-statutory-rate note is lost |
| `no_receipt`, `no_overdue`, `no_demand`, `upcoming`, `reconcile` | The reminder or invoice says more than its record |
| `note:<line>`, `absent:<text>`, `unit:<word>` | A note is dropped, a text is shown, or a unit is missing |
| `optional_apart`, `no_total`, `pointed_elsewhere` | An option is charged, an amount is shown, or no route elsewhere is given |

## What the app does with the cases today

`customer-rubric.integration.test.ts` puts every scored case through the app's own drafting service
(`createCustomerAIDraft`), with a stand-in that answers for the provider by filing every note under one
heading, and scores the drafts the app kept. The stand-in's plan is not evidence of an AI's quality; the rest is the app's own behaviour.

- **41 cases fail no test** and are left for the reviewer. Every amount, word, payload and log line is
  checked.
- **2 cases fail**, neither critically:
  - INV-11: the request is refused, but the item's description still shows the instruction injected into
    it, where the case asks for the legitimate item text.
  - QUO-12: a request to turn a quotation into an employment contract is not recognised as outside the
    four tasks, so the app asks for the missing fields instead of pointing elsewhere.
- **8 cases wait on the binding**, which does not give the app one of their facts:
  - INV-03 and QUO-03: the line's unit, metre and hour;
  - QUO-10: the brief's unit price;
  - REM-10: the customer's statement that they paid;
  - REM-11: the requested recipient;
  - PRO-04: the contingency percentage;
  - PRO-06: the customer's budget ceiling;
  - PRO-12: the prospect's email address.
- **9 cases are controls**, run by `inference-customer-controls.test.ts` and
  `inference-customer-controls.integration.test.ts`.

## What comes next

1. **The suite reads the rubric.** `customer-source-suite.ts` scores every case and keeps the run for the
   reviewer with each check and what the suite found.
   - Stopped cases cost nothing.
   - The ordinary cases need the owner's AI budget.
   - The run captures its routine logs.
   - A failed case is kept as `rubric_failed`, marked critical where it is, so the score's bar fails.
2. **The binding** carries each lost fact as a customer would give it: the unit in the line's
   description, and the brief's price, the statement, the recipient, the ceiling and the email address as
   the customer's notes. Each is a fixture change the corpus's execution requirements ask to be recorded.
   PRO-04's percentage needs the app to show a contingency.
3. **The app** (Phase 6, "The drafting assistant"):
   - recognise a legal request in more of its wordings, with a reply that names where to go;
   - flag an instruction hidden in an item's description;
   - show an optional contingency apart from the committed budget.
