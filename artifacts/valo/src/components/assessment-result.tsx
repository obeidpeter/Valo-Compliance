import { OperationalAids } from "./operational-aids";
import { useState, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Quote } from "lucide-react";
import type { AssessmentItem, AssessmentResult, PublicItem } from "@workspace/api-client-react";
import { Notice } from "@/components/states";
import { factLabel } from "@/lib/checker";
import { formatDay } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MISSING_ANSWER_STATE_LABELS, RESULT_LABELS, RESULT_TONES } from "@/lib/rich-checker";
import {
  requirementDates,
  requirementFigures,
  requirementRoute,
  resultGaps,
  resultNotice,
  shortRulesVersion,
} from "@/lib/result-words";
import { documentsFor, resultTemplateNumbers } from "@/lib/result-documents";
import {
  RecommendedDocuments,
  RequirementDocuments,
  ResultDocumentsUnavailable,
  useResultDocuments,
} from "./result-documents";

export function AssessmentResultView({
  result,
  itemAction,
  questionAction,
  onQuestion,
}: {
  result: AssessmentResult;
  itemAction?: (item: AssessmentItem) => ReactNode;
  questionAction?: ((field: string) => ReactNode) | undefined;
  /** Moves to one of the check's questions that the result lists as still unanswered. */
  onQuestion?: ((field: string) => void) | undefined;
}) {
  const labels = [
    ...RESULT_LABELS,
    ...new Set(
      result.items
        .map((i) => i.label)
        .filter((label) => !(RESULT_LABELS as readonly string[]).includes(label)),
    ),
  ];
  const groups = labels
    .map((label) => ({ label, items: result.items.filter((i) => i.label === label) }))
    .filter((g) => g.items.length);
  // The box below says that nothing was found, so the list of what is not covered does not repeat it.
  const gaps = resultGaps(result.gaps, result.items.length === 0);
  // RUL-006: the documents the requirements relate, by the titles and links the released list gives.
  const documents = useResultDocuments(resultTemplateNumbers(result));
  const recommended = documentsFor(result.recommendedTemplateIds, documents.released);
  return (
    <div className="grid min-w-0 gap-6" data-testid="assessment-result">
      <div
        className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"
        data-testid="result-basis"
      >
        <span>Rules as at {formatDay(result.asOfDate)}</span>
        <span className="min-w-0 break-all" title={result.rulesetVersion}>
          Rules version {shortRulesVersion(result.rulesetVersion)}
        </span>
        <span>
          {result.sourceBackedRecommendations === 1
            ? "1 result with a source"
            : `${result.sourceBackedRecommendations} results with a source`}
        </span>
        <span className="truncate" title={result.resultHash}>
          Reference {result.resultHash.slice(0, 12)}
        </span>
      </div>

      {result.notice && (
        <Notice tone="ink" title="Read this first">
          {resultNotice(result.notice)}
        </Notice>
      )}

      {result.items.length === 0 ? (
        <div className="surface rule-lines p-6 sm:p-8" data-testid="status-coverage-unavailable">
          <p className="eyebrow">Nothing to show yet</p>
          <p className="font-display mt-3 text-2xl sm:text-3xl">
            No published rule covers these answers yet.
          </p>
          <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">
            This does not mean that you are exempt from anything. It only means Valo has no checked, published
            rule to compare your answers with. Use the official sources below, or ask a qualified adviser.
          </p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.label} aria-label={g.label}>
            <div className="mb-3 flex items-center gap-3">
              <span className={cn("pill", RESULT_TONES[g.label] ?? "pill-ink")}>
                <span className="dot" />
                {g.label}
              </span>
              <span className="text-xs text-muted-foreground">{g.items.length}</span>
            </div>
            <ul className="grid gap-3">
              {g.items.map((it) => (
                <Item
                  key={it.ruleId}
                  item={it}
                  action={itemAction?.(it)}
                  questionAction={questionAction}
                  documents={documentsFor(it.relatedTemplateIds, documents.released)}
                />
              ))}
            </ul>
          </section>
        ))
      )}

      {(result.unanswered.length > 0 || gaps.length > 0) && (
        <div className="grid gap-4 md:grid-cols-2">
          {result.unanswered.length > 0 && (
            <div className="surface p-5">
              <p className="eyebrow">Still unanswered</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {result.unanswered.map((u) => (
                  <li key={u}>
                    {onQuestion ? (
                      <button
                        type="button"
                        className="pill pill-ink underline-offset-2 hover:underline"
                        aria-label={`Answer ${factLabel(u)}`}
                        onClick={() => onQuestion(u)}
                      >
                        {factLabel(u)}
                      </button>
                    ) : (
                      <span className="pill pill-ink">{factLabel(u)}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {gaps.length > 0 && (
            <div className="surface p-5">
              <p className="eyebrow">What Valo does not cover yet</p>
              <ul className="mt-3 grid gap-2 text-sm leading-relaxed">
                {gaps.map((g) => (
                  <li key={g} className="border-l-2 border-[hsl(var(--ochre))] pl-3">
                    {g}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {documents.failed ? (
        <ResultDocumentsUnavailable retrying={documents.retrying} onRetry={documents.retry} />
      ) : (
        <RecommendedDocuments documents={recommended} />
      )}

      {result.officialRoutes.length > 0 && (
        <div className="surface p-5">
          <p className="eyebrow">Official sources</p>
          <ul className="mt-3 grid gap-2">
            {result.officialRoutes.map((r) => (
              <li key={r.url}>
                <a
                  href={r.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  {r.title}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      <OperationalAids />
    </div>
  );
}

function Item({
  item,
  action,
  questionAction,
  documents,
}: {
  item: AssessmentItem;
  action?: ReactNode;
  questionAction?: ((field: string) => ReactNode) | undefined;
  documents: PublicItem[];
}) {
  const [open, setOpen] = useState(false);
  const detail = item;
  const missingStates = new Map(detail.missingAnswerStates?.map((answer) => [answer.field, answer.state]));
  const figures = requirementFigures(item);
  const dates = requirementDates(item);
  const route = requirementRoute(item);
  // CMP-003: federal, state and local requirements are told apart, each named for where it applies.
  const { level, state, lga } = item.jurisdiction;
  const place =
    level === "federal"
      ? "Federal"
      : level === "state"
        ? ["State", state].filter(Boolean).join(": ")
        : ["Local government", [lga, state].filter(Boolean).join(", ")].filter(Boolean).join(": ");
  return (
    <li className="surface overflow-hidden" data-testid={"card-item-" + item.ruleId}>
      <div className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-medium leading-snug">{item.title}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {place} · Rule {item.ruleId}, version {item.ruleVersion}
            </p>
            {/* CMP-004: its dates, each with its own label. */}
            {dates.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground" data-testid={"dates-" + item.ruleId}>
                {dates.join(" · ")}
              </p>
            )}
            {/* EDP-008: how the rule was released, as the server recorded it with the result. */}
            {detail.releaseNotice && (
              <p
                className="mt-1 text-xs leading-relaxed text-muted-foreground"
                data-testid={"release-notice-" + item.ruleId}
              >
                {detail.releaseNotice}
              </p>
            )}
          </div>
          {action}
        </div>
        {detail.assessedProposition && (
          <p className="mt-3 text-sm">
            <span className="text-muted-foreground">The question checked: </span>
            {detail.assessedProposition}
          </p>
        )}
        {detail.factsNotice && (
          <p
            className="mt-2 rounded-lg bg-secondary px-3 py-2 text-xs leading-relaxed"
            data-testid={"facts-notice-" + item.ruleId}
          >
            {detail.factsNotice}
          </p>
        )}
        <div className="mt-3 text-sm leading-relaxed" data-testid={"why-" + item.ruleId}>
          <p className="font-medium">Why am I seeing this?</p>
          <p className="mt-1 text-foreground/85">{item.reason}</p>
          {item.matchedFacts.length > 0 && (
            <p className="mt-1 text-muted-foreground">
              Answers this is based on: {item.matchedFacts.map((field) => factLabel(field)).join(", ")}
            </p>
          )}
        </div>
        {item.missingFacts.length > 0 && (
          <ul className="mt-3 grid gap-2 text-sm" aria-label="Answers to provide or review">
            {item.missingFacts.map((field) => (
              <li key={field} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-muted-foreground">{factLabel(field)}: </span>
                  {missingStates.has(field)
                    ? MISSING_ANSWER_STATE_LABELS[missingStates.get(field)!]
                    : "Not supplied"}
                </span>
                {questionAction?.(field)}
              </li>
            ))}
          </ul>
        )}
        {item.sourceReviewHold && (
          <div
            className="mt-3 rounded-xl border border-border p-3 text-sm"
            role="note"
            aria-label="Source review needed"
            data-testid={"source-review-hold-" + item.ruleId}
          >
            <p className="font-medium">Source review needed</p>
            <p className="mt-1 leading-relaxed">{item.sourceReviewHold}</p>
          </div>
        )}
        {item.nextStep && (
          <p className="mt-2 text-sm">
            <span className="text-muted-foreground">Next step: </span>
            {item.nextStep}
          </p>
        )}
        {/* CMP-007: the authority's own page for this requirement, as its rule records it. */}
        {route && (
          <p className="mt-2 text-sm" data-testid={"route-" + item.ruleId}>
            <span className="text-muted-foreground">Official page: </span>
            <a
              href={route.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 font-medium text-primary underline underline-offset-2"
            >
              {route.authority}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          </p>
        )}
        {figures.length > 0 && (
          <ul className="mt-2 grid gap-1 text-sm" data-testid={"figures-" + item.ruleId}>
            {figures.map((figure, index) => (
              <li key={index}>
                <span className="text-muted-foreground">{figure.label}: </span>
                {figure.words}
                {figure.source && <span className="text-muted-foreground"> ({figure.source})</span>}
              </li>
            ))}
          </ul>
        )}
        <RequirementDocuments ruleId={item.ruleId} documents={documents} />
        {item.sources.length > 0 && (
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-testid={"button-sources-" + item.ruleId}
          >
            {open ? "Hide" : "Show"} {item.sources.length} source{item.sources.length > 1 ? "s" : ""}
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
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
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  {s.title}
                </a>
                <span className="mx-1.5">·</span>
                <span className="font-mono">{s.locator}</span>
              </p>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
