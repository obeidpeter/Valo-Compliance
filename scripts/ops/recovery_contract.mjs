import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import assert from 'node:assert/strict';
import {validateExportRetention} from './export_retention_contract.mjs';

export const sha256=value=>createHash('sha256').update(value).digest('hex');
export const privacyTable=name=>/^valo_(privacy_|erasure_)/.test(name)||['valo_memberships','valo_staff_assignments'].includes(name);
const mac=(payload,key)=>createHmac('sha256',key).update('valo/privacy-journal/v1\0').update(payload).digest('hex');
export function signJournal(payload,key){
  assert.ok(typeof key==='string'&&Buffer.byteLength(key)>=32,'RECOVERY_SIGNING_KEY_REQUIRED');
  const body=JSON.stringify(payload);
  return{version:1,payload:body,authentication:{algorithm:'HMAC-SHA256',keyId:'session-'+sha256(key).slice(0,20),mac:mac(body,key)}};
}
/** The trusted key and expected identity/cutoff come from independent custody.
 * A valid journal is evidence for replay, never permission to open the restored app. */
export function verifyJournal(envelope,key,{sourceIdentitySha256,snapshotCutoff,now=Date.now(),maxAgeMs=3_600_000,requireExportRetention=false}){
  assert.ok(envelope?.version===1&&typeof envelope.payload==='string'&&Buffer.byteLength(envelope.payload)<=20_000_000,'JOURNAL_SHAPE_INVALID');
  assert.ok(typeof key==='string'&&Buffer.byteLength(key)>=32,'RECOVERY_SIGNING_KEY_REQUIRED');
  const auth=envelope.authentication;
  assert.ok(auth?.algorithm==='HMAC-SHA256'&&auth.keyId==='session-'+sha256(key).slice(0,20)&&/^[a-f0-9]{64}$/.test(auth.mac),'JOURNAL_AUTHENTICATION_INVALID');
  assert.ok(timingSafeEqual(Buffer.from(auth.mac,'hex'),Buffer.from(mac(envelope.payload,key),'hex')),'JOURNAL_AUTHENTICATION_INVALID');
  const p=JSON.parse(envelope.payload),cutoff=Date.parse(p.cutoff),snapshot=Date.parse(snapshotCutoff);
  assert.ok(p.version===1&&p.kind==='current-development-privacy-journal'&&p.sourceIdentitySha256===sourceIdentitySha256,'JOURNAL_SOURCE_MISMATCH');
  assert.ok(Number.isFinite(cutoff)&&Number.isFinite(snapshot)&&cutoff>=snapshot&&cutoff<=now&&now-cutoff<=maxAgeMs,'CURRENT_JOURNAL_REQUIRED');
  assert.ok(p.controls&&p.fingerprints&&Object.keys(p.controls).length>0,'JOURNAL_CONTROLS_REQUIRED');
  assert.deepEqual(Object.keys(p.controls).sort(),Object.keys(p.fingerprints).sort(),'JOURNAL_TABLE_MISMATCH');
  for(const [name,rows]of Object.entries(p.controls)){
    assert.ok(privacyTable(name)&&Array.isArray(rows)&&rows.length<=250_000,'JOURNAL_TABLE_INVALID');
    assert.ok(p.fingerprints[name]?.count===String(rows.length)&&/^[a-f0-9]{32}$/.test(p.fingerprints[name].digest),'JOURNAL_FINGERPRINT_INVALID');
  }
  if(requireExportRetention||p.exportRetention!==undefined)validateExportRetention(p.exportRetention);
  return p;
}
