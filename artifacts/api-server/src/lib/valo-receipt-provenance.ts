export const receiptBlockerCodes=["owner_not_synthetic_refund","requester_not_owner","reference_not_test",
  "title_not_controlled","licence_not_synthetic","currency_not_ngn","invalid_amount",
  "order_not_verified_success","provider_reference_absent","matching_grant_absent"] as const;
export type ReceiptBlocker=typeof receiptBlockerCodes[number];
export function syntheticReceiptBlockers(v:{owner:string|null;requester:string;reference:string;title:string;
  licence:string;currency:string;amount:number;status:string;providerReference:boolean;matchingGrant:boolean}):ReceiptBlocker[]{
  const checks:[boolean,ReceiptBlocker][]=[
    [!!v.owner?.startsWith("synthetic-refund-"),"owner_not_synthetic_refund"],
    [v.requester===v.owner,"requester_not_owner"],[v.reference.startsWith("valo-test-"),"reference_not_test"],
    [v.title==="Controlled order","title_not_controlled"],[v.licence==="synthetic-only","licence_not_synthetic"],
    [v.currency==="NGN","currency_not_ngn"],[Number.isSafeInteger(v.amount)&&v.amount>0,"invalid_amount"],
    [v.status==="verified_success","order_not_verified_success"],[v.providerReference,"provider_reference_absent"],
    [v.matchingGrant,"matching_grant_absent"]];
  return checks.filter(([ok])=>!ok).map(([,reason])=>reason);
}
