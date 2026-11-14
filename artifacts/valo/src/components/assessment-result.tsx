import { OperationalAids } from './operational-aids';
import { useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, Quote } from 'lucide-react';
import type { AssessmentItem, AssessmentResult } from '@workspace/api-client-react';
import { Notice } from '@/components/states';
import { factLabel } from '@/lib/checker';
import { cn } from '@/lib/utils';
import { MISSING_ANSWER_STATE_LABELS, RESULT_LABELS, RESULT_TONES } from '@/lib/rich-checker';

export function AssessmentResultView({ result, itemAction, questionAction }: { result: AssessmentResult; itemAction?: (item: AssessmentItem) => ReactNode; questionAction?: (field: string) => ReactNode }) {
  const labels = [...RESULT_LABELS, ...new Set(result.items.map(i => i.label).filter(label => !(RESULT_LABELS as readonly string[]).includes(label)))];
  const groups = labels.map((label) => ({ label, items: result.items.filter((i) => i.label === label) })).filter((g) => g.items.length);
  return (
    <div className="grid gap-6" data-testid="assessment-result">
      <div className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs text-muted-foreground">
        <span>As of {result.asOfDate}</span>
        <span>Ruleset {result.rulesetVersion}</span>
        <span>{result.sourceBackedRecommendations} source-backed</span>
        <span className="truncate" title={result.resultHash}>hash {result.resultHash.slice(0, 12)}</span>
      </div>

      {result.notice && <Notice tone="ink" title="Read this first">{result.notice}</Notice>}

      {result.items.length === 0 ? (
        <div className="surface rule-lines p-6 sm:p-8" data-testid="status-coverage-unavailable">
          <p className="eyebrow">Coverage unavailable</p>
          <p className="font-display mt-3 text-2xl sm:text-3xl">No released rules cover these answers yet.</p>
          <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
            This is not a finding that you are exempt from anything. It only means Valo has no checked, released rule to compare your answers against. Use the official routes below, or ask a qualified adviser.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <div className="mb-3 flex items-center gap-3"><span className={cn('pill', RESULT_TONES[g.label] ?? 'pill-ink')}><span className="dot" />{g.label}</span><span className="text-xs text-muted-foreground">{g.items.length}</span></div>
            <ul className="grid gap-3">{g.items.map((it) => <Item key={it.ruleId} item={it} action={itemAction?.(it)} questionAction={questionAction} />)}</ul>
          </section>
        ))
      )}

      {(result.unanswered.length > 0 || result.gaps.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {result.unanswered.length > 0 && (
            <div className="surface p-5">
              <p className="eyebrow">Still unanswered</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">{result.unanswered.map((u) => <li key={u} className="pill pill-ink">{factLabel(u)}</li>)}</ul>
            </div>
          )}
          {result.gaps.length > 0 && (
            <div className="surface p-5">
              <p className="eyebrow">Known coverage gaps</p>
              <ul className="mt-3 grid gap-2 text-sm leading-relaxed">{result.gaps.map((g) => <li key={g} className="border-l-2 border-[hsl(var(--ochre))] pl-3">{g}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {result.officialRoutes.length > 0 && (
        <div className="surface p-5">
          <p className="eyebrow">Official routes</p>
          <ul className="mt-3 grid gap-2">
            {result.officialRoutes.map((r) => (
              <li key={r.url}><a href={r.url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline">{r.title}<ExternalLink className="h-3.5 w-3.5" /></a></li>
            ))}
          </ul>
        </div>
      )}
      <OperationalAids />
    </div>
  );
}

function Item({ item, action, questionAction }: { item: AssessmentItem; action?: ReactNode; questionAction?: (field: string) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const detail = item;
  const missingStates = new Map(detail.missingAnswerStates?.map(answer => [answer.field, answer.state]));
  const jur = [item.jurisdiction.level, item.jurisdiction.state, item.jurisdiction.lga].filter(Boolean).join(' / ');
  return (
    <li className="surface overflow-hidden" data-testid={'card-item-' + item.ruleId}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium leading-snug">{item.title}</p>
            <p className="mt-1 font-mono text-[0.7rem] uppercase tracking-wider text-muted-foreground">{jur} · {item.ruleId} v{item.ruleVersion}</p>
          </div>
          {action}
        </div>
        {detail.assessedProposition && <p className="mt-3 text-sm"><span className="text-muted-foreground">Question assessed: </span>{detail.assessedProposition}</p>}
        {detail.factsNotice && <p className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed" data-testid={'facts-notice-' + item.ruleId}>{detail.factsNotice}</p>}
        <p className="mt-3 text-sm leading-relaxed text-foreground/85">{item.reason}</p>
        {item.missingFacts.length > 0 && (
          <ul className="mt-3 grid gap-2 text-sm" aria-label="Answers to provide or review">{item.missingFacts.map(field => <li key={field} className="flex flex-wrap items-center justify-between gap-2"><span><span className="text-muted-foreground">{factLabel(field)}: </span>{missingStates.has(field) ? MISSING_ANSWER_STATE_LABELS[missingStates.get(field)!] : 'Not supplied'}</span>{questionAction?.(field)}</li>)}</ul>
        )}
        {item.sourceReviewHold && <div className="mt-3 rounded-xl border border-border p-3 text-sm" role="note" aria-label="Source review needed" data-testid={'source-review-hold-' + item.ruleId}>
          <p className="font-medium">Source review needed</p>
          <p className="mt-1 leading-relaxed">{item.sourceReviewHold}</p>
        </div>}
        {item.nextStep && <p className="mt-2 text-sm"><span className="text-muted-foreground">Next step: </span>{item.nextStep}</p>}
        {item.sources.length > 0 && (
          <button type="button" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid={'button-sources-' + item.ruleId}>
            {open ? 'Hide' : 'Show'} {item.sources.length} source{item.sources.length > 1 ? 's' : ''}
            <ChevronDown className={cn('h-4 w-4 transition-transform', open && 'rotate-180')} />
          </button>
        )}
      </div>
      {open && (
        <ul className="grid gap-px border-t border-border bg-border">
          {item.sources.map((s) => (
            <li key={s.id} className="bg-sidebar p-5">
              <Quote className="h-4 w-4 text-muted-foreground" />
              <blockquote className="font-display mt-2 text-[1.05rem] leading-relaxed">{s.quote}</blockquote>
              <p className="mt-3 text-xs text-muted-foreground">
                <a href={s.url} target="_blank" rel="noreferrer noopener" className="font-medium text-foreground underline underline-offset-2">{s.title}</a>
                <span className="mx-1.5">·</span><span className="font-mono">{s.locator}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

