import test from 'node:test';
import assert from 'node:assert/strict';
import {signJournal,verifyJournal} from './recovery_contract.mjs';
const key='synthetic-independent-recovery-key-not-live',now=Date.parse('2026-11-15T22:00:00Z');
const payload={version:1,kind:'current-development-privacy-journal',sourceIdentitySha256:'a'.repeat(64),cutoff:'2026-11-15T21:59:00Z',
 controls:{valo_memberships:[]},fingerprints:{valo_memberships:{count:'0',digest:'d41d8cd98f00b204e9800998ecf8427e'}}};
const binding={sourceIdentitySha256:'a'.repeat(64),snapshotCutoff:'2026-11-15T21:00:00Z',now};
test('independent key authenticates current controls and rejects tamper, wrong source, stale and pre-snapshot journals',()=>{
 const signed=signJournal(payload,key);assert.deepEqual(verifyJournal(signed,key,binding),payload);
 assert.throws(()=>verifyJournal({...signed,payload:signed.payload.replace('21:59','21:58')},key,binding),/AUTHENTICATION/);
 assert.throws(()=>verifyJournal(signed,key+'wrong',binding),/AUTHENTICATION/);
 assert.throws(()=>verifyJournal(signed,key,{...binding,sourceIdentitySha256:'b'.repeat(64)}),/SOURCE/);
 for(const cutoff of ['2026-11-15T19:59:00Z','2026-11-15T22:00:01Z','2026-11-15T20:59:59Z'])
  assert.throws(()=>verifyJournal(signJournal({...payload,cutoff},key),key,binding),/CURRENT_JOURNAL/);
});
test('unexpected or mismatched control tables cannot be accepted as a replay journal',()=>{
 assert.throws(()=>verifyJournal(signJournal({...payload,controls:{valo_orders:[]}},key),key,binding),/TABLE/);
 assert.throws(()=>verifyJournal(signJournal({...payload,fingerprints:{}},key),key,binding),/TABLE/);
});
