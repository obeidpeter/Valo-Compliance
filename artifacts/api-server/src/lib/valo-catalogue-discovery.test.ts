import test from 'node:test';
import assert from 'node:assert/strict';
import {paginateReleasedItems,recommendTemplates,templateSummary,templateCategory,type ReleasedLibraryItem} from './valo-catalogue';
import {baselineTemplates} from '../../../../lib/valo-core/src/catalogue';
import {metadataOrigin,parsePublicMetadata} from '../../../valo/src/lib/public-metadata';

// Controlled metadata benchmark only. These rows are not released documents,
// and the product-owner relevance threshold has not been agreed or accepted.
const fixtures:ReleasedLibraryItem[]=baselineTemplates.map((t,i)=>({id:t.id,templateId:t.id,slug:t.id,title:t.title,
  type:'template',industry:i%2?'retail,manufacturing':'All industries',access:t.access,category:templateCategory(t.id),
  summary:templateSummary(t.id),reviewedAt:new Date(Date.UTC(2026,0,i+1)).toISOString()}));
const queries:[string,string][]=[
  ['invoice','01'],['proposed prices','02'],['payment received','03'],['goods ordered','04'],['goods dispatched','05'],
  ['reimbursement','06'],['stock movements','07'],['meeting decisions','08'],['customer complaint','09'],['holiday request','10'],
  ['new employee induction','11'],['payment reminder','12'],['service agreement','13'],['consultancy fees','14'],['confidentiality','15'],
  ['employment contract','16'],['job offer','17'],['supplier agreement','18'],['sales agreement','19'],['partnership','20'],
  ['independent contractor','21'],['business proposal','22'],['project deliverables','23'],['procurement bids','24'],['board resolution','25'],
  ['employee handbook','26'],['leave policy','27'],['disciplinary procedure','28'],['personal data practices','29'],['website terms','30'],
  ['processing roles','31'],['record disposal','32'],['workplace hazards','33'],['accident details','34'],['operating procedure','35'],
  ['product recall','36'],['food hygiene','37'],['equipment servicing','38'],['commercial lease','39'],['compliance evidence','40'],
  ['bill','01'],['quote','02'],['stock','07'],['STAFF ONBOARDING','11'],['non disclosure','15'],['expenses','06'],
  ['repair notes','38'],['cleaning observations','37'],['action owners','08'],['internal approval','10'],
];
test('50 curated searches retrieve the expected controlled item in the first three results',()=>{
  assert.equal(queries.length,50);
  for(const [q,id] of queries)assert.ok(paginateReleasedItems(fixtures,{q}).items.slice(0,3).some(i=>i.id==='TPL-'+id),q);
});
test('combined filters, ordering, later pages, reset, empty query and no matches',()=>{
  const rows=paginateReleasedItems(fixtures,{type:'template',industry:'retail',access:'premium',category:'People',sort:'name'});
  assert.ok(rows.total>0);assert.ok(rows.items.every(i=>i.access==='premium'&&i.category==='People'));
  assert.deepEqual(rows.items.map(i=>i.title),rows.items.map(i=>i.title).sort((a,b)=>a.localeCompare(b,'en-NG')));
  assert.equal(paginateReleasedItems(fixtures,{sort:'recently_checked'}).items[0]!.id,'TPL-40');
  assert.equal(paginateReleasedItems(fixtures,{q:'nonexistent-xyz'}).total,0);
  assert.equal(paginateReleasedItems(fixtures,{industry:'not-a-known-activity',category:'missing'}).total,0);
  assert.equal(paginateReleasedItems(fixtures,{page:2}).items.length,20);
  assert.equal(paginateReleasedItems(fixtures).total,40);
  assert.equal(paginateReleasedItems(fixtures,{page:Infinity}).page,1);
});
test('recommendations use supplied activity/category and omit saved or absent releases',()=>{
  const result=recommendTemplates(fixtures,['TPL-02'],['retail']);
  assert.equal(result.length,6);assert.ok(result.every(i=>i.id!=='TPL-02'));
  assert.match(result[0]!.reason,/activity/);
  assert.deepEqual(recommendTemplates([],['TPL-02'],['retail']),[]);
  assert.ok(recommendTemplates(fixtures,[],['unknown']).every(i=>i.reason==='General business template'));
});
test('metadata only accepts fixed configured origin and known safe public detail paths',()=>{
  assert.equal(metadataOrigin({NODE_ENV:'production',REPLIT_DEV_DOMAIN:'untrusted.example'}),null);
  for(const raw of ['http://example.test','https://u:p@example.test','https://example.test/private','https://example.test/?q=x'])
    assert.equal(metadataOrigin({NODE_ENV:'production',VALO_TRUSTED_ORIGIN:raw}),null);
  assert.equal(metadataOrigin({NODE_ENV:'production',VALO_TRUSTED_ORIGIN:'https://example.test'}),'https://example.test');
  const entries=['/library/invoice','/workspace/secret','/staff/users','//evil.test/x','/library/%2Fprivate','/resources/../../workspace'];
  assert.deepEqual(parsePublicMetadata({items:entries.map(path=>({path,title:'Fixture',description:'Public metadata',modifiedAt:null}))}).map(i=>i.path),['/library/invoice']);
});
