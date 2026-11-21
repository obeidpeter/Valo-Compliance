import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { ArrowRight, Sparkles, FilePlus2, Loader2, UserRound } from "lucide-react";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { ErrorState, Skel } from "@/components/states";
import { describeError } from "@/lib/api";
import { useNewDocument } from "@/lib/use-new-document";
import { CorrectionNotices } from "@/components/correction-notices";
import { DocumentList } from "@/components/document-list";
import { GuidedDraftStarter } from "@/components/guided-draft-starter";

export default function WorkspaceHome() {
  const { user } = useUser();
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });
  const create = useNewDocument();

  const name = user?.firstName;
  const profile = ws.data?.profile ?? null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <GuidedDraftStarter />
      {ws.isSuccess && <CorrectionNotices />}
      <header className="reveal flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1 className="font-display mt-2 text-4xl sm:text-5xl">
            {name ? "Good to see you, " + name + "." : "Your workspace"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/workspace/ai" className="btn btn-ink" data-testid="link-ai-drafting">
            <Sparkles className="h-4 w-4" /> Prepare invoice or quotation
          </Link>
          <button
            className="btn btn-primary"
            onClick={create.start}
            disabled={create.pending || !ws.isSuccess}
            data-testid="button-new-draft"
          >
            {create.pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FilePlus2 className="h-4 w-4" />
            )}{" "}
            New blank draft
          </button>
        </div>
      </header>
      {create.error && (
        <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {describeError(create.error).message}
        </p>
      )}

      {ws.isLoading ? (
        <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Skel className="h-60" />
          <Skel className="h-60" />
        </div>
      ) : ws.isError ? (
        <div className="mt-10">
          <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
        </div>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_2fr]">
          <aside className="surface h-fit p-6" data-testid="card-profile">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Business profile</p>
              <span className="font-mono text-xs text-muted-foreground">
                rev {ws.data?.profileRevision ?? 0}
              </span>
            </div>
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
                  <Row k="Activities" v={String(profile.activities.length)} />
                </dl>
              </>
            ) : (
              <div className="mt-4">
                <UserRound className="h-6 w-6 text-muted-foreground" />
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  No profile yet. It helps keep your drafts consistent. Every question accepts "unknown".
                </p>
              </div>
            )}
            <Link
              href="/workspace/profile"
              className="btn btn-ghost btn-sm mt-6 w-full"
              data-testid="link-edit-profile"
            >
              {profile ? "Edit profile" : "Set up profile"} <ArrowRight className="h-4 w-4" />
            </Link>
          </aside>

          <section>
            <div className="mb-4 flex items-center justify-between">
              <p className="eyebrow">Business drafts</p>
              <span className="text-sm text-muted-foreground">{ws.data?.documentCount ?? 0} total</span>
            </div>
            <DocumentList enabled={ws.isSuccess} limit={3} onNew={create.start} creating={create.pending} />
            <Link
              href="/workspace/documents"
              className="btn btn-ghost btn-sm mt-4"
              data-testid="link-all-documents"
            >
              All documents <ArrowRight className="h-4 w-4" />
            </Link>
          </section>
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
