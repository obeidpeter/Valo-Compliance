/** Pure, browser-safe integer arithmetic shared by guided inputs and server validation. */
export type FinancialInput={
  kind:"invoice"|"quotation"|"payment_reminder"|"business_proposal";
  lines:{description:string;quantity:string;unitPriceKobo:string}[];
  taxAmountKobo:string|null;taxLabel:string;discountKobo:string|null;amountDueKobo:string|null;
};
export type FinancialBlock={id:string;type:"table";text:string;rows:string[][]};
function amount(s:string){if(!/^[0-9]{1,24}$/.test(s))throw Error("INVALID_INTEGER_KOBO");return BigInt(s);}
export function formatKobo(kobo:string|bigint){
  const n=typeof kobo==="bigint"?kobo:amount(kobo);
  if(n<0n)throw Error("NEGATIVE_MONEY");
  return`₦${(n/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,",")}.${(n%100n).toString().padStart(2,"0")}`;
}
export function lineTotal(quantity:string,unitPriceKobo:string){
  if(!/^(0|[1-9][0-9]{0,6})(\.[0-9]{1,3})?$/.test(quantity))throw Error("INVALID_QUANTITY");
  const [whole,fraction=""]=quantity.split("."),numerator=BigInt(whole+fraction),denominator=10n**BigInt(fraction.length);
  if(numerator<=0n)throw Error("QUANTITY_MUST_BE_POSITIVE");
  // Each positive line is rounded half-up to the nearest kobo, once.
  return(amount(unitPriceKobo)*numerator+denominator/2n)/denominator;
}
export function financialBlocks(input:FinancialInput):FinancialBlock[]{
  if(input.kind==="payment_reminder"){
    if(input.amountDueKobo===null)return[];
    return[{id:"financial-summary-v1",type:"table",text:"User-recorded outstanding amount, not verified payment evidence",
      rows:[["Description","Amount"],["Amount recorded due",formatKobo(input.amountDueKobo)]]}];
  }
  if(input.lines.length===0){
    if(input.kind==="business_proposal"&&input.amountDueKobo!==null)return[
      {id:"financial-summary-v1",type:"table",text:"Proposed budget supplied by the business",
        rows:[["Description","Amount"],["Proposed budget",formatKobo(input.amountDueKobo)]]}];
    return[];
  }
  let subtotal=0n;
  const rows=[["Description","Quantity","Unit price","Line total"],...input.lines.map(line=>{
    const total=lineTotal(line.quantity,line.unitPriceKobo);subtotal+=total;
    return[line.description,line.quantity,formatKobo(line.unitPriceKobo),formatKobo(total)];
  })];
  const tax=input.taxAmountKobo===null?0n:amount(input.taxAmountKobo);
  const discount=input.discountKobo===null?0n:amount(input.discountKobo);
  if(discount>subtotal)throw Error("DISCOUNT_EXCEEDS_SUBTOTAL");
  const summary=[["Description","Amount"],["Subtotal",formatKobo(subtotal)]];
  if(input.discountKobo!==null)summary.push(["Discount supplied by issuer",formatKobo(discount)]);
  if(input.taxAmountKobo!==null)summary.push([input.taxLabel.trim()||"Additional amount supplied by issuer",formatKobo(tax)]);
  summary.push(["Draft total from supplied amounts",formatKobo(subtotal-discount+tax)]);
  return[{id:"financial-items-v1",type:"table",text:"Supplied line items; each line rounded half-up to one kobo",rows},
    {id:"financial-summary-v1",type:"table",text:"No statutory tax rate or exemption has been determined",rows:summary}];
}
export function synchronizeFinancialBlocks<T extends {financialInput?:FinancialInput;blocks:{id:string;type:string;text:string;rows:string[][]}[]}>(content:T):T{
  if(!content.financialInput)return content;
  return{...content,blocks:[...content.blocks.filter(b=>!["financial-items-v1","financial-summary-v1"].includes(b.id)),
    ...financialBlocks(content.financialInput)]};
}
