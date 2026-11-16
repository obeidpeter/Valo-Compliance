import test from "node:test";
import assert from "node:assert/strict";
import {join} from "node:path";
import {windowsRecoveryBinding} from "./valo-recovery-target";
test("separate Windows rehearsal binds the exact loopback database, owner, port and data directory",()=>{
  const root="C:/synthetic/valo-recovery-11111111-1111-4111-8111-111111111111";
  const state={name:"valo_restore_target",user:"valo_recovery_owner",address:"127.0.0.1",port:"55439",directory:join(root,"data")};
  const url=new URL("postgresql://valo_recovery_owner:synthetic-password@127.0.0.1:55439/valo_restore_target");
  windowsRecoveryBinding(state,url,root);
  for(const changed of [{name:"postgres"},{user:"other"},{address:"10.0.0.1"},{port:"5432"},{directory:root+"/elsewhere"}])
    assert.throws(()=>windowsRecoveryBinding({...state,...changed},url,root),/DISPOSABLE_RECOVERY/);
  for(const changed of ["postgresql://valo_recovery_owner:p@remote:55439/valo_restore_target",
    "postgresql://valo_recovery_owner:p@127.0.0.1:55439/valo_restore_target?host=remote",
    "postgresql://valo_recovery_owner@127.0.0.1:55439/valo_restore_target"])
    assert.throws(()=>windowsRecoveryBinding(state,new URL(changed),root),/DISPOSABLE_RECOVERY/);
});
