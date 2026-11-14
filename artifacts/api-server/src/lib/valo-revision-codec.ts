import type {z} from "zod";
import {CreateDocumentBody} from "@workspace/api-zod";
import {isDeepStrictEqual} from "node:util";
type CanonicalDocument=z.infer<typeof CreateDocumentBody>;
/** V2 is explicitly domain-separated; old documents still use frozen V1 bytes.
 * The persisted extension fields identify V2 without changing historic rows. */
export function serializeRevision(input:CanonicalDocument):string{
  const m=input.content.financialInput;
  const extended=!!m&&(
    ["deliveryKobo","discountPercent","taxPercent","taxBaseKobo","currency","requestedTotalKobo","disputedKobo","optionalLines"]
      .some(key=>(m as unknown as Record<string,unknown>)[key]!==undefined)||
    m.lines.some(l=>l.currency!==undefined)||m.paymentRecord?.duplicatesConfirmed!==undefined);
  if(!extended)return serializeRevisionV1(input);
  const data=JSON.parse(JSON.stringify(input)),validated=JSON.parse(JSON.stringify(CreateDocumentBody.parse(input)));
  if(!isDeepStrictEqual(data,validated))throw Error("UNSUPPORTED_REVISION_MODEL_VERSION");
  const stable=(v:unknown):unknown=>Array.isArray(v)?v.map(stable):
    v&&typeof v==="object"?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([k,x])=>[k,stable(x)])):v;
  return"valo-document-revision-v2\n"+JSON.stringify(stable(validated));
}
/** Frozen write-time v1 ordering, independent of Zod's enumeration/default
 * implementation and JSONB key order. A future model extension needs an
 * explicit new codec/version, not a rewrite of historic hashes. */
export function serializeRevisionV1(input:CanonicalDocument):string{
  const c=input.content,f=c.fields,m=c.financialInput;
  const fields={issuerName:f.issuerName,recipientName:f.recipientName,documentNumber:f.documentNumber,
    issueDate:f.issueDate,dueDate:f.dueDate,notes:f.notes};
  const content={fields,blocks:c.blocks.map(b=>({id:b.id,type:b.type,text:b.text,rows:b.rows})),
    selectedClauses:c.selectedClauses,
    ...(m?{financialInput:{kind:m.kind,lines:m.lines.map(l=>({description:l.description,quantity:l.quantity,unitPriceKobo:l.unitPriceKobo})),
      taxAmountKobo:m.taxAmountKobo,taxLabel:m.taxLabel,discountKobo:m.discountKobo,amountDueKobo:m.amountDueKobo,
      ...(m.paymentRecord?{paymentRecord:{invoiceAmountKobo:m.paymentRecord.invoiceAmountKobo,
        payments:m.paymentRecord.payments.map(p=>({reference:p.reference,amountKobo:p.amountKobo}))}}:{})}}:{}),
    formatting:{font:c.formatting.font,accent:c.formatting.accent}};
  const serialized=JSON.stringify({title:input.title,content});
  if(!isDeepStrictEqual(JSON.parse(serialized),JSON.parse(JSON.stringify(input))))
    throw Error("UNSUPPORTED_REVISION_MODEL_VERSION");
  return serialized;
}
