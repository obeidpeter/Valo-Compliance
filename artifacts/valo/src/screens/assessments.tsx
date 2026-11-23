import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, ClipboardCheck, GitCompare, ListPlus } from "lucide-react";
import {
  useListAssessments,
  useGetAssessment,
  useCompareAssessments,
  useCreateTask,
  getListAssessmentsQueryKey,
  getGetAssessmentQueryKey,
  getCompareAssessmentsQueryKey,
  getListTasksQueryKey,
  type AssessmentItem,
  type SavedAssessment,
} from "@workspace/api-client-react";
import { Breadcrumbs } from "@/components/breadcrumbs";
import { WorkspaceNav } from "@/components/workspace-nav";
import { AssessmentResultView } from "@/components/assessment-result";
import { TaskForm, emptyDraft, type TaskDraft } from "@/components/task-form";
import { EmptyState, ErrorState, Notice, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { formatDateTime, formatDay } from "@/lib/format";
import { describeAssessmentChange } from "@/lib/assessment-changes";
import { reviewFacts, displayFact, factLabel, isMarker, live } from "@/lib/checker";
import { RESULT_LABELS, RESULT_TONES, factAtPath, canCreateSourceTask } from "@/lib/rich-checker";
import { shortRulesVersion } from "@/lib/result-words";
import { useToast } from "@/hooks/use-toast";

function counts(a: SavedAssessment) {
  return RESULT_LABELS.map((label) => ({
    label,
    count: a.result.items.filter((item) => item.label === label).length,
  })).filter((item) => item.count > 0);
}

function savedResultContext(facts: SavedAssessment["facts"]): string {
  const parts: string[] = [];
  if (facts.legalForm && !isMarker(facts.legalForm)) parts.push(displayFact("legalForm", facts.legalForm));
  if (facts.state && !isMarker(facts.state)) parts.push(displayFact("state", facts.state));
  return parts.join(" · ");
}

export function AssessmentsList() {
  const list = useListAssessments({ query: { queryKey: getListAssessmentsQueryKey(), ...live } });
  const sorted = useMemo(
    () => [...(list.data ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [list.data],
  );
  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <div className="reveal flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Requirements</p>
          <h1 className="font-display mt-2 text-4xl">Saved results</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {sorted.length >= 2 && (
            <Link
              href={`/workspace/assessments/${sorted[0]!.id}?compare=${sorted[1]!.id}`}
              className="btn btn-ghost"
              data-testid="link-compare-latest"
            >
              <GitCompare className="h-4 w-4" aria-hidden="true" />
              Compare latest two
            </Link>
          )}
          <Link href="/workspace/checker" className="btn btn-primary" data-testid="link-new-assessment">
            <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
            New check
          </Link>
        </div>
      </div>
      <p className="mt-3 max-w-2xl text-muted-foreground">
        Each saved result keeps the answers and the version of the rules it used, so you can see later what
        changed.
      </p>
      <div className="mt-8">
        {list.isLoading ? (
          <div className="grid gap-3">
            {[0, 1, 2].map((i) => (
              <Skel key={i} className="h-24" />
            ))}
          </div>
        ) : list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : sorted.length === 0 ? (
          <EmptyState
            mark={<ClipboardCheck className="h-5 w-5 text-muted-foreground" />}
            title="No saved results yet"
            action={
              <Link href="/workspace/checker" className="btn btn-primary">
                Check my requirements
              </Link>
            }
          >
            Check your requirements, then choose to save the result. It is kept here.
          </EmptyState>
        ) : (
          <ol className="relative grid gap-3 border-l border-border pl-5 sm:pl-6">
            {sorted.map((a) => {
              const c = counts(a);
              const context = savedResultContext(a.facts);
              return (
                <li key={a.id} className="relative">
                  <span
                    aria-hidden
                    className="absolute -left-[1.6rem] top-6 h-2.5 w-2.5 rounded-full border-2 border-background bg-primary sm:-left-[1.85rem]"
                  />
                  <Link
                    href={"/workspace/assessments/" + a.id}
                    className="surface group flex flex-wrap items-center gap-4 p-5 transition-shadow hover:shadow-[var(--shadow-md)]"
                    data-testid={"link-assessment-" + a.id}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">
                        {formatDateTime(a.createdAt)}
                        {context ? (
                          <span className="ml-2 font-normal text-muted-foreground">· {context}</span>
                        ) : null}
                      </span>
                      <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                        <span>Rules as at {formatDay(a.result.asOfDate)}</span>
                        <span className="min-w-0 break-all" title={a.result.rulesetVersion}>
                          Rules version {shortRulesVersion(a.result.rulesetVersion)}
                        </span>
                        <span>
                          {a.profileRevision
                            ? "From your profile, version " + a.profileRevision
                            : "From the answers you gave"}
                        </span>
                      </span>
                    </span>
                    {a.result.items.length === 0 ? (
                      <span className="pill pill-ink">No rules covered these answers</span>
                    ) : (
                      <span className="flex flex-wrap gap-1.5">
                        {c.map(({ label, count }) => (
                          <span key={label} className={"pill " + RESULT_TONES[label]}>
                            {count} {label.toLowerCase()}
                          </span>
                        ))}
                      </span>
                    )}
                    <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

export function AssessmentDetail({ id }: { id: string }) {
  const search = useSearch();
  const a = useGetAssessment(id, {
    query: { enabled: !!id, queryKey: getGetAssessmentQueryKey(id), ...live },
  });
  const list = useListAssessments({ query: { queryKey: getListAssessmentsQueryKey(), ...live } });
  const [prevId, setPrevId] = useState(() => new URLSearchParams(search).get("compare") ?? "");
  const [taskFor, setTaskFor] = useState<string | null>(null);
  const others = useMemo(
    () => (list.data ?? []).filter((x) => x.id !== id).sort((x, y) => y.createdAt.localeCompare(x.createdAt)),
    [list.data, id],
  );

  if (a.isLoading)
    return (
      <div className="mx-auto max-w-5xl px-5 py-12">
        <Skel className="h-10 w-60" />
        <Skel className="mt-6 h-96" />
      </div>
    );
  if (a.isError || !a.data)
    return (
      <div className="mx-auto max-w-5xl px-5 py-12">
        <WorkspaceNav />
        <ErrorState error={a.error} onRetry={() => a.refetch()} />
      </div>
    );
  const s = a.data;
  const facts = s.facts as unknown as Record<string, unknown>;

  return (
    <div className="mx-auto max-w-5xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <Breadcrumbs
        items={[
          { label: "Home", href: "/workspace" },
          { label: "All saved results", href: "/workspace/assessments" },
          { label: formatDay(s.createdAt) },
        ]}
      />
      <h1 className="font-display mt-3 text-4xl">Result saved {formatDateTime(s.createdAt)}</h1>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="text-result-origin">
        {s.profileRevision
          ? "Worked out from your business profile, version " + s.profileRevision + "."
          : "Worked out from the answers you gave when you checked."}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          <AssessmentResultView
            result={s.result}
            // oxlint-disable-next-line react/no-unstable-nested-components -- a render function the list calls, not a component
            itemAction={(it) =>
              canCreateSourceTask(it) ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-expanded={taskFor === it.ruleId}
                  onClick={() => setTaskFor(taskFor === it.ruleId ? null : it.ruleId)}
                  data-testid={"button-task-" + it.ruleId}
                >
                  <ListPlus className="h-4 w-4" />
                  Add task
                </button>
              ) : null
            }
          />
          {taskFor &&
            (() => {
              const it = s.result.items.find((i) => i.ruleId === taskFor);
              return it && canCreateSourceTask(it) ? (
                <TaskFromItem key={it.ruleId} assessmentId={s.id} item={it} onDone={() => setTaskFor(null)} />
              ) : null;
            })()}
        </div>
        <aside className="grid h-fit gap-4">
          <details className="surface p-5" open>
            <summary className="eyebrow cursor-pointer">Answers used</summary>
            <dl className="mt-3 grid gap-2 text-sm">
              {reviewFacts(facts).map(([k, value]) => (
                <div key={k} className="border-t border-border pt-2">
                  <dt className="text-xs text-muted-foreground">{factLabel(k)}</dt>
                  <dd className="break-words">{displayFact(k, value)}</dd>
                </div>
              ))}
            </dl>
            <Link
              href={"/workspace/profile?fromAssessment=" + encodeURIComponent(s.id)}
              className="btn btn-ghost btn-sm mt-4 w-full"
              data-testid="link-copy-to-profile"
            >
              Copy answers to business profile
            </Link>
          </details>
        </aside>
      </div>

      <section className="surface mt-10 p-5 sm:p-7" aria-labelledby="cmp-h">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Compare</p>
            <h2 id="cmp-h" className="font-display mt-1 text-2xl">
              What changed since an earlier check
            </h2>
          </div>
          <div className="w-full sm:w-72">
            <label className="label" htmlFor="prev">
              Earlier result
            </label>
            <select
              id="prev"
              className="field"
              value={prevId}
              onChange={(e) => setPrevId(e.target.value)}
              disabled={list.isLoading || others.length === 0}
              data-testid="select-compare"
            >
              <option value="">
                {list.isLoading ? "Loading…" : others.length ? "Choose one" : "No other saved results"}
              </option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {formatDateTime(o.createdAt)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {list.isError && (
          <div className="mt-4">
            <ErrorState error={list.error} onRetry={() => list.refetch()} />
          </div>
        )}
        {prevId && (
          <Comparison id={id} prevId={prevId} current={s} previous={others.find((o) => o.id === prevId)} />
        )}
      </section>
    </div>
  );
}

function Comparison({
  id,
  prevId,
  current,
  previous,
}: {
  id: string;
  prevId: string;
  current: SavedAssessment;
  previous?: SavedAssessment | undefined;
}) {
  const c = useCompareAssessments(id, prevId, {
    query: { enabled: !!id && !!prevId, queryKey: getCompareAssessmentsQueryKey(id, prevId), ...live },
  });
  const title = (rid: string) =>
    current.result.items.find((i) => i.ruleId === rid)?.title ??
    previous?.result.items.find((i) => i.ruleId === rid)?.title ??
    rid;
  if (c.isLoading)
    return (
      <div className="mt-5 grid gap-2">
        <Skel className="h-16" />
        <Skel className="h-16" />
      </div>
    );
  if (c.isError || !c.data)
    return (
      <div className="mt-5">
        <ErrorState error={c.error} onRetry={() => c.refetch()} />
      </div>
    );
  const d = c.data;
  const none =
    !d.changedFacts.length && !d.addedRuleIds.length && !d.removedRuleIds.length && !d.changedRuleIds.length;
  if (none)
    return (
      <p className="mt-5 rounded-xl bg-secondary px-4 py-3 text-sm" data-testid="status-no-changes">
        Nothing differs between these two results: not your answers, and not the rules that matched.
      </p>
    );
  const pf = previous?.facts as unknown as Record<string, unknown> | undefined;
  const cf = current.facts as unknown as Record<string, unknown>;
  return (
    <div className="mt-6 grid gap-6 md:grid-cols-2" data-testid="comparison">
      <div>
        <p className="text-sm font-medium">
          <GitCompare className="mr-1.5 inline h-4 w-4" />
          Changed answers ({d.changedFacts.length})
        </p>
        <ul className="mt-2 grid gap-2 text-sm">
          {d.changedFacts.length === 0 ? (
            <li className="text-muted-foreground">None</li>
          ) : (
            d.changedFacts.map((k) => (
              <li key={k} className="rounded-xl border border-border p-3">
                <span className="block text-xs text-muted-foreground">{factLabel(k)}</span>
                {pf ? (
                  <>
                    <span className="text-muted-foreground line-through">
                      {displayFact(k, factAtPath(pf, k))}
                    </span>{" "}
                    <ArrowRight className="mx-1 inline h-3 w-3" /> {displayFact(k, factAtPath(cf, k))}
                  </>
                ) : (
                  displayFact(k, factAtPath(cf, k))
                )}
              </li>
            ))
          )}
        </ul>
      </div>
      <div className="grid gap-4 text-sm">
        <RuleList label="Newly matched" tone="pill-forest" ids={d.addedRuleIds} title={title} />
        <RuleList label="No longer matched" tone="pill-ink" ids={d.removedRuleIds} title={title} />
        <RuleList label="Result changed" tone="pill-ochre" ids={d.changedRuleIds} title={title} />
      </div>
      {d.explanations.length > 0 && (
        <section className="md:col-span-2" data-testid="comparison-explanations">
          <p className="text-sm font-medium">Why results changed</p>
          <ul className="mt-2 grid gap-2 text-sm">
            {d.explanations.map((change) => (
              <li key={change.ruleId} className="rounded-xl border border-border p-3">
                <span className="font-medium">{change.title}</span>
                {describeAssessmentChange(change, factLabel).map((line) => (
                  <span key={line} className="mt-1 block text-muted-foreground">
                    {line}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RuleList({
  label,
  tone,
  ids,
  title,
}: {
  label: string;
  tone: string;
  ids: string[];
  title: (id: string) => string;
}) {
  return (
    <div>
      <span className={"pill " + tone}>
        {label} · {ids.length}
      </span>
      {ids.length > 0 && (
        <ul className="mt-2 grid gap-1">
          {ids.map((r) => (
            <li key={r} className="flex justify-between gap-3 border-t border-border pt-1.5">
              <span>{title(r)}</span>
              <span className="font-mono text-xs text-muted-foreground">{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TaskFromItem({
  assessmentId,
  item,
  onDone,
}: {
  assessmentId: string;
  item: AssessmentItem;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<TaskDraft>(() => ({
    ...emptyDraft(item.title.slice(0, 200)),
    notes: item.nextStep.slice(0, 6000),
  }));
  const create = useCreateTask();
  function submit() {
    create.mutate(
      {
        data: {
          title: draft.title.trim(),
          notes: draft.notes,
          dueDate: draft.dueDate || null,
          dateConfirmed: !!draft.dueDate && draft.dateConfirmed,
          assessmentId,
          ruleId: item.ruleId,
        },
      },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: getListTasksQueryKey() });
          toast({ title: "Task added", description: "Find it under Tasks." });
          onDone();
        },
      },
    );
  }
  return (
    <div className="surface mt-4 border-primary/40 p-5 sm:p-6" data-testid="panel-task-from-item">
      <p className="eyebrow">New task from this item</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Linked to rule <span className="font-mono">{item.ruleId}</span>. Marking it done later records your
        own progress, not regulator approval.
      </p>
      <div className="mt-4">
        <TaskForm
          idPrefix="from-item"
          draft={draft}
          onChange={setDraft}
          onSubmit={submit}
          pending={create.isPending}
          submitLabel="Create task"
          extra={
            create.error ? (
              <p role="alert" className="rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {describeError(create.error).message}
              </p>
            ) : undefined
          }
          footer={
            <button type="button" className="btn btn-ghost btn-sm" onClick={onDone}>
              Cancel
            </button>
          }
        />
      </div>
      <Notice className="mt-4" tone="ink" title="Tasks are yours">
        Valo does not file anything or contact any agency on your behalf.
      </Notice>
    </div>
  );
}
