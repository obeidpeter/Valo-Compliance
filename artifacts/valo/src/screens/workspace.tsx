import { useMemo } from "react";
import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { ArrowRight, Download, FilePlus2, ListTodo, UserRound } from "lucide-react";
import {
  useGetWorkspace,
  useListAssessments,
  useListTasksPage,
  useListWorkspaceExports,
  getGetWorkspaceQueryKey,
  getListAssessmentsQueryKey,
  getListTasksPageQueryKey,
  getListWorkspaceExportsQueryKey,
} from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { ErrorState, Skel } from "@/components/states";
import { CorrectionNotices } from "@/components/correction-notices";
import { DocumentList } from "@/components/document-list";
import { FILE_FORMAT_NAMES } from "@/lib/file-formats";
import { formatCount, formatDay } from "@/lib/format";
import { RESULT_LABELS, RESULT_TONES } from "@/lib/rich-checker";

/**
 * The workspace's home. The greeting comes first, with the one button that starts a document. Then
 * anything that needs a look, a quick orientation map for first-time workspaces, the documents last
 * worked on, open tasks, the latest requirements check status, and the business profile.
 */
export default function WorkspaceHome() {
  const { user } = useUser();
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });
  const assessments = useListAssessments({
    query: { enabled: ws.isSuccess, queryKey: getListAssessmentsQueryKey() },
  });
  const openTasks = useListTasksPage(
    { page: 1, filter: "open" },
    { query: { enabled: ws.isSuccess, queryKey: getListTasksPageQueryKey({ page: 1, filter: "open" }) } },
  );
  const exportsList = useListWorkspaceExports({
    query: { enabled: ws.isSuccess, queryKey: getListWorkspaceExportsQueryKey() },
  });

  const name = user?.firstName;
  const profile = ws.data?.profile ?? null;
  const documents = ws.data?.documentCount ?? 0;
  const latestResult = useMemo(() => {
    const items = assessments.data ?? [];
    if (!items.length) return null;
    return [...items].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
  }, [assessments.data]);
  const latestCounts = useMemo(() => {
    if (!latestResult) return [];
    return RESULT_LABELS.map((label) => ({
      label,
      count: latestResult.result.items.filter((item) => item.label === label).length,
    })).filter((entry) => entry.count > 0);
  }, [latestResult]);
  const profileMovedAhead = Boolean(
    profile &&
    latestResult?.profileRevision &&
    ws.data &&
    ws.data.profileRevision > latestResult.profileRevision,
  );
  const showStarterMap = ws.isSuccess && documents === 0 && !profile;
  const upcomingTasks = (openTasks.data?.items ?? []).slice(0, 2);
  const openTaskCount = openTasks.data?.openCount ?? 0;
  const readyFiles = (exportsList.data ?? []).slice(0, 2);

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <header className="reveal flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1 className="font-display mt-2 text-4xl sm:text-5xl">
            {name ? "Good to see you, " + name + "." : "Your workspace"}
          </h1>
        </div>
        {/* With nothing saved yet, the empty list below offers this instead: one button, not two. */}
        {documents > 0 && (
          <Link href="/workspace/documents/new" className="btn btn-primary" data-testid="link-new-document">
            <FilePlus2 className="h-4 w-4" aria-hidden="true" /> New document
          </Link>
        )}
      </header>
      {ws.isSuccess && <CorrectionNotices />}

      {showStarterMap && (
        <section
          className="surface mt-8 p-6"
          aria-labelledby="home-orientation-title"
          data-testid="card-workspace-map"
        >
          <h2 id="home-orientation-title" className="eyebrow">
            How your workspace fits together
          </h2>
          <ol className="mt-4 grid gap-4 md:grid-cols-3">
            <li className="rounded-xl border border-border bg-sidebar/40 p-4">
              <p className="font-mono text-xs text-muted-foreground">Step 1</p>
              <p className="mt-1 font-medium">Set up your business profile</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Saves your business details once so you can pre-fill checks and documents.
              </p>
              <Link
                href="/workspace/profile"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
              >
                Set up profile <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
            <li className="rounded-xl border border-border bg-sidebar/40 p-4">
              <p className="font-mono text-xs text-muted-foreground">Step 2</p>
              <p className="mt-1 font-medium">Check your requirements</p>
              <p className="mt-1 text-sm text-muted-foreground">
                See which sourced rules may apply, save the result, and add due-dated tasks.
              </p>
              <Link
                href="/workspace/checker"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
              >
                Check requirements <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
            <li className="rounded-xl border border-border bg-sidebar/40 p-4">
              <p className="font-mono text-xs text-muted-foreground">Step 3</p>
              <p className="mt-1 font-medium">Make business documents</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Answer guided questions for invoices, receipts or agreements and download Word or PDF.
              </p>
              <Link
                href="/workspace/documents/new"
                className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary underline underline-offset-4"
              >
                New document <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            </li>
          </ol>
        </section>
      )}

      {ws.isLoading ? (
        <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <Skel className="h-60" />
          <Skel className="h-60" />
        </div>
      ) : ws.isError ? (
        <div className="mt-10">
          <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
        </div>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="grid h-fit gap-8">
            <section aria-labelledby="recent-documents-title">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 id="recent-documents-title" className="eyebrow">
                  Recent documents
                </h2>
                <span className="text-sm text-muted-foreground" data-testid="text-document-count">
                  {formatCount(documents)} saved
                </span>
              </div>
              <DocumentList enabled={ws.isSuccess} limit={3} />
              {documents > 0 && (
                <Link
                  href="/workspace/documents"
                  className="btn btn-ghost btn-sm mt-4"
                  data-testid="link-all-documents"
                >
                  All documents <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
              )}
            </section>

            {readyFiles.length > 0 && (
              <section aria-labelledby="home-ready-files-title" data-testid="card-ready-files">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 id="home-ready-files-title" className="eyebrow">
                    Files ready to download
                  </h2>
                  <span className="text-sm text-muted-foreground">
                    {formatCount(exportsList.data?.length ?? readyFiles.length)} ready
                  </span>
                </div>
                <ul className="grid gap-3">
                  {readyFiles.map((file) => (
                    <li
                      key={file.id}
                      className="surface flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="min-w-0">
                        <Link
                          href={"/workspace/documents/" + file.documentId}
                          className="block truncate font-medium hover:underline"
                        >
                          {file.documentTitle}
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {FILE_FORMAT_NAMES[file.format]} · version {file.revision} · ready{" "}
                          {formatDay(file.readyAt)}
                        </p>
                      </div>
                      <a href={file.downloadUrl} className="btn btn-ghost btn-sm">
                        <Download className="h-4 w-4" aria-hidden="true" /> Download{" "}
                        {FILE_FORMAT_NAMES[file.format]}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="grid h-fit gap-6">
            <section
              className="surface p-6"
              aria-labelledby="home-requirements-title"
              data-testid="card-requirements"
            >
              <h2 id="home-requirements-title" className="eyebrow">
                Requirements
              </h2>
              {latestResult ? (
                <div className="mt-3 grid gap-2 text-sm">
                  <p className="text-muted-foreground">
                    Last checked{" "}
                    <span className="font-medium text-foreground">{formatDay(latestResult.createdAt)}</span>
                  </p>
                  {latestCounts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {latestCounts.map(({ label, count }) => (
                        <span key={label} className={"pill " + RESULT_TONES[label]}>
                          {count} {label.toLowerCase()}
                        </span>
                      ))}
                    </div>
                  )}
                  {profileMovedAhead && (
                    <p
                      className="rounded-xl border border-[hsl(38_50%_82%)] bg-[hsl(var(--ochre-soft))] px-3 py-2 text-xs text-[hsl(38_60%_20%)]"
                      data-testid="status-profile-changed-since-check"
                    >
                      Your business profile changed since this saved result.{" "}
                      <Link
                        href="/workspace/checker?prefill=profile"
                        className="font-medium underline underline-offset-4"
                      >
                        Refresh with your profile
                      </Link>
                      .
                    </p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  See which requirements may apply to your business, and why.
                </p>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/workspace/checker"
                  className="btn btn-ghost btn-sm"
                  data-testid="link-home-checker"
                >
                  Check requirements <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href={latestResult ? "/workspace/assessments/" + latestResult.id : "/workspace/assessments"}
                  className="btn btn-ghost btn-sm"
                  data-testid="link-home-results"
                >
                  {latestResult ? "Latest result" : "Saved results"}
                </Link>
              </div>
            </section>

            <section className="surface p-6" aria-labelledby="home-tasks-title" data-testid="card-tasks">
              <div className="flex items-center justify-between gap-2">
                <h2 id="home-tasks-title" className="eyebrow">
                  Open tasks
                </h2>
                {openTasks.isSuccess && (
                  <span
                    className="font-mono text-xs text-muted-foreground"
                    data-testid="text-home-open-tasks"
                  >
                    {formatCount(openTaskCount)} open
                  </span>
                )}
              </div>
              {upcomingTasks.length > 0 ? (
                <ul className="mt-3 grid gap-2 text-sm">
                  {upcomingTasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-start justify-between gap-3 border-t border-border pt-2"
                    >
                      <span className="min-w-0 truncate font-medium">{task.title}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {task.dueDate ? formatDay(task.dueDate) : "No date"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 flex items-start gap-2.5 text-sm text-muted-foreground">
                  <ListTodo className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <p>No open tasks yet. Save dates from a requirements result or add your own.</p>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-2">
                <Link href="/workspace/tasks" className="btn btn-ghost btn-sm" data-testid="link-home-tasks">
                  View tasks <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link href="/workspace/reminders" className="btn btn-ghost btn-sm">
                  Reminders
                </Link>
              </div>
            </section>

            <section className="surface p-6" aria-labelledby="home-profile-title" data-testid="card-profile">
              <h2 id="home-profile-title" className="eyebrow">
                Business profile
              </h2>
              {profile ? (
                <>
                  <p className="font-display mt-4 text-2xl" data-testid="text-business-name">
                    {profile.businessName}
                  </p>
                  <dl className="mt-4 grid gap-2 text-sm">
                    <Row k="Legal form" v={profile.legalForm.replace(/_/g, " ")} />
                    <Row k="Registration" v={profile.registrationStatus} />
                    <Row
                      k="Location"
                      v={[profile.lga, profile.state].filter(Boolean).join(", ") || "Not given"}
                    />
                    <Row k="Activities" v={formatCount(profile.activities.length)} />
                  </dl>
                </>
              ) : (
                <div className="mt-4">
                  <UserRound className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    No business profile yet. It fills in the requirements check for you. Every question
                    accepts "unknown".
                  </p>
                </div>
              )}
              <Link
                href="/workspace/profile"
                className="btn btn-ghost btn-sm mt-6 w-full"
                data-testid="link-edit-profile"
              >
                {profile ? "Edit profile" : "Set up profile"}{" "}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4 border-t border-border pt-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="text-right capitalize">{v}</dd>
    </div>
  );
}
