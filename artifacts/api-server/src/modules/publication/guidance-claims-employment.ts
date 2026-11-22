import type { GuideClaimMap, GuideSentence, GuideSupport } from "./guidance-claim-map";

/**
 * The claim maps of the four employment guides, GUD-27 to GUD-30.
 *
 * Each map lists every sentence of its guide in order. Most sentences of these guides suggest a way
 * of working and state nothing about the law. A sentence that says what the Labour Act says names
 * the passage it rests on and the first and last words of the exact quotation. The Act is not kept
 * in the repository: a passage is named by its place and checksum (guidance-captured-texts.ts), and
 * a sentence is bound only when a capture of the file supplies the passage.
 *
 * The file is the investment commission's reference copy. Its amendment record carries an open
 * question about that copy, so these guides can be bound and are still held: none of their sources
 * is marked current.
 *
 * These maps were written by reading each sentence against the copy as the project's extractor read
 * it on 22 November 2026. They are a drafter's work, for the two reviews to check: nothing here is
 * a review or an approval.
 */
const s = (text: string, ...support: GuideSupport[]): GuideSentence => ({
  kind: "source_statement",
  text,
  support,
});
const reading = (text: string, ...support: GuideSupport[]): GuideSentence => ({
  kind: "interpretation",
  text,
  support,
});
const practice = (text: string, ...support: GuideSupport[]): GuideSentence =>
  support.length ? { kind: "optional_practice", text, support } : { kind: "optional_practice", text };
const limit = (text: string): GuideSentence => ({ kind: "guide_limit", text });
const link = (text: string): GuideSentence => ({ kind: "not_a_claim", text });
const q = (passage: string, from: string, to: string, locator: string): GuideSupport => ({
  passage,
  from,
  to,
  locator,
});

// This copy of the Act numbers two section headings wrongly, so a place in those sections is given
// by the heading's words, which the passage holds.
const particulars = "Written particulars of terms of employment";
const deductions = "Deductions (including deductions for overpayment of wages)";
const worker = {
  means: q(
    "LABOUR-91-worker",
    '"worker" means any person who has entered into',
    "but does not include",
    'heading: "worker" means any person who has entered into',
  ),
  excludes: q(
    "LABOUR-91-worker",
    "persons exercising administrative, executive, technical or professional",
    "as public officers or otherwise; or",
    'heading: "worker" means any person who has entered into',
  ),
};
const s7 = {
  statement: q("LABOUR-7", "(1) Not later than three months after the beginning", "fying", particulars),
  terms: q(
    "LABOUR-7",
    "the name of the employer or group of employers",
    "any special conditions of the contract.",
    particulars,
  ),
  otherDocument: q(
    "LABOUR-7",
    "(3) A statement under subsection (1) or (2) of this section may",
    "accessible to the worker in some other way.",
    particulars,
  ),
  writtenContract: q(
    "LABOUR-7",
    "(6) The provisions of this section in respect of written statements shall not apply if",
    "he has a copy of that written contract.",
    particulars,
  ),
};
const s5 = {
  rule: q(
    "LABOUR-5",
    "(1) Except where it is expressly permitted by this Act or any other law, no employer",
    "for or in respect of any fines:",
    deductions,
  ),
  officer: q(
    "LABOUR-5",
    "Provided that, with the prior consent in writing of an authorised labour officer",
    "neglect of the worker.",
    deductions,
  ),
  overpayment: q(
    "LABOUR-5",
    "(5) Deductions may be made from the wages of a worker in respect of overpayment",
    "in which the overpayment was discovered.",
    deductions,
  ),
  ceiling: q(
    "LABOUR-5",
    "(7) Notwithstanding any other provisions of this Act",
    "third of the wages of the worker for that month.",
    deductions,
  ),
};
const s18 = {
  holiday: q(
    "LABOUR-18",
    "(1) Every worker shall be entitled after twelve months' continuous service",
    "at least twelve working days.",
    "section 18(1)",
  ),
  deferral: q(
    "LABOUR-18",
    "(2) The holiday mentioned in subsection (1) of this section may be deferred",
    "months' continuous service.",
    "section 18(2)",
  ),
  inLieu: q(
    "LABOUR-18",
    "(3) It shall be unlawful for an employer to pay wages in lieu",
    "whose contract has not terminated.",
    "section 18(3)",
  ),
  leaving: q(
    "LABOUR-18",
    "(4) A person who ceases to be employed after having completed",
    "as that period bears to twelve months.",
    "section 18(4)",
  ),
};
const s54 = {
  where: q(
    "LABOUR-54",
    "(1) In any public or private industrial or commercial undertaking",
    "a woman",
    "section 54(1)",
  ),
  leave: q(
    "LABOUR-54",
    "shall have the right to leave her work if she produces a medical certificate",
    "probably take place within six weeks;",
    "section 54(1)(a)",
  ),
  afterBirth: q(
    "LABOUR-54",
    "shall not be permitted to work during the six weeks following her confinement;",
    "confinement;",
    "section 54(1)(b)",
  ),
  pay: q(
    "LABOUR-54",
    "if she is absent from her work in pursuance of paragraph (a) or (b)",
    "sent; and",
    "section 54(1)(c)",
  ),
  nursing: q(
    "LABOUR-54",
    "shall in any case, if she is nursing her child",
    "for that purpose.",
    "section 54(1)(d)",
  ),
  notice: q("LABOUR-54", "(4) Where a woman", "ing during her absence.", "section 54(4)"),
};

export const employmentClaimMaps: readonly GuideClaimMap[] = [
  {
    id: "GUD-27",
    risk: "employment",
    sentences: [
      practice(
        "A clear employment record helps both the business and the person doing the work understand the role, pay and practical arrangements.",
      ),
      reading(
        "Begin with the actual employment relationship; calling someone a contractor or manager does not settle every question about the rules that apply.",
        worker.means,
        worker.excludes,
      ),
      s(
        "The Labour Act's written-particulars provision concerns specified employment terms and has its own conditions and exceptions.",
        s7.statement,
        s7.writtenContract,
      ),
      reading(
        "Its application depends on the Act's scope, including the relevant worker definition.",
        worker.means,
      ),
      reading(
        "A complete written contract can be relevant to the provision; a document title alone is not enough.",
        s7.writtenContract,
      ),
      practice(
        "As a practical preparation step, gather the employer and employee details, engagement and start dates, actual duties, workplace, duration, pay calculation and payment pattern.",
        s7.terms,
      ),
      practice(
        "Add working hours, leave and sickness arrangements, notice terms and any special conditions.",
      ),
      practice(
        "Check that a referenced policy is the correct version and is actually accessible to the employee.",
        s7.otherDocument,
      ),
      practice("Compare the record with the offer and what has been agreed."),
      practice(
        "If one says monthly pay and another says an hourly rate, resolve that difference rather than picking whichever is convenient.",
      ),
      practice("Keep an unanswered question visible."),
      practice("Do not invent a statutory period or assume a template's empty field means no entitlement."),
      link("Before sharing:"),
      practice("Check the employee category and actual duties against the applicable scope."),
      practice("Resolve inconsistent pay, dates and policy references."),
      practice("Distinguish proposed terms from terms actually agreed."),
      practice("Provide the completed document through the appropriate process."),
      practice("Retain the exact version supplied and record later changes."),
      practice(
        "The next step is to check the current official text and applicable terms for the employment in question, including any timing requirement.",
      ),
      limit(
        "An employment template helps organise the record; completing it does not itself certify that every legal requirement has been met.",
      ),
    ],
  },
  {
    id: "GUD-28",
    risk: "employment",
    sentences: [
      practice(
        "A payroll deduction changes what a person receives, so it needs a clear explanation and an appropriate basis.",
      ),
      practice(
        "Start by identifying the proposed deduction rather than treating every payment issue as the same kind of adjustment.",
      ),
      s(
        "The Labour Act places controls on wage deductions, including particular categories, conditions and limits.",
        s5.rule,
        s5.overpayment,
        s5.ceiling,
      ),
      reading(
        "A general statement in a contract that an employer may deduct anything is not a substitute for checking the applicable provision and the person's circumstances.",
        s5.rule,
        worker.means,
      ),
      practice(
        "As a practical workflow, record what the proposed deduction relates to: a payroll correction, a contribution, a claimed loss or something else.",
      ),
      practice("Identify the relevant period, amount, supporting record and the authority relied on."),
      practice("Keep an allegation of loss separate from an established finding."),
      reading(
        "Do not assume that a manager's approval, an employee's signature or an equipment handover form automatically resolves every legal condition.",
        s5.officer,
      ),
      practice("Check the calculation using the actual pay records."),
      practice(
        "If the same recovery appears in two payroll lines, investigate the duplication before processing it.",
      ),
      practice("Do not invent a percentage, instalment period or available balance."),
      practice(
        "Where the basis or scope is unclear, obtain the required clarification before treating the deduction as authorised.",
      ),
      link("Keep a concise review record:"),
      practice("What is being deducted, from whom and for which period?"),
      practice("What source or valid arrangement supports it?"),
      practice("Which conditions, restrictions or approvals need checking?"),
      practice("How was the amount calculated and explained?"),
      practice("What was actually processed, corrected or still disputed?"),
      practice("Use the current official text and other applicable payroll rules for the specific category."),
      limit("This article does not calculate take-home pay or approve a deduction."),
      practice(
        "A transparent record helps the business investigate an error and respond to the employee without disguising an unresolved issue as an established debt.",
      ),
    ],
  },
  {
    id: "GUD-29",
    risk: "employment",
    sentences: [
      practice(
        "An annual-leave record should show the person's applicable entitlement and what has actually been requested, approved and taken.",
      ),
      practice("It should not start with a guessed number of days copied from another business."),
      s(
        "The Labour Act's annual-holiday provisions address eligibility, paid leave, deferral and treatment when employment ends, with conditions and limits.",
        s18.holiday,
        s18.deferral,
        s18.leaving,
      ),
      reading(
        "Coverage and any more favourable applicable terms need checking before a particular employee's entitlement is entered.",
        worker.means,
        s18.holiday,
      ),
      practice(
        "As a practical first step, identify the employment category, recognised service dates, actual working pattern and the relevant contract or collective arrangement.",
      ),
      practice("Keep working days and calendar days distinct."),
      practice(
        "If the person works an unusual pattern, explain how the recorded unit is being used instead of silently applying a standard five-day week.",
      ),
      practice(
        "Maintain separate entries for the opening position, leave earned under the verified arrangement, requests, decisions, days actually taken and any explained correction.",
      ),
      practice("A pending request is not leave already taken."),
      practice("A manager proposing different dates is not evidence that the employee accepted those dates."),
      link("Before approving or changing a record:"),
      practice("Confirm the applicable source and contract version."),
      practice("Check service dates, units and arithmetic."),
      practice("Identify any unresolved scheduling or eligibility question."),
      practice("Explain the decision and preserve the earlier record."),
      reading(
        "Check the rules before substituting money, deferring leave or changing a closing balance.",
        s18.inLieu,
        s18.deferral,
      ),
      practice("A business planning target is different from a statutory deadline."),
      practice(
        "Do not label a chosen request lead time as law, or assume an unused balance can automatically be forfeited.",
      ),
      reading(
        "If employment is ending, check that situation separately rather than reusing an ordinary request calculation.",
        s18.leaving,
      ),
      practice(
        "The practical next step is to verify the individual's terms and complete a clear leave schedule.",
      ),
      limit("This guide does not supply a universal annual allowance or decide a disputed entitlement."),
      practice(
        "The Leave request form can record the request; the applicable terms determine the underlying position.",
      ),
    ],
  },
  {
    id: "GUD-30",
    risk: "employment",
    sentences: [
      practice("Maternity arrangements involve more than entering a single absence period in a calendar."),
      reading(
        "The relevant questions can include time away, pay, supporting information, return arrangements and protection during the affected period.",
        s54.leave,
        s54.pay,
        s54.nursing,
        s54.notice,
      ),
      practice("Check each part rather than assuming one generic leave policy answers everything."),
      s(
        "Section 54 of the Labour Act addresses maternity matters using its own workplace and eligibility wording.",
        s54.where,
        s54.pay,
      ),
      reading("Its provisions need to be read together.", s54.notice),
      reading(
        "Do not assume that a job title, a general worker-category label or one pay condition answers every part of the section.",
        s54.where,
        s54.pay,
      ),
      practice(
        "As a practical preparation step, identify the workplace context, relevant service history, expected timing where known, applicable employment terms and any additional benefit the business actually offers.",
      ),
      practice("Use a restricted contact for information that needs privacy."),
      practice(
        "A general team calendar usually needs absence dates and cover arrangements, not a detailed medical account.",
      ),
      practice(
        "Prepare a written arrangement that distinguishes what is confirmed from what still needs checking.",
      ),
      practice(
        "Explain the applicable leave and pay basis, the appropriate evidence process, how practical updates can be communicated, and the return or nursing arrangements that apply.",
      ),
      practice(
        "Do not invent a medical requirement, presume all leave is unpaid or infer a waiver from the employee signing a request form.",
      ),
      link("Check the following before relying on the arrangement:"),
      practice("Has the relevant workplace and individual scope been established?"),
      practice("Have leave, pay and other protections been considered separately?"),
      practice("Are contractual improvements preserved rather than silently removed?"),
      practice("Are information requests limited to what the process needs?"),
      practice("Is there a contact for changes, concerns and unresolved questions?"),
      practice("Review changes through the appropriate process and retain the actual communication."),
      reading(
        "A planned return date is not automatically a fitness assessment or permission to disregard a relevant protection.",
        s54.afterBirth,
      ),
      limit(
        "The next step is to verify the current source and individual terms; this guide does not set a universal maternity duration, pay rate or termination rule.",
      ),
    ],
  },
];
