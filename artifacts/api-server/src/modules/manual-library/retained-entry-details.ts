/**
 * The entry details proposed for the 40 retained template drafts (docs/architecture/library-entries.md):
 * what each template is for, what a customer needs to complete it, its limits, the retained guides
 * that name it as related, and the reviewed route's risk class it falls in. Each is written from the
 * draft's own "Purpose" paragraph where it has one, and from its sections otherwise, in the site's
 * words.
 *
 * They are proposals. Filing a draft files them with it, and a Content editor previews them with the
 * text and releases them, or corrects them first. Nothing here is published.
 */
export type RiskClass =
  "general" | "tax" | "employment" | "privacy" | "governance" | "contracts" | "regulated_sector";
export type ProposedEntryDetails = {
  /** The reviewed route's risk class. Any class but general asks the limits to say when independent
   * advice may be useful (DOC-003's acceptance). */
  risk: RiskClass;
  purpose: string;
  needs: readonly string[];
  limits: string;
  /** The retained guides (GUIDE-Cxx, GUD-xx) whose own text names this template as related. */
  guides: readonly string[];
};

export const RETAINED_ENTRY_DETAILS: Readonly<Record<string, ProposedEntryDetails>> = {
  "TPL-01": {
    risk: "general",
    purpose:
      "Ask a customer to pay for goods or work you supplied, with the items, amounts, due date and how to pay, from the details your business enters.",
    needs: [
      "Your business's name and contact details",
      "The customer's name and address",
      "An invoice number and the date",
      "Each item or service, with its quantity and price",
      "Any discount, tax or other charge you apply",
      "The payment due date and how the customer can pay",
    ],
    limits:
      "An invoice asks for payment. It is not proof that payment has arrived, and it is not a government tax invoice. It does not decide whether VAT or another tax applies to your sale; check that with the tax authority or a tax adviser.",
    guides: ["GUIDE-C01", "GUIDE-C02", "GUIDE-C03", "GUIDE-C06"],
  },
  "TPL-02": {
    risk: "general",
    purpose:
      "Offer a customer a price for goods or work before they decide, with what is included, what is not, and how long the price stands.",
    needs: [
      "Your business's name and contact details",
      "The customer's name",
      "A quotation number and the date",
      "What you will supply, with quantities and prices",
      "What is not included, and any assumptions still to confirm",
      "How long the quotation stays open",
    ],
    limits:
      "A quotation is an offer for the customer to consider. It does not show that the customer accepted it, and it is not an invoice or proof of payment. Agree any binding terms separately, in writing.",
    guides: ["GUIDE-C02"],
  },
  "TPL-03": {
    risk: "general",
    purpose:
      "Record a payment your business actually received: who paid, how much, when, how, and what it was for.",
    needs: [
      "Your business's name and contact details",
      "The payer's name",
      "A receipt number and the date the payment arrived",
      "The amount received and how it was paid",
      "What the payment was for, such as an invoice number",
    ],
    limits:
      "Issue a receipt only for money you have actually received. It records what your business says it received; it is not independently verified proof of payment. Never make one from an invoice, a customer's message or a screenshot alone.",
    guides: ["GUIDE-C03"],
  },
  "TPL-04": {
    risk: "general",
    purpose:
      "Ask a supplier to provide goods or work, with the items, the agreed or proposed price, delivery details and who authorised the order.",
    needs: [
      "Your business's name and delivery address",
      "The supplier's name and contact details",
      "A purchase order number and the date",
      "Each item, with its quantity, unit and price",
      "The delivery date and place",
      "Who in your business authorised the order",
    ],
    limits:
      "A purchase order is your request. It does not show that the supplier accepted it, and it does not replace any contract you have with them. Keep the supplier's confirmation with it.",
    guides: ["GUIDE-C02", "GUIDE-C04", "GUIDE-C06"],
  },
  "TPL-05": {
    risk: "general",
    purpose:
      "Describe goods you send to a customer and record what they actually received, with any shortage or damage noted at handover.",
    needs: [
      "Your business's name and contact details",
      "The customer's name and delivery address",
      "A delivery note number and the dispatch date",
      "Each item sent, with its quantity and unit",
      "Who received the goods, and when",
      "Any shortage, damage or refusal noted at handover",
    ],
    limits:
      "A delivery note that has been prepared or sent is not proof of delivery, payment, product quality or regulatory clearance. Only the receiver's own record at handover shows what arrived.",
    guides: ["GUIDE-C04", "GUIDE-C06", "GUIDE-C08"],
  },
  "TPL-06": {
    risk: "general",
    purpose:
      "Let a person ask the business to repay expenses they paid for it, and record the business's decision and any repayment actually made.",
    needs: [
      "The claimant's name and role",
      "Each expense, with its date, description and amount",
      "A receipt or other evidence for each expense",
      "Who reviewed the claim, and the decision",
      "The date and method of any repayment",
    ],
    limits:
      "Submitting the form does not approve the expenses, show that they were paid, or decide their tax treatment. The business's own decision, recorded on the form, does.",
    guides: ["GUIDE-C05"],
  },
  "TPL-07": {
    risk: "general",
    purpose:
      "Keep a written record of the stock received, issued and counted for one item at one location, with a running balance.",
    needs: [
      "Your business's name and the stock location",
      "The item's code, name and unit of measure",
      "The opening quantity, and how it was established",
      "Each movement: its date, reference, quantity and who entered it",
      "Physical counts, and any differences found",
    ],
    limits:
      "The register is a blank form to complete by hand. It does not calculate, check what is entered, or show ownership, product approval, condition or a value for your accounts.",
    guides: ["GUIDE-C04", "GUIDE-C06", "GUIDE-C11", "GUIDE-C12"],
  },
  "TPL-08": {
    risk: "general",
    purpose:
      "Record what was discussed, decided and assigned at an ordinary business meeting, and who will do what by when.",
    needs: [
      "The meeting's date, time and place",
      "Who attended, and who sent apologies",
      "Each item discussed, with any decision made",
      "Each action, with its owner and due date",
    ],
    limits:
      "These minutes are for ordinary business meetings. A company's board, trustees or a regulated body may have formal requirements for their meetings, and this template does not show that those are met. Use the board resolution template for a board's formal decisions.",
    guides: ["GUIDE-C07", "GUIDE-C11", "GUIDE-C12"],
  },
  "TPL-09": {
    risk: "general",
    purpose:
      "Record a customer's complaint, the outcome they ask for, and how your business responded and followed up.",
    needs: [
      "The customer's name and how to contact them",
      "The date the complaint was received",
      "What the customer reported, in their own words where possible",
      "The outcome the customer asked for",
      "What your business did, and when it replied",
    ],
    limits:
      "A complaint record is an account of what was reported. It does not establish that an allegation is true, and it does not approve a refund or any other remedy.",
    guides: ["GUIDE-C08"],
  },
  "TPL-10": {
    risk: "employment",
    purpose: "Let an employee ask for time away from work, and record the business's actual answer.",
    needs: [
      "The employee's name and role",
      "The type of leave asked for",
      "The first and last day of the leave",
      "Who approved or declined it, and when",
      "Any note on pay or cover during the absence",
    ],
    limits:
      "Submitting the form does not establish entitlement, available leave, approval or how the absence is paid. Those follow the employee's contract, your leave policy and the law. If entitlement is in dispute, independent advice may be useful.",
    guides: ["GUD-29", "GUD-30"],
  },
  "TPL-11": {
    risk: "employment",
    purpose:
      "Plan a new colleague's first days: introductions, equipment, system access, training and the handover of their work.",
    needs: [
      "The new colleague's name, role and start date",
      "Their manager or contact person",
      "The equipment and system access to arrange",
      "The introductions and training to schedule",
      "The documents to give them or collect from them",
    ],
    limits:
      "The checklist organises practical steps. It is not an employment contract, a legal eligibility check or proof that every required employment step was taken. Where employment terms or legal checks are in question, independent advice may be useful.",
    guides: ["GUD-27", "GUIDE-C09", "GUIDE-C11"],
  },
  "TPL-12": {
    risk: "general",
    purpose:
      "Remind a customer politely about an amount your records show as outstanding, and invite them to pay or to tell you of a problem.",
    needs: [
      "Your business's name and contact details",
      "The customer's name and address",
      "The invoice number, date and amount",
      "Any payments or credits already received",
      "How the customer can pay or contact you",
    ],
    limits:
      "Check your records before you send it. The letter is not a receipt or a legal demand, and it does not show that the debt is undisputed. If a customer disputes the amount or refuses to pay, independent advice may be useful before you take further steps.",
    guides: ["GUIDE-C03"],
  },
  "TPL-13": {
    risk: "contracts",
    purpose:
      "Set out an ordinary service engagement between two businesses: the services, delivery and review, changes, fees, rights in the work, confidentiality and how it ends.",
    needs: [
      "Each party's legal name, type, registration reference and address",
      "The services, the deliverables and how they are accepted",
      "The fees, expenses and payment terms",
      "Who owns or may use the work produced",
      "The duration, notice and how either party may end it",
      "The governing law and where disputes will be decided",
    ],
    limits:
      "A starting draft for an ordinary commercial service. It does not cover regulated professional services, employment or work that needs a licence, and it does not show that its terms suit your deal or will be upheld. Read it in full and complete every schedule before signing. For a large, unusual or risky engagement, independent legal advice may be useful.",
    guides: [],
  },
  "TPL-14": {
    risk: "contracts",
    purpose:
      "Engage a consultant for defined commercial analysis or advice: the questions, methods, deliverables, fees, independence, reliance on the reports, and confidentiality.",
    needs: [
      "Each party's legal name, type, registration reference and address",
      "The questions to answer and the deliverables expected",
      "The milestones, review periods and decision-makers",
      "The fees, expenses and payment terms",
      "Who may rely on the reports, and for what",
      "The confidential information and data the consultant will see",
    ],
    limits:
      "A starting draft for defined commercial advice. It does not authorise regulated professional services, and it does not show that its terms suit your engagement or will be upheld. Complete every schedule before signing. Where the advice affects legal, financial or regulatory decisions, independent legal advice may be useful.",
    guides: [],
  },
  "TPL-15": {
    risk: "contracts",
    purpose:
      "Protect information two businesses share while they discuss a project or a possible deal, for a stated purpose and period, with each party bound the same way.",
    needs: [
      "Each party's legal name, type and address",
      "The purpose the information may be used for",
      "How long information is shared, and how long it stays protected",
      "The named contacts who may receive it",
      "How information is returned or destroyed at the end",
    ],
    limits:
      "The agreement is mutual: each party gives and receives information on the same terms. It does not oblige either party to make a deal, and it cannot make public or independently known information confidential. How well it protects you depends on how it is completed and used. For valuable or sensitive information, independent legal advice may be useful.",
    guides: [],
  },
  "TPL-16": {
    risk: "employment",
    purpose:
      "Set out the terms of employment agreed with an employee: role, start, pay, hours, leave, conduct, notice and ending, with a schedule of their individual terms.",
    needs: [
      "The employer's and the employee's legal names and addresses",
      "The role, the duties and the place of work",
      "The start date, and the end date of a fixed term",
      "The pay, how and when it is paid, and any agreed deductions",
      "The working hours, leave and other benefits",
      "The notice periods, and how employment may end",
    ],
    limits:
      "A starting draft for an ordinary employment. It does not decide which laws, collective agreements or sector rules apply to your employee, and it adds no probation period unless you agree one. Check every term against the law and the employee's actual job before signing. Independent legal advice may be useful, especially for senior, unusual or sensitive roles.",
    guides: ["GUD-27", "GUD-28", "GUD-29", "GUD-30"],
  },
  "TPL-17": {
    risk: "employment",
    purpose:
      "Offer a candidate a job on stated terms, with any genuine conditions, and record their response.",
    needs: [
      "The employer's name, and who is authorised to make the offer",
      "The candidate's name",
      "The role, the reporting contact, the workplace and the start date",
      "The pay, working arrangements, leave and notice",
      "Any condition the offer depends on",
      "When and how the candidate should respond",
    ],
    limits:
      "An offer letter states proposed terms; the employment contract sets them out in full. Add only conditions that are necessary and lawful for the role. The letter does not check that the offer meets employment law. Independent legal advice may be useful for unusual conditions or terms.",
    guides: ["GUD-27"],
  },
  "TPL-18": {
    risk: "contracts",
    purpose:
      "Set terms for repeat purchases of goods from a supplier: orders, specifications, prices, invoices, delivery, inspection, faulty goods and how the arrangement ends.",
    needs: [
      "Each party's legal name, type and address",
      "The goods and their specifications",
      "The prices, invoicing and payment terms",
      "The delivery terms, and when risk and ownership pass",
      "How goods are inspected, and what happens to faulty ones",
      "The duration, notice and how either party may end it",
    ],
    limits:
      "A draft for negotiation between businesses that buy and sell goods. It is not a construction, services or regulated-product contract, and it does not show that its terms suit your trade or will be upheld. Resolve every open term before signing. For a large or regulated supply, independent legal advice may be useful.",
    guides: [],
  },
  "TPL-19": {
    risk: "contracts",
    purpose:
      "Record a single sale of identified goods between a seller and a buyer: description, price, payment, handover, checks, remedies and cancellation.",
    needs: [
      "Each party's legal name and address",
      "A description of the goods, with any serial or batch numbers",
      "The price, the currency and the payment schedule",
      "When, where and how the goods are handed over",
      "The checks the buyer may make, and the remedies agreed",
      "What happens if either party cannot complete",
    ],
    limits:
      "A draft for negotiating one sale of movable goods. It does not cover land or regulated products, and it does not show which consumer protections apply when the buyer is an individual. Complete every material field before signing. For a valuable or unusual sale, independent legal advice may be useful.",
    guides: [],
  },
  "TPL-20": {
    risk: "governance",
    purpose:
      "Record how the partners in an ordinary partnership will run their business together: contributions, roles and authority, profits and losses, new partners, exits and closure.",
    needs: [
      "Each partner's legal name and address",
      "The business's name, purpose and place of business",
      "What each partner contributes",
      "How decisions are made, and who may act for the partnership",
      "How profits, losses and drawings are shared",
      "What happens when a partner joins, leaves or dies",
    ],
    limits:
      "A draft for negotiating an ordinary partnership, not a limited liability partnership or a company. State law and registration rules may affect it. It is not ready to sign until the structure, the law that applies and every material term are settled. Independent legal advice is advisable before the partners sign.",
    guides: [],
  },
  "TPL-21": {
    risk: "contracts",
    purpose:
      "Engage an independent contractor for a defined project: the work, how it is done and accepted, the price and payment, rights in the work, confidentiality and ending.",
    needs: [
      "Each party's legal name, type and address",
      "The project, the deliverables and how they are accepted",
      "How the work is organised, including who may substitute",
      "The price, invoicing and payment terms",
      "Who owns or may use the work produced",
      "How either party may end the agreement",
    ],
    limits:
      "Calling someone a contractor does not decide their status: the actual working arrangements do. If the person works like an employee, this agreement may not fit. Check the arrangements before signing. Independent legal advice may be useful where status is unclear.",
    guides: [],
  },
  "TPL-22": {
    risk: "general",
    purpose:
      "Explain to a customer a piece of work you propose: the need it meets, the outputs you will deliver, the timing and the price.",
    needs: [
      "Your business's name and contact details",
      "The customer's name and their need",
      "The work proposed and its outputs",
      "The timetable and any assumptions",
      "The price and payment terms",
      "How long the proposal stays open",
    ],
    limits:
      "A proposal does not show that the customer accepted it, and it promises no particular result. Agree binding terms in a separate agreement.",
    guides: [],
  },
  "TPL-23": {
    risk: "contracts",
    purpose:
      "Describe one project's work, deliverables, responsibilities, schedule and review in a single working record, beside the agreement it belongs to.",
    needs: [
      "The project's name and the agreement it sits under",
      "The work, and each deliverable",
      "Who is responsible for what, on each side",
      "The schedule and milestones",
      "How deliverables are reviewed and accepted",
      "How changes are asked for and agreed",
    ],
    limits:
      "A statement of work supplies no legal terms and does not show that a contract exists. Name the agreement it goes with, and check that the two are consistent before use. Where the agreement's terms are unclear, independent legal advice may be useful.",
    guides: [],
  },
  "TPL-24": {
    risk: "general",
    purpose:
      "Compare suppliers' offers against what your business needs, and record the decision and why it was made.",
    needs: [
      "What your business needs to buy, and its requirements",
      "Each supplier's offer, with its price and terms",
      "The criteria you compare the offers on, and any weights",
      "Who evaluated the offers",
      "The decision, and the reasons for it",
    ],
    limits:
      "An internal decision aid. It is not a public-procurement document, a contract award or a certification of any supplier.",
    guides: [],
  },
  "TPL-25": {
    risk: "governance",
    purpose:
      "Record a decision a Nigerian company's board made at a meeting: who attended, any interests declared, what was considered and what was resolved.",
    needs: [
      "The company's exact name, type and registration number",
      "The meeting's date, time and place, or its remote arrangements",
      "The directors present, and the quorum",
      "Any interest a director declared",
      "The matter considered, and the exact resolution",
      "Who signs the record, and where it is kept",
    ],
    limits:
      "For a company's board meeting only, not for trustees, associations or partnerships. It does not check your articles or quorum rules, or whether the decision also needs the members' approval or a filing. Independent legal advice may be useful for significant decisions.",
    guides: [],
  },
  "TPL-26": {
    risk: "employment",
    purpose:
      "Explain your workplace's policies to employees in one place: hours and pay, leave, conduct, safety, equipment, discipline and grievances, and leaving.",
    needs: [
      "Your business's name, and the handbook's version and date",
      "The working hours, pay dates and how pay is made",
      "Your leave and absence arrangements",
      "The contacts for questions and concerns",
      "The policies and documents it refers to",
      "How employees confirm that they received it",
    ],
    limits:
      "A proposed employer policy. It does not state that each choice in it is a legal requirement, and it does not replace employment contracts. Check it against the law and your contracts before you issue it. Independent legal advice may be useful.",
    guides: ["GUD-28"],
  },
  "TPL-27": {
    risk: "employment",
    purpose:
      "Set out how leave works in your business: the leave each group of employees has, how to plan it, illness and unexpected absence, protected leave and records.",
    needs: [
      "Your business's name, and the policy's version and date",
      "Each group of employees it covers",
      "The leave each group is entitled to",
      "How employees ask for and plan leave",
      "How to report illness or an unexpected absence",
      "Who answers questions about leave",
    ],
    limits:
      "The policy does not decide which law, contract or collective agreement applies to each employee. Complete its schedule for each group from their actual terms. Independent legal advice may be useful where entitlements are unclear.",
    guides: ["GUD-29", "GUD-30"],
  },
  "TPL-28": {
    risk: "employment",
    purpose:
      "Set out a fair internal procedure for a concern about an employee's conduct: assessing it, investigating, giving notice, meeting, deciding and reviewing.",
    needs: [
      "Your business's name, and the procedure's version and date",
      "The employees it covers",
      "Who may investigate, and who may decide",
      "How an employee is told of a concern and can respond",
      "How a decision can be reviewed",
      "Where the records are kept",
    ],
    limits:
      "A proposed fair procedure, not a statement that each step is required by law for every employee. Check it against the employees' contracts and any collective agreement. Before dismissing someone or taking other serious action, independent legal advice may be useful.",
    guides: ["GUD-28"],
  },
  "TPL-29": {
    risk: "privacy",
    purpose:
      "Tell people how your business uses their personal information: who is responsible, what you collect and why, who receives it, how long you keep it, and their choices.",
    needs: [
      "Your business's legal and trading names and contact details",
      "Each purpose you use personal information for",
      "The information used, where it comes from and its legal basis",
      "Who receives it, including anyone outside Nigeria",
      "How long you keep each kind of information",
      "How people can make a request or a complaint",
    ],
    limits:
      "The notice must describe your actual processing. It is not a consent form, and it does not make your processing lawful by itself. Complete every row from what your business really does. Where your processing is large, sensitive or unusual, independent advice may be useful.",
    guides: ["GUD-11", "GUD-12", "GUD-13"],
  },
  "TPL-30": {
    risk: "contracts",
    purpose:
      "Set the terms on which people use your business's website and buy from it: permitted use, orders, prices, delivery, returns, content and changes.",
    needs: [
      "Your business's legal and trading names and contact details",
      "Whether you sell to consumers, to businesses, or to both",
      "How orders are placed and accepted",
      "The prices, payment methods, delivery and returns",
      "Your contact for problems and complaints",
    ],
    limits:
      "For an ordinary information or shop website. It excludes banking, lending, investment, healthcare, gambling and marketplaces. It cannot remove rights that consumer law gives your customers. Independent legal advice may be useful before you rely on it.",
    guides: ["GUD-17", "GUD-18"],
  },
  "TPL-31": {
    risk: "privacy",
    purpose:
      "Set out what a service provider may do with personal information it handles for your business: your instructions, security, other processors, requests, incidents, transfers and ending.",
    needs: [
      "Each party's legal name and address",
      "The processing: its purpose, the information, the people and the duration",
      "The security measures in place",
      "Any other processors, and where they are",
      "How security incidents are reported, and how fast",
      "What happens to the information at the end",
    ],
    limits:
      "Only for a provider that processes personal information on your business's behalf. It does not fit a joint or independent controller arrangement. Its schedules must describe the actual processing. Independent advice may be useful for large, sensitive or cross-border processing.",
    guides: ["GUD-14", "GUD-15"],
  },
  "TPL-32": {
    risk: "privacy",
    purpose:
      "Set out how long your business keeps each kind of record, who is responsible, how records are disposed of, and how holds and requests are handled.",
    needs: [
      "Your organisation's name and the policy's owner",
      "Each kind of record you keep, and why",
      "How long each is kept, and the reason for that period",
      "How records are disposed of at the end",
      "How a hold stops disposal",
      "How requests to erase information are handled",
    ],
    limits:
      "The policy supplies no fixed number of years. Tax, employment, sector and contract rules may each set their own periods; establish them for your business. Independent advice may be useful where those rules are unclear.",
    guides: ["GUD-13"],
  },
  "TPL-33": {
    risk: "regulated_sector",
    purpose:
      "Record a walk-through of a workplace: what was observed against each check, the hazards found, and the actions agreed and followed up.",
    needs: [
      "The site or activity checked, and the date",
      "Who carried out the check",
      "The criterion each item is checked against",
      "Each hazard found, and the action needed",
      "Who will act, by when, and the follow-up check",
    ],
    limits:
      "A general observation and action record. It is not a statutory inspection, an equipment certificate or a full risk assessment, and a blank row is not a pass. Where the work is hazardous or regulated, independent advice from a competent safety professional may be useful.",
    guides: [],
  },
  "TPL-34": {
    risk: "general",
    purpose:
      "Record a workplace or business incident: what happened, the immediate response, and the follow-up and lessons.",
    needs: [
      "The date, time and place of the incident",
      "Who was involved, and any witnesses",
      "A factual account of what happened",
      "The actions taken at the time",
      "The follow-up actions, their owners and dates",
    ],
    limits:
      "A general record, not an emergency procedure, a clinical assessment or a regulator's reporting form. Where an incident must be reported to an authority, use the authority's own route as well.",
    guides: ["GUIDE-C08"],
  },
  "TPL-35": {
    risk: "general",
    purpose:
      "Write down a repeatable business process so that people can carry it out and check it the same way each time.",
    needs: [
      "The process's name, owner and version",
      "Its purpose, and where it starts and ends",
      "Each step in order, with who does it",
      "The records each step produces",
      "The exceptions, and how to handle them",
      "When the procedure is next reviewed",
    ],
    limits:
      "A general structure. It does not supply technical, clinical, food-safety or other regulated instructions. Walk through it with the people who do the work before use.",
    guides: ["GUIDE-C09"],
  },
  "TPL-36": {
    risk: "regulated_sector",
    purpose:
      "Plan how your food business responds to a product concern: who decides, how affected product is traced and recovered, who is told, and how the recall is closed.",
    needs: [
      "The products and sites the plan covers",
      "The coordinator, their deputy and who may decide",
      "Checked contact routes for the regulator and customers",
      "Where the traceability records are kept",
      "How stock is held, recovered and accounted for",
      "How the plan is tested and reviewed",
    ],
    limits:
      "For food products only, not for medicines, medical devices, cosmetics or other regulated goods. It does not replace the regulator's own procedures; confirm its current requirements with the regulator. Independent advice may be useful before you rely on the plan.",
    guides: [],
  },
  "TPL-37": {
    risk: "regulated_sector",
    purpose:
      "Record hygiene checks of a food activity: people, premises, preparation, ingredients and dispatch, with any corrective action and the affected food.",
    needs: [
      "The site, the activity and the date",
      "Who carried out the checks",
      "The procedure each item is checked against",
      "Technical readings, such as temperatures, with their limits",
      "Any corrective action, and what happened to affected food",
    ],
    limits:
      "An observation and corrective-action form. It is not an official inspection, a registration or a certification, and no row is ticked in advance. Set technical limits from your own validated procedures. Independent advice from a food-safety professional may be useful.",
    guides: [],
  },
  "TPL-38": {
    risk: "general",
    purpose:
      "Record the maintenance planned and carried out on a business asset, the faults found, and the follow-up.",
    needs: [
      "The asset's name, identifier and location",
      "The maintenance schedule",
      "Each service or repair: its date, the work done and who did it",
      "The faults found, and the decision on using the asset",
      "The follow-up actions and their dates",
    ],
    limits:
      "A completed entry records the work done. It does not certify that the equipment is safe or fit to use.",
    guides: [],
  },
  "TPL-39": {
    risk: "contracts",
    purpose:
      "Work through a proposed lease of business premises before you sign or pay: the parties, title, use, condition, rent and costs, responsibilities, renewal and exit.",
    needs: [
      "The premises' address and the landlord's details",
      "The documents you have, such as the draft lease and title papers",
      "The use you plan, and any approvals it needs",
      "The rent, the deposit and the other costs",
      "The repair, insurance and service responsibilities",
      "The renewal, break and exit terms",
    ],
    limits:
      "A working checklist, not a lease, a title certificate or permission to occupy. It does not cover every legal step of a property transaction. Before you sign, pay or move in, independent legal advice on the title and the lease may be useful.",
    guides: [],
  },
  "TPL-40": {
    risk: "general",
    purpose:
      "Organise the records your business keeps for requirements already identified for it, with where each record is and when it was last checked.",
    needs: [
      "Each requirement already identified for your business",
      "The record that shows how you meet it",
      "Where the record is kept, and who holds it",
      "When it was last checked, and when it is next checked",
    ],
    limits:
      "This is not a list of obligations every business must meet. A completed row does not show legal compliance, an exemption or a regulator's acceptance.",
    guides: ["GUIDE-C12"],
  },
};
