import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Plus, X } from 'lucide-react';
import type { FinancialInput } from '@workspace/api-client-react';
import { financialBlocks, recordedBalance } from '@workspace/valo-core/money';
import { koboToNaira, nairaToKobo } from '@/lib/checker';
import { cn } from '@/lib/utils';

export const FINANCIAL_BLOCK_IDS = ['financial-items-v1', 'financial-summary-v1'];

type LineText = { description: string; quantity: string; price: string };
type Text = { lines: LineText[]; tax: string; taxLabel: string; discount: string; due: string;
  recorded:boolean; invoice:string; payments:{reference:string;amount:string}[] };

const QTY = /^(0|[1-9][0-9]{0,6})(\.[0-9]{1,3})?$/;

function toText(v: FinancialInput): Text {
  return {
    lines: v.lines.map((l) => ({ description: l.description, quantity: l.quantity, price: koboToNaira(l.unitPriceKobo) })),
    tax: koboToNaira(v.taxAmountKobo), taxLabel: v.taxLabel, discount: koboToNaira(v.discountKobo), due: koboToNaira(v.amountDueKobo),
    recorded:!!v.paymentRecord, invoice:koboToNaira(v.paymentRecord?.invoiceAmountKobo??null),
    payments:v.paymentRecord?.payments.map(p=>({reference:p.reference,amount:koboToNaira(p.amountKobo)}))??[],
  };
}

const money = (s: string) => (s.trim() ? nairaToKobo(s) : null);

/** Parse typed text into a FinancialInput. Integer kobo via string conversion only. */
function parse(kind: FinancialInput['kind'], t: Text): { value: FinancialInput | null; errors: Record<string, string>; summary: string[][] | null } {
  const errors: Record<string, string> = {};
  const usesLines = kind === 'invoice' || kind === 'quotation' || kind === 'business_proposal';
  const lines = usesLines ? t.lines.map((l, i) => {
    if (!l.description.trim()) errors['d' + i] = 'Describe this line.';
    if (!QTY.test(l.quantity.trim()) || Number(l.quantity) <= 0) errors['q' + i] = 'Positive number, up to 3 decimals.';
    const k = money(l.price);
    if (!k) errors['p' + i] = 'Naira, up to 2 decimals.';
    return { description: l.description.trim().slice(0, 200), quantity: l.quantity.trim(), unitPriceKobo: k ?? '0' };
  }) : [];
  const chk = (key: string, s: string) => { const k = money(s); if (s.trim() && !k) errors[key] = 'Naira, up to 2 decimals.'; return k; };
  const tax = usesLines ? chk('tax', t.tax) : null;
  const discount = usesLines ? chk('discount', t.discount) : null;
  let due = (kind === 'payment_reminder'&&!t.recorded) || (kind === 'business_proposal' && t.lines.length === 0) ? chk('due', t.due) : null;
  let paymentRecord:FinancialInput['paymentRecord'];
  if(kind==='payment_reminder'&&t.recorded){
    const invoice=chk('invoice',t.invoice);
    if(invoice===null)errors.invoice='Enter the original invoice amount in NGN.';
    const payments=t.payments.map((p,i)=>{
      const amount=chk('paid'+i,p.amount);
      if(amount===null)errors['paid'+i]='Enter the amount you recorded.';
      if(!p.reference.trim())errors['reference'+i]='Enter a distinct payment reference.';
      return{reference:p.reference.trim(),amountKobo:amount??'0'};
    });
    if(!Object.keys(errors).length){
      paymentRecord={invoiceAmountKobo:invoice!,payments};
      try{due=recordedBalance(paymentRecord).amountDueKobo;}
      catch{errors.form='Payment references must be distinct. Check your records; nothing has been deducted twice.';}
    }
  }
  if (Object.keys(errors).length) return { value: null, errors, summary: null };
  const value: FinancialInput = { kind, lines, taxAmountKobo: tax, taxLabel: usesLines ? t.taxLabel.trim().slice(0, 80) : '', discountKobo: discount, amountDueKobo: due,
    ...(paymentRecord?{paymentRecord}:{}) };
  try {
    const blocks = financialBlocks(value);
    return { value, errors, summary: blocks.find((b) => b.id === 'financial-summary-v1')?.rows.slice(1) ?? null };
  } catch (e) {
    const msg = String((e as Error).message);
    errors.form = msg === 'DISCOUNT_EXCEEDS_SUBTOTAL' ? 'The discount is larger than the subtotal.' : 'These amounts cannot be calculated: ' + msg;
    return { value: null, errors, summary: null };
  }
}

export function emptyFinancial(kind: FinancialInput['kind']): FinancialInput {
  return { kind, lines: kind === 'invoice' || kind === 'quotation' ? [{ description: '', quantity: '1', unitPriceKobo: '0' }] : [], taxAmountKobo: null, taxLabel: '', discountKobo: null, amountDueKobo: null };
}

/**
 * Typed financial editor. Emits a valid FinancialInput (or null with errors) on every change.
 * Remount with a new `key` to reset from a different source value.
 */
export function FinancialFields({ value, idPrefix, onChange,onDirtyChange }: { value: FinancialInput; idPrefix: string; onChange: (v: FinancialInput | null) => void;onDirtyChange?:(dirty:boolean)=>void }) {
  const [t, setT] = useState<Text>(() => {
    const x = toText(value);
    if ((value.kind === 'invoice' || value.kind === 'quotation') && x.lines.length && value.lines.every((l) => l.unitPriceKobo === '0' && !l.description)) x.lines = x.lines.map((l) => ({ ...l, price: '' }));
    return x;
  });
  const [touched, setTouched] = useState(false);
  const originalText=useRef(JSON.stringify(t)),dirtyCallback=useRef(onDirtyChange);dirtyCallback.current=onDirtyChange;
  const textSignature=JSON.stringify(t);
  useEffect(()=>{dirtyCallback.current?.(textSignature!==originalText.current);},[textSignature]);
  const r = useMemo(() => parse(value.kind, t), [value.kind, t]);
  const cb = useRef(onChange); cb.current = onChange;
  const sig = JSON.stringify(r.value);
  useEffect(() => { cb.current(r.value); }, [sig,textSignature]); // eslint-disable-line react-hooks/exhaustive-deps

  const kind = value.kind;
  const usesLines = kind !== 'payment_reminder';
  const showDue = kind === 'payment_reminder' || (kind === 'business_proposal' && t.lines.length === 0);
  const e = (k: string) => (touched ? r.errors[k] : undefined);
  const up = (patch: Partial<Text>) => { dirtyCallback.current?.(true);setTouched(true); setT((o) => ({ ...o, ...patch })); };
  const upLine = (i: number, patch: Partial<LineText>) => up({ lines: t.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });

  return (
    <div className="grid gap-5" data-testid={idPrefix + '-financial'}>
      {usesLines && (
        <div>
          <p className="label">Line items {kind === 'business_proposal' && <span className="font-normal text-muted-foreground">(optional)</span>}</p>
          <ul className="grid gap-3">
            {t.lines.map((l, i) => (
              <li key={i} className="grid gap-2 rounded-xl border border-border bg-sidebar/60 p-3 sm:grid-cols-[1fr_6rem_9rem_auto] sm:items-start">
                <Cell id={`${idPrefix}-desc-${i}`} label="Description" err={e('d' + i)}><input id={`${idPrefix}-desc-${i}`} className="field" maxLength={200} value={l.description} onChange={(ev) => upLine(i, { description: ev.target.value })} data-testid={`input-${idPrefix}-desc-${i}`} /></Cell>
                <Cell id={`${idPrefix}-qty-${i}`} label="Qty" err={e('q' + i)}><input id={`${idPrefix}-qty-${i}`} inputMode="decimal" className="field" value={l.quantity} onChange={(ev) => upLine(i, { quantity: ev.target.value })} data-testid={`input-${idPrefix}-qty-${i}`} /></Cell>
                <Cell id={`${idPrefix}-price-${i}`} label="Unit price (NGN)" err={e('p' + i)}><input id={`${idPrefix}-price-${i}`} inputMode="decimal" className="field" value={l.price} placeholder="0.00" onChange={(ev) => upLine(i, { price: ev.target.value })} data-testid={`input-${idPrefix}-price-${i}`} /></Cell>
                <button type="button" aria-label={'Remove line ' + (i + 1)} className="btn btn-ghost btn-sm !px-2.5 sm:mt-6" disabled={kind !== 'business_proposal' && t.lines.length === 1} onClick={() => up({ lines: t.lines.filter((_, j) => j !== i) })} data-testid={`button-${idPrefix}-remove-line-${i}`}><X className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
          {t.lines.length < 40 && <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => up({ lines: [...t.lines, { description: '', quantity: '1', price: '' }] })} data-testid={`button-${idPrefix}-add-line`}><Plus className="h-4 w-4" />Add line</button>}
        </div>
      )}
      {usesLines && t.lines.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Cell id={`${idPrefix}-discount`} label="Discount (NGN, optional)" err={e('discount')}><input id={`${idPrefix}-discount`} inputMode="decimal" className="field" value={t.discount} onChange={(ev) => up({ discount: ev.target.value })} data-testid={`input-${idPrefix}-discount`} /></Cell>
          <Cell id={`${idPrefix}-taxlabel`} label="Additional amount label"><input id={`${idPrefix}-taxlabel`} className="field" maxLength={80} value={t.taxLabel} placeholder="e.g. VAT as I calculated it" onChange={(ev) => up({ taxLabel: ev.target.value })} data-testid={`input-${idPrefix}-taxlabel`} /></Cell>
          <Cell id={`${idPrefix}-tax`} label="Amount (NGN, optional)" err={e('tax')}><input id={`${idPrefix}-tax`} inputMode="decimal" className="field" value={t.tax} onChange={(ev) => up({ tax: ev.target.value })} data-testid={`input-${idPrefix}-tax`} /></Cell>
          <p className="hint !mt-0 sm:col-span-3">Valo does not work out tax rates or whether tax applies. Enter only an amount you have determined yourself.</p>
        </div>
      )}
      {kind==='payment_reminder'&&(
        <fieldset className="grid min-w-0 gap-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-sm font-medium">Your payment records</legend>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-primary" checked={t.recorded}
              onChange={ev=>up({recorded:ev.target.checked,due:r.value?.amountDueKobo?koboToNaira(r.value.amountDueKobo):t.due})}
              data-testid={`input-${idPrefix}-recorded-balance`} />
            Calculate the balance from the original invoice and payments I recorded
          </label>
          <p className="hint">Valo does not verify these payments or authorise a refund. Use a separate reference for each payment.</p>
          {t.recorded&&<>
            <Cell id={`${idPrefix}-invoice-amount`} label="Original invoice amount (NGN)" err={e('invoice')}>
              <input id={`${idPrefix}-invoice-amount`} inputMode="decimal" className="field" value={t.invoice}
                aria-invalid={!!e('invoice')} aria-describedby={e('invoice')?`${idPrefix}-invoice-amount-error`:undefined}
                onChange={ev=>up({invoice:ev.target.value})} data-testid={`input-${idPrefix}-invoice-amount`}/>
            </Cell>
            {t.payments.map((p,i)=><fieldset key={i} className="grid min-w-0 gap-2 border-t border-border pt-3">
              <legend className="text-sm">Payment record {i+1}</legend>
              <Cell id={`${idPrefix}-payment-reference-${i}`} label={`Payment reference ${i+1}`} err={e('reference'+i)}>
                <input id={`${idPrefix}-payment-reference-${i}`} className="field" maxLength={80} value={p.reference}
                  aria-invalid={!!e('reference'+i)} aria-describedby={e('reference'+i)?`${idPrefix}-payment-reference-${i}-error`:undefined}
                  onChange={ev=>up({payments:t.payments.map((v,j)=>i===j?{...v,reference:ev.target.value}:v)})}
                  data-testid={`input-${idPrefix}-payment-reference-${i}`}/>
              </Cell>
              <Cell id={`${idPrefix}-payment-amount-${i}`} label={`Recorded amount ${i+1} (NGN)`} err={e('paid'+i)}>
                <input id={`${idPrefix}-payment-amount-${i}`} className="field" inputMode="decimal" value={p.amount}
                  aria-invalid={!!e('paid'+i)} aria-describedby={e('paid'+i)?`${idPrefix}-payment-amount-${i}-error`:undefined}
                  onChange={ev=>up({payments:t.payments.map((v,j)=>i===j?{...v,amount:ev.target.value}:v)})}
                  data-testid={`input-${idPrefix}-payment-amount-${i}`}/>
              </Cell>
              <button type="button" className="btn btn-ghost btn-sm justify-self-start" aria-label={`Remove payment record ${i+1}`}
                onClick={()=>up({payments:t.payments.filter((_,j)=>j!==i)})}>Remove payment record</button>
            </fieldset>)}
            {t.payments.length<40&&<button type="button" className="btn btn-ghost btn-sm justify-self-start"
              onClick={()=>up({payments:[...t.payments,{reference:'',amount:''}]})} data-testid={`button-${idPrefix}-add-payment`}>
              <Plus className="h-4 w-4"/>Add recorded payment
            </button>}
          </>}
        </fieldset>
      )}
      {showDue && !(kind==='payment_reminder'&&t.recorded) && (
        <Cell id={`${idPrefix}-due`} label={kind === 'payment_reminder' ? 'Amount you recorded as due (NGN)' : 'Proposed budget (NGN, optional)'} err={e('due')}>
          <input id={`${idPrefix}-due`} inputMode="decimal" className="field sm:max-w-xs" value={t.due} onChange={(ev) => up({ due: ev.target.value })} data-testid={`input-${idPrefix}-due`} />
        </Cell>
      )}
      {e('form') && <p role="alert" className="text-sm text-destructive">{e('form')}</p>}
      {r.value?.paymentRecord&&r.value.amountDueKobo==='0'&&<p role="status" className="text-sm">
        These records show no positive amount due. Reconcile them before sending an enquiry; no refund is authorised.
      </p>}
      {r.summary && r.summary.length > 0 && (
        <dl className="grid gap-1 rounded-xl border border-border p-4 text-sm" aria-live="polite" data-testid={`text-${idPrefix}-summary`}>
          {r.summary.map(([k, v], i) => (
            <div key={i} className={cn('flex justify-between gap-4', i === r.summary!.length - 1 && 'border-t border-border pt-2 font-medium')}><dt className="min-w-0 text-muted-foreground [overflow-wrap:anywhere]">{k}</dt><dd className="min-w-0 text-right font-mono tabular-nums [overflow-wrap:anywhere]">{v}</dd></div>
          ))}
        </dl>
      )}
      {!r.value && Object.keys(r.errors).length > 0 && !touched && <p className="hint">Complete the amounts above.</p>}
    </div>
  );
}

function Cell({ id, label, err, children }: { id: string; label: string; err?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <label className="label !text-xs" htmlFor={id}>{label}</label>
      {children}
      {err && <p id={id+'-error'} className="hint !text-destructive">{err}</p>}
    </div>
  );
}

