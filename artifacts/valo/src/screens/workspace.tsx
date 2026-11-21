import { Link } from "wouter";
import { useUser } from "@clerk/react";
import { ArrowRight, FilePlus2, UserRound } from "lucide-react";
import { useGetWorkspace, getGetWorkspaceQueryKey } from "@workspace/api-client-react";
import { WorkspaceNav } from "@/components/workspace-nav";
import { ErrorState, Skel } from "@/components/states";
import { CorrectionNotices } from "@/components/correction-notices";
import { DocumentList } from "@/components/document-list";
import { formatCount } from "@/lib/format";

/**
 * The workspace's home. The greeting comes first, with the one button that starts a document. Then
 * anything that needs a look, the documents last worked on, and the way into the requirements check
 * and the business profile.
 */
export default function WorkspaceHome() {
  const { user } = useUser();
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });

  const name = user?.firstName;
  const profile = ws.data?.profile ?? null;
  const documents = ws.data?.documentCount ?? 0;

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
            <FilePlus2 className="h-4 w-4" /> New document
          </Link>
        )}
      </header>
      {ws.isSuccess && <CorrectionNotices />}

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
                All documents <ArrowRight className="h-4 w-4" />
              </Link>
            )}
          </section>

          <div className="grid h-fit gap-6">
            <section
              className="surface p-6"
              aria-labelledby="home-requirements-title"
              data-testid="card-requirements"
            >
              <h2 id="home-requirements-title" className="eyebrow">
                Requirements
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                See which requirements may apply to your business, and why.
              </p>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/workspace/checker"
                  className="btn btn-ghost btn-sm"
                  data-testid="link-home-checker"
                >
                  Check requirements <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  href="/workspace/assessments"
                  className="btn btn-ghost btn-sm"
                  data-testid="link-home-results"
                >
                  Saved results
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
                  <UserRound className="h-6 w-6 text-muted-foreground" />
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
                {profile ? "Edit profile" : "Set up profile"} <ArrowRight className="h-4 w-4" />
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
