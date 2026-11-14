import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  ANSWER_STATES, ANSWER_STATE_LABELS, isRichMarker, updateRichAnswer,
  type RichCheckerFacts, type RichSection, type RichValue, type RichSectionAnswers,
} from '@/lib/rich-checker';

type Choice = readonly [value: string, label: string];
type Field = { key: string; label: string; kind?: 'text' | 'flag' | 'date' | 'list'; choices?: readonly Choice[]; hint?: string };
const flag = (key: string, label: string, hint?: string): Field => ({ key, label, kind: 'flag', hint });
const select = (key: string, label: string, choices: readonly Choice[], hint?: string): Field => ({ key, label, choices, hint });

const BUSINESS_FIELDS: Field[] = [
  select('legalForm', 'Who operates under this name?', [['individual', 'One individual'], ['firm', 'A partnership or firm'], ['company', 'A company']]),
  flag('hasPlaceOfBusinessInNigeria', 'Does this operator have a place of business in Nigeria?'),
  flag('carryingOnBusiness', 'Is business being carried on under the name?'),
  { key: 'businessName', label: 'Exact name used for this business' },
  { key: 'trueSurname', label: 'Individual operator’s true surname or patronymic' },
  { key: 'trueForenames', label: 'Individual operator’s forenames', kind: 'list' },
  { key: 'recognizedAbbreviations', label: 'Recognised abbreviations of the individual’s names', kind: 'list' },
  { key: 'corporateName', label: 'Company’s exact registered corporate name' },
  select('operatorRole', 'Role of the person carrying on the business', [['proprietor', 'Proprietor or partner'], ['manager', 'Manager'], ['receiver', 'Receiver'], ['other', 'Another role']]),
  select('appointmentAuthority', 'How was the manager or receiver appointed?', [['court', 'By a court'], ['private_contract', 'By private agreement'], ['other', 'Another route']]),
  flag('appointmentConfirmed', 'Have you checked the appointment record?'),
  flag('businessNameRegistered', 'Do you have a registration record for this exact name and operator?', 'This records your answer; Valo does not verify the registration.'),
];
const NAMING_FIELDS: Field[] = [
  flag('onlyAddedWordsIndicateSuccession', 'Do the added words only describe succession to a previous business?'),
  flag('otherBrandAddition', 'Is there any other brand wording added to the names?'),
  flag('sameSurnameAllPartners', 'Do all the partners have the same surname?'),
  flag('onlyAdditionIsPluralS', 'Is the only addition a final “s” making a shared surname plural?'),
];
const PARTNER_FIELDS: Field[] = [
  select('type', 'Partner type', [['individual', 'Individual'], ['corporation', 'Corporation']]),
  { key: 'surname', label: 'True surname or patronymic' },
  { key: 'forenames', label: 'Forenames', kind: 'list' },
  { key: 'recognizedAbbreviations', label: 'Recognised name abbreviations', kind: 'list' },
  { key: 'corporateName', label: 'Corporate name, if this partner is a corporation' },
];
const TAX_FIELDS: Field[] = [
  select('legalForm', 'What do the entity’s formation records describe?', [['individual_business_name', 'Individual with a business name'], ['ordinary_unincorporated_partnership', 'Ordinary unincorporated partnership'], ['company', 'Company'], ['company_limited_by_guarantee', 'Company limited by guarantee'], ['foreign_company', 'Company incorporated outside Nigeria'], ['incorporated_trustees', 'Incorporated trustees'], ['other', 'Another form']]),
  flag('incorporatedAsCompany', 'Was the entity incorporated as a company?'),
  flag('incorporatedInNigeria', 'Was the entity incorporated in Nigeria?'),
  select('effectiveManagementCountry', 'Where are the entity’s central management decisions made?', [['Nigeria', 'Nigeria'], ['outside_Nigeria', 'Outside Nigeria'], ['mixed', 'In more than one country']], 'This answer does not establish tax residence.'),
  select('managementStatusVerification', 'Have you checked records supporting that management location?', [['not_verified', 'Not checked'], ['records_available', 'Supporting records available']]),
  select('companyStatus', 'What is the entity’s current operating status?', [['active', 'Operating'], ['dormant', 'Dormant'], ['permanently_ceased', 'Permanently ceased operations']]),
  { key: 'accountingPeriodStart', label: 'Accounting period start', kind: 'date' },
  { key: 'accountingPeriodEnd', label: 'Accounting period end', kind: 'date' },
];
const PRIVACY_FIELDS: Field[] = [
  flag('processesPersonalData', 'Does the selected activity use information about identifiable people?'),
  { key: 'dataCategories', label: 'Kinds of personal information used', kind: 'list', choices: [['phone', 'Phone numbers'], ['email', 'Email addresses'], ['employee_name', 'Employee names'], ['bank_account', 'Bank account details'], ['other', 'Other information about identifiable people']], hint: 'Select categories only. Do not enter anyone’s actual details.' },
  flag('automatedDecisionMaking', 'Are decisions about people made automatically?'),
  flag('profiling', 'Is the information used to profile people?'),
  select('controllerRole', 'Who decides why and how that information is used?', [['controller', 'We make those decisions'], ['processor_only', 'We act only on another organisation’s instructions'], ['mixed', 'It varies by activity']]),
  flag('determinesPurposesAndMeans', 'Do you decide the purposes and means of this particular use?'),
  flag('ownPurposeReuse', 'Do you reuse the information for your own purposes?'),
  select('collectionMethod', 'How is the information collected?', [['direct', 'Directly from the person'], ['indirect', 'From someone or somewhere else'], ['mixed', 'Both']]),
  flag('newCollectionEvent', 'Does this activity involve collecting information now?'),
  flag('operatesInNigeria', 'Does the organisation operate in Nigeria?'),
  flag('processingOccursInNigeria', 'Does any processing for this activity take place in Nigeria?'),
  flag('dataSubjectsInNigeria', 'Are any of the people concerned located in Nigeria?'),
  flag('controllerDomiciledInNigeria', 'Is the organisation deciding the use domiciled in Nigeria?'),
  flag('controllerResidentInNigeria', 'Is that organisation resident in Nigeria?'),
  flag('processorConnectionInNigeria', 'Does a processor involved have a Nigerian connection?', 'Consider its domicile, residence, operations, processing, and the people whose information it uses.'),
  select('processingPurpose', 'What is the information used for?', [['solely_personal_household', 'Only personal or household activity'], ['household_and_commercial_promotions', 'Household activity and commercial promotion'], ['commercial', 'Business or commercial activity'], ['legal_claim', 'A legal claim'], ['other', 'Another purpose']]),
  flag('commercialUse', 'Is there any business or commercial use?'),
  flag('privacyRightsViolationIndicated', 'Is there any reported or indicated privacy-rights concern?'),
  select('section3Exception', 'Is any of this context relevant?', [['none', 'None of these contexts'], ['personal_household', 'Personal or household activity'], ['legal_claim', 'A legal claim'], ['other', 'Another context']], 'A context choice does not establish a legal exemption.'),
  flag('dataSubjectAlreadyInformed', 'Has the person already been given information about this use?'),
  select('indirectNoticeException', 'For indirect collection, has an effort-related concern been raised?', [['none', 'No such concern'], ['disproportionate_effort_claim', 'Concern about the effort of contacting people'], ['other', 'Another concern']], 'This does not establish that a notice exception applies.'),
  flag('exceptionScopeConfirmed', 'Have the particular circumstances behind the stated context been checked?', 'This records a factual check, not approval of a legal exception.'),
  { key: 'exceptionSupportingFacts', label: 'What factual circumstances support the stated context or contacting concern?', hint: 'Describe circumstances only. Do not include names, contact details or other personal or sensitive information. This does not establish a legal exception.' },
];
const PRODUCT_FIELDS: Field[] = [
  select('productCategory', 'Which description fits the particular product?', [['processed_food', 'Processed food'], ['cosmetic', 'Cosmetic'], ['claimed_cosmetic', 'Described as cosmetic, with classification unresolved'], ['water', 'Water'], ['drug', 'Drug'], ['medical_device', 'Medical device'], ['live_fish', 'Live fish'], ['other', 'Another product']]),
  flag('manufacturesInNigeria', 'Do you manufacture this product in Nigeria?'),
  flag('commercialSupplyInNigeria', 'Do you commercially supply this product in Nigeria?'),
  flag('commercialSupplyOfRegulatedProducts', 'Does the activity supply food, drugs, cosmetics, water, or medical devices?'),
  select('activity', 'What do you do with this product?', [['manufacture', 'Manufacture it'], ['resale_only', 'Resell it'], ['own_brand_repackaging', 'Repackage or supply it under our own brand'], ['import_and_distribute', 'Import and distribute it'], ['sample_for_registration_only', 'Use samples only for registration'], ['service_use_only', 'Use it only while providing a service'], ['other', 'Another activity']]),
  flag('ownBrandOrRepackaging', 'Do you add your own brand or repackage the product?'),
  flag('processingOrPackaging', 'Do you process or package the product?'),
  flag('drugOrMedicalUse', 'Is it supplied for drug or medical use?'),
  flag('therapeuticClaims', 'Are treatment or therapeutic claims made about it?'),
  select('productRegistration', 'What product-registration record do you state that you hold?', [['current_for_product_and_manufacturer', 'A current record for this product and manufacturer'], ['supplier_registration_claimed', 'A supplier’s claimed registration'], ['none', 'No registration record held']], 'These are your stated records, not verification by Valo. A supplier’s record may not cover your activity.'),
  flag('registrationCoversExactProductAndManufacturer', 'Does the registration record identify this exact product and manufacturer?', 'Your answer is not independent verification of registration.'),
  flag('registrationConditionsChanged', 'Have any recorded registration conditions changed?'),
  select('specialSamplePermit', 'Do you state that you hold a special permit for these samples?', [['permit_held', 'I hold a sample permit'], ['none', 'I do not hold a sample permit']], 'Valo has not independently verified permission. A permit claim does not establish commercial-supply permission.'),
  flag('permitScopeMatchesActivity', 'Does the sample permit describe this exact product and activity?'),
  flag('permitConditionsSatisfied', 'Have you checked that the stated permit conditions are satisfied?'),
];

function AnswerField({ field, value, onChange, prefix }: { field: Field; value: RichValue | undefined; onChange: (value: RichValue | undefined) => void; prefix: string }) {
  const [entering, setEntering] = useState(false);
  const id = `${prefix}-${field.key}`;
  const choices = field.kind === 'flag' ? [['true', 'Yes'], ['false', 'No']] as const : field.kind === 'list' ? undefined : field.choices;
  const mode = isRichMarker(value) ? value.status : value !== undefined || entering ? 'known' : 'absent';
  const selected = mode === 'known' && choices ? String(value) : mode;
  function selectValue(next: string) {
    setEntering(next === 'known');
    if (next === 'absent' || next === 'known') onChange(undefined);
    else if ((ANSWER_STATES as readonly string[]).includes(next)) onChange({ status: next as typeof ANSWER_STATES[number], value: null });
    else onChange(field.kind === 'flag' ? next === 'true' : next);
  }
  const values = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
  return <fieldset className="min-w-0 grid gap-2">
    <legend className="label">{field.label}</legend>
    {field.hint && <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">{field.hint}</p>}
    <select id={`${id}-state`} aria-label={`${field.label}: answer`} aria-describedby={field.hint ? `${id}-hint` : undefined} className="field" value={selected} onChange={event => selectValue(event.target.value)} data-testid={`select-${id}`}>
      <option value="absent">Not supplied</option>
      {choices ? choices.map(([key, label]) => <option key={key} value={key}>{label}</option>) : <option value="known">Enter an answer</option>}
      {ANSWER_STATES.map(state => <option key={state} value={state}>{ANSWER_STATE_LABELS[state]}</option>)}
    </select>
    {mode === 'known' && !choices && (field.kind === 'list' ? <div className="grid gap-2">
      {values.map((entry, index) => <div className="flex gap-2" key={index}>
        {field.choices ? <select className="field min-w-0" aria-label={`${field.label} ${index + 1}`} value={entry} onChange={event => onChange(values.map((old, position) => index === position ? event.target.value : old))}>
          <option value="">Choose a category</option>{field.choices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select> : <input className="field min-w-0" aria-label={`${field.label} ${index + 1}`} value={entry} maxLength={150} onChange={event => onChange(values.map((old, position) => index === position ? event.target.value : old))} />}
        <button type="button" className="btn btn-ghost !px-3" aria-label={`Remove ${field.label.toLowerCase()} ${index + 1}`} onClick={() => onChange(values.filter((_, position) => position !== index))}><X className="h-4 w-4" /></button>
      </div>)}
      <button type="button" className="btn btn-ghost btn-sm w-fit" disabled={values.length >= 20} onClick={() => onChange([...values, ''])}><Plus className="h-4 w-4" />Add an entry</button>
    </div> : <input id={id} className="field" type={field.kind === 'date' ? 'date' : 'text'} aria-label={field.label} aria-describedby={field.hint ? `${id}-hint` : undefined} value={typeof value === 'string' ? value : ''} maxLength={300} onChange={event => onChange(event.target.value || undefined)} data-testid={`input-${id}`} />)}
  </fieldset>;
}

function Fields({ fields, answers, onChange, prefix }: { fields: Field[]; answers: RichSectionAnswers; onChange: (key: string, value: RichValue | undefined) => void; prefix: string }) {
  return <div className="grid gap-6 sm:grid-cols-2">{fields.map(field => <AnswerField key={field.key} prefix={prefix} field={field} value={answers[field.key]} onChange={value => onChange(field.key, value)} />)}</div>;
}

export function RichCheckerFields({ section, facts, onChange }: { section: RichSection; facts: RichCheckerFacts; onChange: (facts: RichCheckerFacts) => void }) {
  const answers = (facts.rich?.[section] ?? {}) as RichSectionAnswers;
  const set = (key: string, value: RichValue | undefined) => onChange(updateRichAnswer(facts, section, key, value));
  const title = { businessName: 'Optional name and operator details', tax: 'Optional company and accounting details', privacy: 'Optional personal-data details', product: 'Optional product and activity details' }[section];
  const fields = { businessName: BUSINESS_FIELDS, tax: TAX_FIELDS, privacy: PRIVACY_FIELDS, product: PRODUCT_FIELDS }[section];
  const naming = answers.namingAssessment && typeof answers.namingAssessment === 'object' && !Array.isArray(answers.namingAssessment) && !isRichMarker(answers.namingAssessment) ? answers.namingAssessment : {};
  const partners = Array.isArray(answers.partners) ? answers.partners.filter((partner): partner is RichSectionAnswers => !!partner && typeof partner === 'object' && !Array.isArray(partner) && !isRichMarker(partner)) : [];
  return <details className="rounded-2xl border border-border p-4 sm:p-5" data-testid={`rich-section-${section}`}>
    <summary id={`rich-${section}-summary`} className="cursor-pointer font-medium">{title}</summary>
    <p className="mb-6 mt-3 text-sm leading-relaxed text-muted-foreground">Answer only what you know. Leaving a field untouched, skipping it, and saying you do not know remain different answers. Changing another answer does not erase these details.</p>
    {section === 'businessName' && <p className="mb-6 rounded-xl bg-secondary p-3 text-sm">Name details are optional and available while signed in. They are sent for this check; a private assessment is stored only when you explicitly agree to save it. Do not enter identity numbers or upload records here.</p>}
    <Fields fields={fields} answers={answers} onChange={set} prefix={`rich-${section}`} />
    {section === 'businessName' && <>
      <fieldset className="mt-8 grid gap-5"><legend className="label">Partners, if relevant</legend>
        <p className="text-xs text-muted-foreground">List every relevant partner. No names are inferred from the business name.</p>
        {partners.map((partner, index) => <div className="rounded-xl border border-border p-4" key={index}>
          <div className="mb-4 flex items-center justify-between gap-2"><h3 className="font-medium">Partner {index + 1}</h3><button type="button" className="btn btn-ghost btn-sm" onClick={() => set('partners', partners.filter((_, i) => i !== index))}>Remove partner {index + 1}</button></div>
          <Fields fields={PARTNER_FIELDS} answers={partner} prefix={`rich-partner-${index}`} onChange={(key, value) => {
            const next = { ...partner }; if (value === undefined) delete next[key]; else next[key] = value;
            set('partners', partners.map((old, i) => i === index ? next : old));
          }} />
        </div>)}
        <button id="rich-partners-add" type="button" className="btn btn-ghost btn-sm w-fit" disabled={partners.length >= 30} onClick={() => set('partners', [...partners, {}])}><Plus className="h-4 w-4" />Add partner</button>
        {answers.partners !== undefined && <button type="button" className="btn btn-ghost btn-sm w-fit" onClick={() => set('partners', undefined)}>Clear partner answers</button>}
      </fieldset>
      <div className="mt-8"><h3 className="label mb-4">How the name is composed</h3><Fields fields={NAMING_FIELDS} answers={naming} prefix="rich-naming" onChange={(key, value) => { const next = { ...naming }; if (value === undefined) delete next[key]; else next[key] = value; set('namingAssessment', Object.keys(next).length ? next : undefined); }} /></div>
    </>}
  </details>;
}
