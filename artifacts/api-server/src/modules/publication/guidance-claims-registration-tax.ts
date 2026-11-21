import type { GuideClaimMap, GuideSentence, GuideSupport } from "./guidance-claim-map";

/**
 * The claim maps of the ten registration, company-record and tax guides, GUD-01 to GUD-10.
 *
 * Each map lists every sentence of its guide in order. A sentence about the law names the retained
 * passage it rests on and the first and last words of the exact quotation. The builder
 * (guidance-claim-map.ts) checks all of it against the guide and the passages; a wrong word here
 * fails the build. These maps were written by reading each sentence against the official text. They
 * are a drafter's work, for the two reviews to check: nothing here is a review or an approval.
 *
 * Two passages are not kept in the repository: the Corporate Affairs Commission's portal notice
 * (GUD-05) and the Tax ID site's explanation page (GUD-08). Sentences that rest on them are bound
 * only when a capture of the page is supplied.
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

// Quotations several sentences rest on.
const s814 = {
  whoRegisters: q(
    "CAMA-814",
    "Every individual, firm or Corporation",
    "shall be registered",
    "section 814(1), printed page A405",
  ),
  firm: q(
    "CAMA-814",
    "(a) in the case of a firm",
    "initials of such forenames",
    "section 814(1)(a), printed page A405",
  ),
  individual: q(
    "CAMA-814",
    "(b) in the case of an individual",
    "thereof",
    "section 814(1)(b), printed page A405",
  ),
  company: q(
    "CAMA-814",
    "(c) in the case of a company",
    "without any addition.",
    "section 814(1)(c), printed page A405",
  ),
  receiver: q(
    "CAMA-814",
    "(c) the business is carried on by a receiver",
    "registration shall not be necessary.",
    "section 814(2)(c), printed page A406",
  ),
};
const s817 = {
  issued: q(
    "CAMA-817",
    "On the registration of any individual, firm or corporation",
    "the business name of the individual, firm or corporation.",
    "section 817(1), printed page A408",
  ),
  changed: q(
    "CAMA-817",
    "(2) On the registration of any change in the particulars registered",
    "or issue a fresh certificate.",
    "section 817(2), printed page A408",
  ),
  displayed: q(
    "CAMA-817",
    "thereupon exhibit and thereafter maintain",
    "at the principal place of the business so registered",
    "section 817(3), printed page A408",
  ),
  otherPlaces: q(
    "CAMA-817",
    "(4) Where an individual, firm or corporation registered under this Act",
    "business.",
    "section 817(4), printed page A408",
  ),
};
const incorporated = q(
  "CAMA-41",
  "(5) Upon registration of the memorandum and articles",
  "as the case may be.",
  "section 41(5), printed page A51",
);
const liabilityTypes = q(
  "CAMA-21",
  "An incorporated company may be a company",
  "“an unlimited company”).",
  "section 21(1), printed page A40",
);
const s818 = {
  notify: q(
    "CAMA-818",
    "Whenever a change is made or occurs",
    "notify the change to the registrar.",
    "section 818(1), printed page A409",
  ),
  within: q(
    "CAMA-818",
    "the individual, firm or corporation shall within 28 days after",
    "notify the change to the registrar.",
    "section 818(1), printed page A409",
  ),
  notAge: q(
    "CAMA-818",
    "other than particulars as to the age",
    "of an individual",
    "section 818(1), printed page A409",
  ),
};
const s822 = {
  duty: q(
    "CAMA-822",
    "Every individual, firm or corporation carrying on business",
    "deliver to the Commission a return",
    "section 822(1), printed page A411",
  ),
  date: q(
    "CAMA-822",
    "not later than the 30th day of June in",
    "each year",
    "section 822(1), printed page A411",
  ),
  signed: q(
    "CAMA-822",
    "(3) The returns and the accompanying financial statement shall be signed",
    "by a director and the secretary.",
    "section 822(3), printed page A411",
  ),
};
const s417 = {
  duty: q(
    "CAMA-417",
    "Every company shall, once at least in every year, make and deliver",
    "sections 418, 419 or 420 as may be applicable",
    "section 417, printed page A238",
  ),
  notInFirstYears: q(
    "CAMA-417",
    "Provided that a company need not make a return under this section either in",
    "in that year.",
    "section 417, printed page A238",
  ),
};
const forms = [
  q(
    "CAMA-418",
    "The annual return by a company having shares other than a",
    "small company",
    "section 418(1), printed page A238",
  ),
  q("CAMA-419", "The annual return by a small company", "admit.", "section 419, printed page A238"),
  q(
    "CAMA-420",
    "The annual return by a company limited by guarantee",
    "as circumstances admit.",
    "section 420(1), printed page A239",
  ),
];
const annexed = q(
  "CAMA-422",
  "Subject to the provisions of section 424 of this Act, there shall",
  "be annexed to the annual return",
  "section 422(1), printed page A239",
);
const privateCertificate = q(
  "CAMA-423",
  "A private company shall send with the annual return required",
  "a certificate signed both by a director",
  "section 423(1), printed page A239",
);
const smallExempt = q(
  "CAMA-424",
  "(2) A small company is exempted from the requirements imposed by",
  "this Act.",
  "section 424(2), printed page A240",
);
const s374 = {
  kept: q(
    "CAMA-374",
    "Every company shall cause accounting records to be kept in",
    "accordance with this section.",
    "section 374(1), printed page A210",
  ),
  contain: q(
    "CAMA-374",
    "(3) The accounting records shall, in particular, contain",
    "(b) a record of the assets and liabilities of the company.",
    "section 374(3), printed page A210",
  ),
};
const sixYearsFromMade = q(
  "CAMA-375",
  "(2) Subject to any direction with respect to the disposal of records given",
  "six years from the date on which they were made.",
  "section 375(2), printed page A210",
);
const taxId = {
  register: q(
    "NTAA-4",
    "Every taxable person shall register with the relevant tax authority and",
    "with tax obligations.",
    "section 4, printed page A266",
  ),
  onlyOne: q(
    "NTAA-7",
    "(5) A taxable person having a valid Tax ID shall not apply for, or be",
    "issued with another Tax ID.",
    "section 7(5), printed page A267",
  ),
  notTransferable: q(
    "NTAA-7",
    "(7) A Tax ID issued to one taxable person is not transferable or usable",
    "by another taxable person.",
    "section 7(7), printed page A267",
  ),
};
// The Tax ID site's explanation page is not kept in the repository.
const taxIdPage = "heading: How Tax ID Retrieval Works";
const s11 = {
  file: q(
    "NTAA-11",
    "Every company, including a company granted exemption",
    "at least once a year",
    "section 11(1), printed page A269",
  ),
  ceased: q(
    "NTAA-11",
    "(4) Where a company permanently ceases operation in Nigeria, the",
    "return.",
    "section 11(4), printed page A270",
  ),
};
const s31 = {
  keep: q(
    "NTAA-31",
    "Every person, including a company granted exemption from",
    "books or records of accounts.",
    "section 31(1), printed page A281",
  ),
  enough: q(
    "NTAA-31",
    "(2) The books or records of accounts shall contain sufficient information",
    "liability.",
    "section 31(2), printed page A281",
  ),
  format: q(
    "NTAA-31",
    "(3) The books and records required to be maintained under subsection",
    "authority.",
    "section 31(3), printed page A281",
  ),
  translated: q(
    "NTAA-31",
    "(4) Where the record is maintained in a language other than the English",
    "translator.",
    "section 31(4), printed page A281",
  ),
  sixYearsAfterAssessment: q(
    "NTAA-31",
    "(5) Any book or record required to be kept under this section shall be",
    "the income relates.",
    "section 31(5), printed page A281",
  ),
};

export const registrationTaxClaimMaps: readonly GuideClaimMap[] = [
  {
    id: "GUD-01",
    risk: "governance",
    sentences: [
      reading(
        "Business-name registration depends on the operator and the name being used.",
        q(
          "CAMA-814",
          "Every individual, firm or Corporation",
          "without any addition.",
          "section 814(1), printed page A405",
        ),
      ),
      s(
        "Section 814 of the Companies and Allied Matters Act applies to an individual, firm or corporation with a place of business in Nigeria carrying on business under a name.",
        s814.whoRegisters,
      ),
      reading(
        "It does not simply say that every small business must become a limited company.",
        s814.whoRegisters,
      ),
      s(
        "For an individual, compare the trading name with the person's true surname, allowing true forenames or their initials.",
        s814.individual,
      ),
      s(
        "For a firm, check the true surnames of all partners, allowing the individual partners' true forenames or initials.",
        s814.firm,
      ),
      s("For a company, compare the trading name with its corporate name without additions.", s814.company),
      reading(
        "A different trading brand can matter even when the company is already incorporated.",
        s814.company,
      ),
      s(
        "The Act includes patronymics within surnames and recognised forename abbreviations within initials; spelling alone should not decide the result.",
        q(
          "CAMA-868-forename",
          "“surname” includes a",
          "patronymic",
          "heading: “surname” includes a patronymic",
        ),
        q(
          "CAMA-868-initials",
          "“initials” includes any recognised",
          "abbreviation of a forename",
          "heading: “initials” includes any recognised abbreviation of a forename",
        ),
      ),
      link("Three qualifications need checking."),
      s(
        "Wording that merely identifies succession to a former owner does not itself trigger registration.",
        q(
          "CAMA-814",
          "(a) the addition merely indicates",
          "itself render registration necessary",
          "section 814(2)(a), printed page A405",
        ),
      ),
      s(
        "Where two or more individual partners share a surname, adding an “s” does not itself trigger it.",
        q(
          "CAMA-814",
          "(b) two or more individual partners",
          "necessary",
          "section 814(2)(b), printed page A406",
        ),
      ),
      s(
        "The section also provides an exception when a court-appointed receiver or manager carries on the business.",
        s814.receiver,
      ),
      reading("Ordinary management arrangements do not establish that exception.", s814.receiver),
      practice(
        "As a practical preparation step, write down the name actually used, the operator's legal form and the relevant true names or corporate name.",
      ),
      practice("Record any claimed qualification and its facts."),
      practice(
        "Then check the CAC business-name route (https://www.cac.gov.ng/services/business-name).",
        q(
          "CAC-BN-PROCESS",
          "Registration steps for Business Names",
          "Business Names",
          "heading: Registration steps for Business Names",
        ),
      ),
      reading(
        "A result of “Not indicated by these answers” concerns this naming check only; it does not establish general exemption from registration, approval of the name or compliance with other obligations.",
        q(
          "CAMA-863",
          "A person or association of persons shall not carry on business",
          "without being registered under this Act.",
          "section 863(1), printed page A432",
        ),
      ),
    ],
  },
  {
    id: "GUD-02",
    risk: "governance",
    sentences: [
      reading(
        "“Registered business” can describe different arrangements.",
        q(
          "CAMA-42",
          "As from the date of incorporation",
          "shall be a body corporate",
          "section 42, printed page A51",
        ),
        s817.issued,
      ),
      practice(
        "Before completing a contract, tax form or supplier application, identify what CAC actually registered and who is carrying on the business.",
      ),
      practice("A familiar trading name is not enough to answer those questions."),
      s(
        "Under section 42 of the Companies and Allied Matters Act, incorporation creates a body corporate under the name in the company's memorandum, from the date in its incorporation certificate.",
        q(
          "CAMA-42",
          "As from the date of incorporation",
          "by the name contained in the memorandum",
          "section 42, printed page A51",
        ),
      ),
      s(
        "Section 41 requires the certificate to identify whether the company is private or public and whether members' liability is limited by shares, limited by guarantee or unlimited.",
        incorporated,
      ),
      s("Section 21 distinguishes those liability structures.", liabilityTypes),
      reading(
        "Do not assume that every company offers the same liability arrangement, or that incorporation removes every possible personal responsibility.",
        liabilityTypes,
        q(
          "CAMA-42",
          "but with such liability on the",
          "as is mentioned in this Act.",
          "section 42, printed page A51",
        ),
      ),
      link("Business-name registration operates differently."),
      s(
        "Sections 814 and 817 deal with the business name of an individual, firm or corporation and the certificate issued for that name.",
        s814.whoRegisters,
        s817.issued,
      ),
      reading("A company can itself use a separate business name.", s814.company),
      reading(
        "A business-name certificate alone therefore does not establish that the named business was incorporated as a company or identify a limited-liability structure.",
        s817.issued,
        incorporated,
      ),
      practice(
        "For practical recordkeeping, keep a short identity sheet beside the registration documents: registered operator, legal form, exact corporate name if any, trading name, registration reference and certificate date.",
      ),
      practice("This sheet is an organisational aid, not a substitute for the official record."),
      practice(
        "Use the CAC portal (https://icrp.cac.gov.ng/) to check the relevant registration service or obtain help correcting a mismatch.",
      ),
      practice(
        "If you cannot establish the operator or registration type, pause before describing the business as a limited company in a document.",
      ),
      limit(
        "This guide helps identify existing records; it does not choose the best structure for your circumstances, assess incorporation eligibility or determine your tax treatment.",
      ),
    ],
  },
  {
    id: "GUD-03",
    risk: "governance",
    sentences: [
      reading(
        "A business-name registration certificate is more than a file to save after registration.",
        s817.displayed,
      ),
      s(
        "Section 817 of the Companies and Allied Matters Act addresses how the certificate is issued and displayed by the individual, firm or corporation registered under the business-name provisions.",
        s817.issued,
        s817.displayed,
      ),
      s(
        "The section requires the certificate to be exhibited and maintained in a conspicuous position at the principal place of the registered business.",
        s817.displayed,
      ),
      s(
        "If the business has more than one place of business, it specifies the original certificate at the principal place and a copy certified by the Registrar at each other place.",
        s817.otherPlaces,
      ),
      reading(
        "An ordinary photocopy should not automatically be described as the certified copy mentioned in the Act.",
        q(
          "CAMA-817",
          "a copy of the certificate certified by the Registrar",
          "shall be exhibited",
          "section 817(4), printed page A408",
        ),
      ),
      link("There are practical exceptions and changes to account for."),
      s(
        "If CAC issues a fresh certificate after a registered change, the display requirement applies to that fresh certificate.",
        q(
          "CAMA-817",
          "(a) where a fresh certificate has been issued under subsection (2)",
          "shall apply to such fresh certificate",
          "section 817(3), printed page A408",
        ),
      ),
      s(
        "Where a certificate is lost, destroyed or illegible, the section allows a copy certified by the Registrar to be displayed instead.",
        q(
          "CAMA-817",
          "(b) where any certificate has been lost or destroyed or rendered illegible",
          "place of the original.",
          "section 817(3), printed page A408",
        ),
      ),
      practice("Keep those circumstances separate from simply choosing to print an unverified document."),
      s(
        "CAC's current business-name page describes electronic certificates and certified registration extracts.",
        q(
          "CAC-BN-PROCESS",
          "Now registration is end-to-end",
          "Certified Extract of registration information",
          "heading: electronic Certificate of Registration and Certified Extract of registration information",
        ),
      ),
      practice(
        "If your certificate was issued electronically, confirm with CAC which current official document or certified copy meets the display requirement for your premises; this guide does not assume that a phone screenshot satisfies it.",
      ),
      practice(
        "As an optional check, list your principal and other business locations, identify the certificate version held at each, and record any replacement needed.",
      ),
      practice("Use the CAC portal (https://icrp.cac.gov.ng/) for the official document or support route."),
      limit(
        "This entry concerns registered business names, not a universal certificate-display rule for every company, permit or online activity, and it does not quote a penalty amount.",
      ),
    ],
  },
  {
    id: "GUD-04",
    risk: "governance",
    sentences: [
      reading(
        "After registering a business name, keep the registered particulars aligned with the business.",
        s818.notify,
      ),
      s(
        "Section 818 of the Companies and Allied Matters Act applies when a particular required under section 815 changes.",
        q(
          "CAMA-818",
          "Whenever a change is made or occurs",
          "registered under that section",
          "section 818(1), printed page A409",
        ),
      ),
      s("It expressly excludes a change in an individual's age from this notification rule.", s818.notAge),
      s(
        "Section 815's particulars include the business name, the general nature of the business and the addresses of the principal and other places of business.",
        q(
          "CAMA-815",
          "(a) the business name or, if the business is carried on under two or more",
          "(d) the full postal address of every other place of business ;",
          "section 815(1), printed page A406",
        ),
      ),
      s(
        "Depending on the operator, they also include particulars of individuals, partners or a company.",
        q(
          "CAMA-815",
          "(e) where the registration to be effected is that of a firm",
          "registered office of the company ; and",
          "section 815(1), printed page A406",
        ),
      ),
      reading(
        "A move, a change in the business name or a change in the recorded operator details should therefore prompt a check of the registration record rather than only an update to your website or invoices.",
        s818.notify,
      ),
      s(
        "The statute requires notification to the Registrar within 28 days after the relevant change.",
        s818.within,
      ),
      s(
        "The notice must be in writing and signed in the manner section 815 provides.",
        q(
          "CAMA-818",
          "(2) The notice required under subsection (1) shall be in writing",
          "provided in section 815 of this Act.",
          "section 818(2), printed page A409",
        ),
      ),
      reading(
        "This is the statutory interval, not a calculation of your personal deadline: establish the actual change, its date and the appropriate signer before setting a reminder.",
        s818.within,
      ),
      reading(
        "Do not substitute an assumed date or treat every ordinary birthday as a filing event.",
        s818.notAge,
      ),
      practice(
        "As an optional working method, keep a change log showing the old information, the new information, when the change occurred and the supporting document.",
      ),
      practice(
        "Check the CAC portal (https://icrp.cac.gov.ng/) for the current change-registration process and retain the submission acknowledgement and updated record.",
      ),
      s(
        "Section 817 permits CAC to amend the previous certificate or issue a new one after a registered change.",
        s817.changed,
      ),
      limit("This entry concerns the registered particulars of a business name."),
      limit(
        "A company changing its own corporate particulars, a business ceasing operations, and changes to tax records can involve different procedures; completing one update should not be treated as proof that every register has been updated.",
      ),
    ],
  },
  {
    id: "GUD-05",
    risk: "governance",
    ownNumbers: [
      {
        text: "14 November 2026",
        why: "The day Valo read the portal's notice: its own record, not words of the notice.",
      },
    ],
    sentences: [
      reading(
        "Running a business under a registered business name involves continuing records, not just the original certificate.",
        s822.duty,
      ),
      s(
        "Section 822 of the Companies and Allied Matters Act requires an individual, firm or corporation carrying on business under that registered name to deliver an annual return to CAC.",
        s822.duty,
      ),
      s(
        "The calendar year in which the business name is registered is expressly excluded.",
        q(
          "CAMA-822",
          "except the calendar year in which the business name is registered",
          "except the calendar year in which the business name is registered",
          "section 822(1), printed page A411",
        ),
      ),
      s(
        "The return describes the operator and the nature of the business.",
        q(
          "CAMA-822",
          "showing the particulars",
          "the nature of the business carried on.",
          "section 822(1), printed page A411",
        ),
      ),
      s(
        "It must be accompanied by a financial statement covering the preceding January-to-December period.",
        q(
          "CAMA-822",
          "(2) The returns shall be accompanied by the financial statement",
          "January 1 to December 31.",
          "section 822(2), printed page A411",
        ),
      ),
      s(
        "The section specifies who signs: the individuals for an individual or an all-individual firm, and a director and secretary for a corporation or corporate partner.",
        s822.signed,
      ),
      reading(
        "Do not assume that one unnamed staff member can sign every kind of operator's return.",
        s822.signed,
      ),
      s("Section 822 states 30 June as the annual filing date for the years it covers.", s822.date),
      practice(
        "Check the registration year, the reporting period, the operator and the current CAC filing route before deciding what is due.",
      ),
      reading(
        "This is a business-name registry return; paying tax or submitting a company's tax return does not itself supply the return described here.",
        s822.duty,
      ),
      practice(
        "Prepare the registration particulars and the relevant financial statement, then use the CAC portal (https://icrp.cac.gov.ng/).",
      ),
      s(
        "Its notice checked on 14 November 2026 says annual-return filing is available for business names registered before July 2025 while a system upgrade is in progress.",
        q(
          "CAC-PORTAL-NOTICE",
          "Filing of annual returns is now available",
          "will be introduced soon.",
          "heading: Annual Returns for Business Names",
        ),
      ),
      practice(
        "If your registration is newer or the service is unavailable, ask CAC for the correct submission route.",
      ),
      reading("A portal limitation should not be assumed to create a legal extension.", s822.date),
      practice(
        "An optional filing folder can hold the reporting period, submitted version, authorised signatures, acknowledgement and any CAC response.",
      ),
      limit(
        "This guide does not decide late-filing penalties, whether a business has legally ceased, or how outstanding historic years should be regularised.",
      ),
    ],
  },
  {
    id: "GUD-06",
    risk: "governance",
    sentences: [
      reading(
        "A company's annual return to CAC is a corporate-registry filing.",
        q(
          "CAMA-417",
          "Every company shall, once at least in every year, make and deliver",
          "an annual return",
          "section 417, printed page A238",
        ),
      ),
      s(
        "Section 417 of the Companies and Allied Matters Act establishes the annual-return duty, while sections 418 to 420 distinguish the applicable forms for different company categories.",
        s417.duty,
        ...forms,
      ),
      reading(
        "This filing should not be confused with the company's income-tax return to the revenue authority.",
        s417.duty,
      ),
      link("The Act contains exceptions and category-specific requirements."),
      s(
        "Section 417 excludes the incorporation year and, where its stated condition concerning an annual general meeting is met, the following year.",
        s417.notInFirstYears,
      ),
      s(
        "Section 237 contains its own meeting exceptions.",
        q(
          "CAMA-237",
          "Except in the case of a small company or any company having",
          "a single shareholder",
          "section 237(1), printed page A146",
        ),
        q(
          "CAMA-237",
          "(a) so long as a company holds its first annual general meeting within 18",
          "year ; or",
          "section 237(1), printed page A146",
        ),
      ),
      reading(
        "Do not turn an exemption from holding a meeting into a permanent exemption from annual returns, or assume that a business calling itself “small” has established the Act's small-company classification.",
        s417.notInFirstYears,
        smallExempt,
      ),
      reading("The return's particulars and attachments depend on the company type.", ...forms),
      s(
        "Sections 422 and 424 address accompanying documents and exceptions, and section 423 requires particular certificates for private and small companies.",
        annexed,
        q(
          "CAMA-424",
          "An unlimited company shall be exempted from the",
          "documents to be annexed to the",
          "section 424(1), printed page A240",
        ),
        smallExempt,
        privateCertificate,
        q(
          "CAMA-423",
          "(2) A small company shall in addition to the certificate required under",
          "and the secretary that—",
          "section 423(2), printed page A240",
        ),
      ),
      reading(
        "A complete filing therefore needs more than a registration number and a payment receipt.",
        annexed,
        privateCertificate,
      ),
      practice("Verify the company's legal category and the documents appropriate to it."),
      s(
        "Section 421 links timing to the annual general meeting and expressly does not apply to a company with only one member.",
        q(
          "CAMA-421",
          "The annual return shall be completed, signed by a director",
          "after the annual general meeting for the year",
          "section 421(1), printed page A239",
        ),
        q(
          "CAMA-421",
          "(2) This section does not apply to companies with only one member.",
          "(2) This section does not apply to companies with only one member.",
          "section 421(2), printed page A239",
        ),
      ),
      limit("This guide does not assign one universal deadline to every company."),
      practice(
        "Confirm the incorporation date, return year, membership, meeting facts and any applicable extension with CAC before setting a date.",
      ),
      practice(
        "As an optional preparation step, keep a register of return years, the current corporate particulars, supporting financial documents, responsible signers and acknowledgements.",
      ),
      practice("Use the CAC portal (https://icrp.cac.gov.ng/) for the current filing route."),
      practice(
        "The distinction between this filing and tax returns can help prevent one successful submission being mistaken for completion of both obligations.",
      ),
    ],
  },
  {
    id: "GUD-07",
    risk: "governance",
    sentences: [
      s(
        "If the business is a company, section 374 of the Companies and Allied Matters Act requires accounting records sufficient to explain its transactions and show its financial position with reasonable accuracy.",
        s374.kept,
        q(
          "CAMA-374",
          "(2) The accounting records are sufficient to show and explain the",
          "of the company ; and",
          "section 374(2), printed page A210",
        ),
      ),
      s(
        "The records must also support the directors in preparing financial statements that meet the Act's requirements.",
        q(
          "CAMA-374",
          "(b) enable the directors to ensure that any financial statements prepared",
          "content of the company’s financial statements.",
          "section 374(2), printed page A210",
        ),
      ),
      reading(
        "A list of bank balances alone may not explain what the company received, spent, owns or owes.",
        s374.contain,
      ),
      s(
        "The section specifically calls for day-to-day entries of money received and spent, the matters to which those entries relate, and a record of assets and liabilities.",
        s374.contain,
      ),
      s(
        "A company dealing in goods also needs year-end stock statements and the underlying stocktaking records.",
        q(
          "CAMA-374",
          "(4) If the business of the company involves dealing in goods",
          "has been or is to be prepared ; and",
          "section 374(4), printed page A210",
        ),
      ),
      s(
        "Its rule on detailed records of goods bought and sold includes an exception for goods sold in ordinary retail trade; that exception does not erase the wider accounting-record duty.",
        q(
          "CAMA-374",
          "(c) except in the case of goods sold by way of ordinary retail trade",
          "to enable all these to be identified.",
          "section 374(4), printed page A210",
        ),
      ),
      s(
        "Section 375 requires the records to be kept at the registered office or another place in Nigeria chosen by the directors, and to be open to inspection by company officers.",
        q(
          "CAMA-375",
          "The accounting records of a company shall be kept at its",
          "open to inspection by the officers of the company.",
          "section 375(1), printed page A210",
        ),
      ),
      s(
        "Subject to directions under the relevant winding-up rules, the records must be preserved for six years from when they were made.",
        sixYearsFromMade,
      ),
      s(
        "The section also addresses electronic copies in addition to original hard copies and requires attention to the quality and security of the technology used.",
        q(
          "CAMA-375",
          "(3) A company may, in addition to original hard copies, keep electronic",
          "encryption.",
          "section 375(3), printed page A211",
        ),
      ),
      practice(
        "As optional organisation, link each transaction to its invoice, receipt or other explanation, reconcile bank activity, maintain an asset-and-liability list, and keep stocktaking evidence where relevant.",
      ),
      practice("Restrict editing access and maintain recoverable copies."),
      reading("These are company-law records.", s374.kept),
      reading(
        "Tax records can have a different retention starting point, so do not automatically delete a document when one clock expires.",
        sixYearsFromMade,
        s31.sixYearsAfterAssessment,
      ),
      practice(
        "Use the CAC official site (https://www.cac.gov.ng/) for company-record queries and consult the separate tax-record guidance for the tax requirement.",
      ),
    ],
  },
  {
    id: "GUD-08",
    risk: "tax",
    sentences: [
      reading(
        "A Tax ID identifies a person for tax administration; it is not a certificate that every tax obligation has been completed.",
        taxId.register,
      ),
      s(
        "Section 4 of the Nigeria Tax Administration Act requires a taxable person to register with the relevant tax authority and obtain a Tax ID.",
        taxId.register,
      ),
      reading(
        "Which person and authority are involved depends on the actual operator and tax circumstances, not simply the trading name on a shop sign.",
        q(
          "NTAA-147-DEFINITIONS",
          '"Taxable Person" means person who carries out economic activity in a',
          "Government acting in that capacity ;",
          'heading: "Taxable Person" means person who carries out economic activity',
        ),
        q(
          "NTAA-147-DEFINITIONS",
          '"Tax Authority" means the Nigeria Revenue Service, or the Revenue',
          "Federal Capital Territory in Nigeria ;",
          'heading: "Tax Authority" means the Nigeria Revenue Service',
        ),
      ),
      s("Section 7 contains useful safeguards.", taxId.onlyOne, taxId.notTransferable),
      s("A person with a valid Tax ID must not apply for or be issued another one.", taxId.onlyOne),
      s(
        "Multiple IDs should be reported to the relevant tax authority for unification, and one person's ID cannot be transferred to or used by another person.",
        q(
          "NTAA-7",
          "(6) A person who discovers that a taxable person has multiple Tax IDs,",
          "for unification.",
          "section 7(6), printed page A267",
        ),
        taxId.notTransferable,
      ),
      reading(
        "A change of trading name should therefore not be treated automatically as a reason to create an unrelated new taxpayer identity.",
        taxId.onlyOne,
      ),
      s(
        "The current NRS/JRB Tax ID portal (https://taxid.nrs.gov.ng/) provides retrieval using existing identity information.",
        q(
          "TAXID-HOW-IT-WORKS",
          "Tax ID retrieval is a critical step in confirming that your tax identity",
          "registration for businesses",
          taxIdPage,
        ),
      ),
      s(
        "Its explanation distinguishes retrieval of an existing identity from a fresh registration exercise.",
        q(
          "TAXID-HOW-IT-WORKS",
          "Tax ID retrieval is therefore not a registration exercise",
          "an existing national tax identity",
          taxIdPage,
        ),
      ),
      s(
        "It uses NIN details for individuals and CAC registration information for businesses, with the further checks shown by the official service.",
        q(
          "TAXID-HOW-IT-WORKS",
          "Individuals provide their National Identification Number (NIN)",
          "to complete the retrieval process.",
          taxIdPage,
        ),
      ),
      practice(
        "Enter sensitive identity information directly on the official service rather than placing it in a general business-document draft.",
      ),
      practice(
        "As optional preparation, establish the legal operator, check whether an ID already exists, and compare the returned identity with the official registration details.",
      ),
      practice(
        "If the record is missing, duplicated, inactive or mismatched, contact the relevant tax authority through its official route; do not invent a number or borrow another business's ID.",
        taxId.notTransferable,
      ),
      limit("This entry concerns current domestic tax administration."),
      limit(
        "It does not decide whether every reader is a taxable person, the correct treatment of non-residents, the amount of tax due, or whether a past tax filing was valid.",
      ),
    ],
  },
  {
    id: "GUD-09",
    risk: "tax",
    sentences: [
      reading(
        "For a positively identified Nigerian company, do not decide whether to prepare an annual income-tax return solely by looking at the amount of tax payable.",
        q(
          "NTAA-147-DEFINITIONS",
          '"Nigerian Company" means —',
          "any company formed or incorporated under any law in Nigeria ;",
          'heading: "Nigerian Company" means',
        ),
        s11.file,
      ),
      s(
        "Section 11 of the Nigeria Tax Administration Act requires a company to file a self-assessment return at least annually, with or without a notice from the Service, whether or not it is liable to pay tax.",
        s11.file,
      ),
      reading("A zero-tax calculation does not by itself remove that filing requirement.", s11.file),
      s(
        "The return includes the prescribed self-assessment information, financial statements and tax computations, payment evidence where tax is due, and a principal officer's attestation.",
        q(
          "NTAA-11",
          "(a) a duly completed self-assessment form as may be prescribed by the",
          "by a principal officer of the company.",
          "section 11(1), printed page A269",
        ),
      ),
      s(
        "The section contains a small-company alternative concerning the statement of accounts in place of audited financial statements.",
        q(
          "NTAA-11",
          "Provided that the return of a small company may contain a statement of",
          "in place of audited financial statements;",
          "section 11(1), printed page A269",
        ),
      ),
      limit(
        "This guide does not decide whether your company qualifies for that alternative; a descriptive label such as “small business” is insufficient.",
      ),
      s(
        "Section 11 also requires returns for the cessation year and outstanding returns when a company permanently ceases operations.",
        s11.ceased,
      ),
      reading(
        "Closing a shop or stopping sales should not automatically remove the filing item from your records.",
        s11.ceased,
      ),
      s(
        "The Act requires a designated representative for tax matters; if that representative is a paid agent, the applicable accreditation requirement matters.",
        q(
          "NTAA-11",
          "(a) every company shall designate a representative or representatives",
          "Act.",
          "section 11(6), printed page A270",
        ),
      ),
      s(
        "Section 33 also permits taxpayers to represent themselves.",
        q(
          "NTAA-33",
          "For the purpose of compliance with this Act or any other law,",
          "accredited by the relevant tax authority.",
          "section 33(1), printed page A282",
        ),
      ),
      practice(
        "As optional preparation, gather the incorporation record, Tax ID, accounting period, financial records, previous filings and any cessation information.",
      ),
      practice(
        "Confirm the current submission route with the Nigeria Revenue Service (https://www.nrs.gov.ng/) and preserve the filed version and acknowledgement.",
      ),
      limit("This entry does not calculate a deadline, tax rate or liability."),
      reading(
        "Timing depends on company and accounting-period facts, and older or transitional periods need separate treatment.",
        q(
          "NTAA-11",
          "(5) Subject to this Act, any tax law or regulation, the time of filing returns",
          "shall be —",
          "section 11(5), printed page A270",
        ),
      ),
      s(
        "Non-resident companies have additional provisions and exceptions.",
        q(
          "NTAA-11",
          "(2) Where a non-resident company derives profit from or is taxable in",
          "a return for the relevant year of assessment containing",
          "section 11(2), printed page A269",
        ),
        q(
          "NTAA-11",
          "(3) The provisions of subsection (2) shall not apply in a year of assessment",
          "is the final tax under Nigeria Tax Act.",
          "section 11(3), printed page A270",
        ),
      ),
      reading(
        "A CAC annual return is a different filing, and completing it does not supply this income-tax return.",
        s11.file,
      ),
    ],
  },
  {
    id: "GUD-10",
    risk: "tax",
    sentences: [
      reading(
        "Tax records are needed to explain the transactions behind a return, including when the final tax payable is zero.",
        s31.keep,
        s31.enough,
      ),
      s(
        "Section 31 of the Nigeria Tax Administration Act requires books or records of account whether or not a person is liable to pay tax.",
        s31.keep,
      ),
      s(
        "The records must contain enough information about relevant transactions to establish the person's tax liability.",
        s31.enough,
      ),
      reading(
        "Do not treat a belief that the business owes no tax as a reason to discard its records.",
        s31.keep,
      ),
      s(
        "The section requires the records to be in English and consistent with any format prescribed by the relevant tax authority.",
        s31.format,
      ),
      s(
        "Where records are maintained in another language, the authority can demand an English translation, at the person's expense, certified by a sworn translator.",
        s31.translated,
      ),
      reading(
        "An informal machine translation should not be represented as that certified translation.",
        s31.translated,
      ),
      s(
        "Section 31 states a minimum retention period of six years after the year of assessment to which the income relates.",
        s31.sixYearsAfterAssessment,
      ),
      reading(
        "That is a different starting point from the company-law requirement measured from when a company accounting record was made.",
        s31.sixYearsAfterAssessment,
        sixYearsFromMade,
      ),
      reading(
        "Do not combine the two into a single automatic deletion date.",
        s31.sixYearsAfterAssessment,
        sixYearsFromMade,
      ),
      limit(
        "Historical periods, other applicable retention duties and an active query or dispute need their own checks before disposal.",
      ),
      practice(
        "As optional practice, organise supporting documents by relevant period and transaction: sales, purchases, receipts, expenses, assets, liabilities and the explanations linking them to the accounts.",
      ),
      practice("Preserve the original information, track corrections and keep a recoverable copy."),
      practice(
        "These categories are a practical filing method, not an exhaustive statutory list of every business's records.",
      ),
      practice(
        "Ask the relevant tax authority through its official service which prescribed record format applies to your situation; the NRS official site (https://www.nrs.gov.ng/) is a starting route for federal company-tax matters.",
        s31.format,
      ),
      limit(
        "This guide does not certify a tax calculation, prescribe software or authorise destruction of particular records.",
      ),
    ],
  },
];
