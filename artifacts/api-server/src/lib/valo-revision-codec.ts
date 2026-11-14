import type {z} from "zod";
import type {CreateDocumentBody} from "@workspace/api-zod";
import {isDeepStrictEqual} from "node:util";
type CanonicalDocument=z.infer<typeof CreateDocumentBody>;
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
