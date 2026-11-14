export type ReceiptRecoveryResult={repaired:boolean;receiptId:string;deliveryStatus:string;realProviderVerification:boolean};
type Failure={stage:"concurrent_repair"|"repeat_check";attempt:number;reason:string;status?:number;databaseCode?:string};
type Observation=ReceiptRecoveryResult&{attempt:number};
export type ReceiptRecoveryOutcome={orderId:string;disposition:"repaired"|"already_present"|"needs_review";
  reason:string;observations:Observation[];failures:Failure[]};

/** Keep useful classifications without retaining arbitrary SQL/error payloads. */
function failure(error:unknown,stage:Failure["stage"],attempt:number):Failure{
  const value=error&&typeof error==="object"?error as {status?:unknown;code?:unknown;cause?:{code?:unknown}}:{};
  const status=typeof value.status==="number"&&Number.isInteger(value.status)?value.status:undefined;
  const code=value.code??value.cause?.code;
  const databaseCode=typeof code==="string"&&["23503","23505","40001","40P01"].includes(code)?code:undefined;
  const reason=status===403?"maintenance_not_authorized":status===404?"order_not_found":
    status===409?"ineligible_synthetic_fixture":
    databaseCode?"database_operation_failed":"unexpected_recovery_error";
  return{stage,attempt,reason,...(status===undefined?{}:{status}),...(databaseCode?{databaseCode}:{})};
}

/** Await every started repair, preserving partial success even if a peer fails.
 * An inconclusive run is needs_review, never proof that no row was committed. */
export async function recoverReceiptWithEvidence(orderId:string,recover:(id:string)=>Promise<ReceiptRecoveryResult>):Promise<ReceiptRecoveryOutcome>{
  const observations:Observation[]=[],failures:Failure[]=[];
  const settled=await Promise.allSettled([recover(orderId),recover(orderId)]);
  settled.forEach((result,index)=>{
    if(result.status==="fulfilled")observations.push({...result.value,attempt:index+1});
    else failures.push(failure(result.reason,"concurrent_repair",index+1));
  });
  const held="held_synthetic_recovery";
  const finish=(disposition:ReceiptRecoveryOutcome["disposition"],reason:string)=>
    ({orderId,disposition,reason,observations,failures});
  if(failures.length)return finish("needs_review","concurrent_repair_failed");
  const created=observations.filter(r=>r.repaired).length,first=observations[0]!;
  if(!first.receiptId||created>1||observations.some(r=>r.receiptId!==first.receiptId||
    r.deliveryStatus!==first.deliveryStatus||r.realProviderVerification!==false)||
    (created===1&&first.deliveryStatus!==held))
    return finish("needs_review","conflicting_repair_results");
  try{
    const again=await recover(orderId);
    observations.push({...again,attempt:3});
    if(again.repaired||again.receiptId!==first.receiptId||again.deliveryStatus!==first.deliveryStatus||
      again.realProviderVerification!==false)return finish("needs_review","repeat_did_not_preserve_receipt");
  }catch(error){
    failures.push(failure(error,"repeat_check",3));
    return finish("needs_review","repeat_check_failed");
  }
  return finish(created===1?"repaired":"already_present",created===1?"held_purchase_receipt_created":"existing_purchase_receipt_preserved");
}

