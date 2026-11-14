import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_FACTS, displayFact, finaliseFacts, reviewFacts } from './checker';
import { canCreateSourceTask, factAtPath, RESULT_LABELS, updateRichAnswer, type RichCheckerFacts } from './rich-checker';

test('rich review preserves known false, omitted answers and all three explicit states', () => {
  const facts: RichCheckerFacts = { ...EMPTY_FACTS, factsVersion: 'checker-facts-v2', rich: { privacy: {
    processesPersonalData: false,
    commercialUse: { status: 'unknown', value: null },
    newCollectionEvent: { status: 'unanswered', value: null },
    ownPurposeReuse: { status: 'not_applicable', value: null },
  } } };
  const rows = new Map(reviewFacts(facts));
  assert.equal(rows.has('rich.privacy.controllerRole'), false);
  assert.equal(displayFact('rich.privacy.processesPersonalData', rows.get('rich.privacy.processesPersonalData')), 'No');
  assert.equal(displayFact('x', undefined), 'Not supplied');
  assert.equal(displayFact('x', rows.get('rich.privacy.commercialUse')), 'I do not know');
  assert.equal(displayFact('x', rows.get('rich.privacy.newCollectionEvent')), 'Skipped for now');
  assert.equal(displayFact('x', rows.get('rich.privacy.ownPurposeReuse')), 'Not applicable');
});

test('changing the operator preserves partner and name answers, and editing a field preserves other groups', () => {
  const facts: RichCheckerFacts = { ...EMPTY_FACTS, rich: {
    businessName: { legalForm: 'firm', businessName: 'Ada and Ola', partners: [{ type: 'individual', surname: 'Ada', forenames: ['A'] }] },
    product: { manufacturesInNigeria: false },
  } };
  const changed = updateRichAnswer(facts, 'businessName', 'legalForm', 'company');
  assert.deepEqual(changed.rich?.businessName?.partners, facts.rich?.businessName?.partners);
  assert.deepEqual(changed.rich?.product, facts.rich?.product);
  assert.equal(changed.rich?.businessName?.businessName, 'Ada and Ola');
  const cleared = updateRichAnswer(changed, 'businessName', 'legalForm', undefined);
  assert.equal(Object.hasOwn(cleared.rich!.businessName!, 'legalForm'), false);
  assert.equal(facts.rich?.businessName?.legalForm, 'firm');
});

test('review and comparisons address nested partners and removed rich facts without object text', () => {
  const facts: RichCheckerFacts = { ...EMPTY_FACTS, rich: { businessName: {
    partners: [{ surname: 'Okafor', forenames: ['Ada', 'Nneka'] }, { surname: { status: 'unknown', value: null } }],
    namingAssessment: { otherBrandAddition: false },
  } } };
  const rows = new Map(reviewFacts(facts));
  assert.equal(rows.get('rich.businessName.partners.0.surname'), 'Okafor');
  assert.equal(displayFact('rich.businessName.partners.0.forenames', rows.get('rich.businessName.partners.0.forenames')), 'Ada; Nneka');
  assert.equal(displayFact('x', factAtPath(facts, 'rich.businessName.partners.1.surname')), 'I do not know');
  assert.equal(displayFact('x', factAtPath({ ...EMPTY_FACTS }, 'rich.businessName.partners.1.surname')), 'Not supplied');
  assert.doesNotMatch(displayFact('rich', facts.rich), /\[object Object\]/);
});

test('submission removes unfinished blank name rows without inventing answers or clearing conditional details', () => {
  const facts: RichCheckerFacts = { ...EMPTY_FACTS, rich: { businessName: {
    legalForm: 'company', trueForenames: ['Ada', ''], partners: [{ surname: '', forenames: ['Bola', ''] }],
  }, privacy: { processesPersonalData: false, ownPurposeReuse: { status: 'unanswered', value: null } } } };
  const sent = finaliseFacts(facts);
  assert.deepEqual(sent.rich?.businessName?.trueForenames, ['Ada']);
  assert.deepEqual(sent.rich?.businessName?.partners, [{ forenames: ['Bola'] }]);
  assert.equal(sent.rich?.privacy?.processesPersonalData, false);
  assert.deepEqual(sent.rich?.privacy?.ownPurposeReuse, { status: 'unanswered', value: null });
  assert.deepEqual(facts.rich?.businessName?.trueForenames, ['Ada', '']);
});

test('all four result labels are represented and server task restrictions override likely relevance', () => {
  assert.deepEqual(RESULT_LABELS, ['Likely relevant', 'May apply', 'More information needed', 'Not indicated by these answers']);
  assert.equal(canCreateSourceTask({ label: 'May apply', sourceLinkedTaskEligible: true }), false);
  assert.equal(canCreateSourceTask({ label: 'Likely relevant', sourceLinkedTaskEligible: false }), false);
  assert.equal(canCreateSourceTask({ label: 'Likely relevant', sourceLinkedTaskEligible: true }), true);
  assert.equal(canCreateSourceTask({ label: 'Likely relevant' }), true);
});

test('exact names stay literal across review and grouped comparison', () => {
  assert.equal(displayFact('rich.businessName.businessName', 'aCME_Services'), 'aCME_Services');
  assert.equal(displayFact('rich.businessName.trueForenames', ['ada', 'a_b']), 'ada; a_b');
  assert.equal(displayFact('rich.businessName.legalForm', 'individual'), 'Individual');
  assert.equal(displayFact('rich.privacy.dataCategories', ['employee_name', 'bank_account']), 'Employee name; Bank account');
  assert.match(displayFact('rich.businessName', { businessName: 'aCME_Services' }), /aCME_Services/);
});
