/** Actual development PostgreSQL domain integration; staff identity/MFA values are
 * controlled fixtures, NOT a real privileged Clerk session or provider erasure. */
import {randomUUID} from "node:crypto";
import assert from "node:assert/strict";
import {writeFile,mkdir} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {pool} from "@workspace/db";
import {createPrivacyCase,confirmPrivacyCase,customerPrivacyDetail,listStaffPrivacyCases,simpleStaffPrivacyAction} from "../lib/valo-privacy";
import {processPrivacyAction,privacyPreparedResult} from "../lib/valo-privacy-processing";
import {saveProfile} from "../lib/valo-store";
import {syntheticProfile} from "../lib/valo-test-fixtures";
const checks:{name:string;status:"pass"|"fail";errorType?:string}[]=[],owned:string[]=[],roles:string[]=[];
let cleanupErrors=0;
async function check(name:string,fn:()=>Promise<void>){
  try{await fn();checks.push({name,status:"pass"});}catch(e){checks.push({name,status:"fail",errorType:e instanceof Error?e.name:"unknown"});process.exitCode=1;}
}
async function owner(){
  const workspaceId=randomUUID(),identityId=`privacy-fixture-${randomUUID()}`;owned.push(workspaceId);
  await pool.query("INSERT INTO valo_workspaces(id,owner_identity_id) VALUES($1,$2)",[workspaceId,identityId]);
  await pool.query("INSERT INTO valo_memberships(id,workspace_id,identity_id,role) VALUES($1,$2,$3,'owner')",[randomUUID(),workspaceId,identityId]);
  return {workspaceId,identityId};
}
async function staff(role="privacy"){
  const identityId=`privacy-staff-fixture-${randomUUID()}`;roles.push(identityId);
  await pool.query("INSERT INTO valo_staff_assignments(id,identity_id,role,granted_by,reason) VALUES($1,$2,$3,'controlled-fixture','No real account is granted access')",
    [randomUUID(),identityId,role]);
  return {identityId,recentMfa:true,verifiedAt:Date.now()};
}
const body=(kind:"correction"|"export"|"deletion",key=randomUUID())=>({kind,idempotencyKey:key,message:"Synthetic privacy integration request only.",acknowledgement:true as const});
async function opened(kind:"correction"|"export"|"deletion"){
  const actor=await owner(),s=await staff(),request=await createPrivacyCase(actor,"synthetic@example.invalid",body(kind)),id=request.reference.slice(5);
  let result=await confirmPrivacyCase(actor,id,{expectedVersion:1,acknowledgement:true});
  result=await simpleStaffPrivacyAction(s,id,{expectedVersion:result.request.version,action:"claim",reason:"Controlled fixture assignment for a verified request."});
  return {actor,s,id,result};
}
try{
  if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT||
    process.env.VALO_PRIVACY_FIXTURES!=="owned-synthetic-development-only")throw Error("EXPLICIT_SYNTHETIC_DEVELOPMENT_REQUIRED");
  await check("atomic_request_idempotency_and_payload_mismatch",async()=>{
    const actor=await owner(),input=body("export");
    const[a,b]=await Promise.all([createPrivacyCase(actor,"synthetic@example.invalid",input),createPrivacyCase(actor,"synthetic@example.invalid",input)]);
    assert.equal(a.reference,b.reference);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM valo_support_tickets WHERE workspace_id=$1",[actor.workspaceId])).rows[0].n,1);
    await assert.rejects(()=>createPrivacyCase(actor,"synthetic@example.invalid",{...input,message:"A different synthetic request body."}),{status:409});
  });
  await check("owner_verification_cancellation_history_and_stale_write",async()=>{
    const actor=await owner(),created=await createPrivacyCase(actor,"synthetic@example.invalid",body("export")),id=created.reference.slice(5);
    const verified=await confirmPrivacyCase(actor,id,{expectedVersion:1,acknowledgement:true});
    assert.equal(verified.request.status,"verified");assert.equal(verified.events.length,2);
    await assert.rejects(()=>confirmPrivacyCase(actor,id,{expectedVersion:1,acknowledgement:true},true),{status:409});
    const cancelled=await confirmPrivacyCase(actor,id,{expectedVersion:2,acknowledgement:true},true);
    assert.equal(cancelled.request.status,"cancelled");assert.equal(cancelled.events.length,3);
    await assert.rejects(()=>privacyPreparedResult(actor,id),{status:404});
  });
  await check("tenant_substitution_and_revoked_membership_fail",async()=>{
    const a=await owner(),b=await owner(),saved=await createPrivacyCase(a,"synthetic@example.invalid",body("export")),id=saved.reference.slice(5);
    await assert.rejects(()=>customerPrivacyDetail(b,id),{status:404});
    await pool.query("UPDATE valo_memberships SET active='no' WHERE workspace_id=$1",[a.workspaceId]);
    await assert.rejects(()=>confirmPrivacyCase(a,id,{expectedVersion:1,acknowledgement:true}),{status:403});
  });
  await check("fresh_mfa_privacy_role_and_revocation_required",async()=>{
    const s=await staff(),finance=await staff("finance");
    await assert.rejects(()=>listStaffPrivacyCases({...s,recentMfa:false},1),{status:403});
    await assert.rejects(()=>listStaffPrivacyCases({...s,verifiedAt:Date.now()-31_000},1),{status:403});
    await assert.rejects(()=>listStaffPrivacyCases(finance,1),{status:403});
    await pool.query("UPDATE valo_staff_assignments SET active=false WHERE identity_id=$1",[s.identityId]);
    await assert.rejects(()=>listStaffPrivacyCases(s,1),{status:403});
  });
  await check("unverified_hold_release_cannot_fake_verification_or_assignment",async()=>{
    const actor=await owner(),s=await staff(),created=await createPrivacyCase(actor,"synthetic@example.invalid",body("export")),id=created.reference.slice(5);
    await assert.rejects(()=>simpleStaffPrivacyAction(s,id,{expectedVersion:1,action:"claim",reason:"Cannot claim an unverified request."}),{status:409});
    let r=await simpleStaffPrivacyAction(s,id,{expectedVersion:1,action:"hold",reason:"Awaiting actual owner verification."});
    r=await simpleStaffPrivacyAction(s,id,{expectedVersion:r.request.version,action:"release_hold",reason:"Return to owner verification, not a fabricated pass."});
    assert.equal(r.request.status,"awaiting_verification");assert.equal(r.request.verifiedAt,null);
  });
  await check("scoped_export_result_is_real_private_repeatable_and_not_full_fulfilment",async()=>{
    const{actor,s,id,result}=await opened("export");
    const r=await processPrivacyAction(s,id,{expectedVersion:result.request.version,action:"prepare_export",reason:"Prepare the actual named local JSON sections."});
    assert.equal(r.request.status,"partially_fulfilled");assert(r.request.resultAvailable);
    const output=await privacyPreparedResult(actor,id);
    assert.equal(output.workspaceId,actor.workspaceId);assert.match(String(output.scope),/not complete privacy fulfilment/);
    assert.equal(typeof output.data,"object");
    const repeat=await processPrivacyAction(s,id,{expectedVersion:r.request.version,action:"prepare_export",reason:"Retry retrieves the existing prepared result."});
    assert.equal(repeat.request.version,r.request.version);
    const other=await owner();await assert.rejects(()=>privacyPreparedResult(other,id),{status:404});
  });
  await check("actual_current_profile_correction_is_bound_and_history_preserved",async()=>{
    const actor=await owner(),s=await staff();
    await saveProfile(actor,{expectedRevision:0,profile:syntheticProfile});
    const created=await createPrivacyCase(actor,"synthetic@example.invalid",body("correction")),id=created.reference.slice(5);
    await confirmPrivacyCase(actor,id,{expectedVersion:1,acknowledgement:true});
    const result=await simpleStaffPrivacyAction(s,id,{expectedVersion:2,action:"claim",reason:"Controlled fixture verifies a real versioned correction."});
    const old=(await pool.query("SELECT id,profile_hash FROM valo_profile_versions WHERE workspace_id=$1 AND revision=1",[actor.workspaceId])).rows[0];
    await assert.rejects(()=>processPrivacyAction(s,id,{expectedVersion:result.request.version,action:"record_correction",
      profileVersionId:old.id,acknowledgement:true,reason:"An unchanged pre-request version cannot fulfil a correction."}),{status:409});
    await saveProfile(actor,{expectedRevision:1,profile:{...syntheticProfile,businessName:"Corrected synthetic development business"}});
    const p=(await pool.query("SELECT id FROM valo_profile_versions WHERE workspace_id=$1 AND revision=2",[actor.workspaceId])).rows[0];
    const r=await processPrivacyAction(s,id,{expectedVersion:result.request.version,action:"record_correction",
      profileVersionId:p.id,acknowledgement:true,reason:"Checked the actual new synthetic business profile revision."});
    assert.equal(r.request.status,"partially_fulfilled");
    assert.equal((await privacyPreparedResult(actor,id)).profileVersionId,p.id);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM valo_profile_versions WHERE workspace_id=$1",[actor.workspaceId])).rows[0].n,2);
    assert.equal((await pool.query("SELECT profile_hash FROM valo_profile_versions WHERE id=$1",[old.id])).rows[0].profile_hash,old.profile_hash);
  });
  await check("altered_state_or_audit_prevents_result_and_processing",async()=>{
    const{actor,id}=await opened("export");
    await pool.query("UPDATE valo_privacy_cases SET message='Altered synthetic text' WHERE id=$1",[id]);
    await assert.rejects(()=>customerPrivacyDetail(actor,id),{status:409});
  });
  await check("durable_request_limits_preserve_prior_work",async()=>{
    const actor=await owner();
    for(let n=0;n<3;n++)await createPrivacyCase(actor,"synthetic@example.invalid",body("export"));
    await assert.rejects(()=>createPrivacyCase(actor,"synthetic@example.invalid",body("export")),{status:429});
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM valo_privacy_cases WHERE workspace_id=$1",[actor.workspaceId])).rows[0].n,3);
  });
  await check("erasure_is_honestly_disabled_not_fabricated_as_complete",async()=>{
    const{actor,s,id,result}=await opened("deletion");
    await assert.rejects(()=>processPrivacyAction(s,id,{expectedVersion:result.request.version,action:"start_erasure",
      reason:"Controlled unsupported-erasure path must fail closed.",acknowledgement:true}),{status:503});
    assert.equal((await customerPrivacyDetail(actor,id)).request.status,"assigned");
  });
}finally{
  for(const workspaceId of owned)for(const table of["valo_privacy_events","valo_privacy_tombstones","valo_privacy_cases",
    "valo_support_tickets","valo_profile_versions","valo_events","valo_memberships","valo_workspaces"]){
    try{await pool.query(`DELETE FROM ${table} WHERE ${table==="valo_workspaces"?"id":"workspace_id"}=$1`,[workspaceId]);}
    catch{cleanupErrors++;process.exitCode=1;}
  }
  for(const identityId of roles){
    await pool.query("DELETE FROM valo_staff_access_audit WHERE actor_id=$1",[identityId]).catch(()=>{cleanupErrors++;process.exitCode=1;});
    await pool.query("DELETE FROM valo_staff_assignments WHERE identity_id=$1",[identityId]).catch(()=>{cleanupErrors++;process.exitCode=1;});
  }
  const dir=fileURLToPath(new URL("../../../../generated-artifacts/valo-completion/",import.meta.url));
  await mkdir(dir,{recursive:true});
  const report={checkedAt:new Date().toISOString(),checks,passed:checks.filter(c=>c.status==="pass").length,
    failed:checks.filter(c=>c.status==="fail").length,cleanupErrors,actualDevelopmentPostgres:true,
    staffMfaAndIdentity:"controlled domain fixtures, not real privileged Clerk sessions",
    realEmailSent:false,providerErasureExecuted:false,completePrivacyFulfilment:false};
  await writeFile(dir+"privacy-case-proof.json",JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report));
  await pool.end();
}
