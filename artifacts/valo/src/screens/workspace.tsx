import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Sparkles, FilePlus2, FileText, Loader2, UserRound } from 'lucide-react';
import { useCreateDocument, useGetWorkspace, useListDocuments, getGetWorkspaceQueryKey, getListDocumentsQueryKey } from '@workspace/api-client-react';
import { WorkspaceNav } from '@/components/workspace-nav';
import { EmptyState, ErrorState, Notice, Skel } from '@/components/states';
import { blankContent, describeError, formatDate, missingFields } from '@/lib/api';
import {GuidedDraftStarter} from '@/components/guided-draft-starter';
import {SavedTemplates} from '@/components/saved-templates';

export default function WorkspaceHome() {
  const { user } = useUser();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const ws = useGetWorkspace({ query: { enabled: true, queryKey: getGetWorkspaceQueryKey() } });
  const docs = useListDocuments({ query: { enabled: ws.isSuccess, queryKey: getListDocumentsQueryKey() } });
  const create = useCreateDocument();

  function newDraft() {
    create.mutate({ data: { title: 'Untitled business draft', content: blankContent() } }, {
      onSuccess: (doc) => {
        qc.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        qc.invalidateQueries({ queryKey: getGetWorkspaceQueryKey() });
        setLocation('/workspace/documents/' + doc.id);
      },
    });
  }

  const name = user?.firstName;
  const profile = ws.data?.profile ?? null;

  return (
    <div className="mx-auto max-w-7xl px-5 py-12 lg:px-8">
      <WorkspaceNav />
      <GuidedDraftStarter/>
      <header className="reveal flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1 className="font-display mt-2 text-4xl sm:text-5xl">{name ? 'Good to see you, ' + name + '.' : 'Your workspace'}</h1>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/workspace/ai" className="btn btn-ink" data-testid="link-ai-drafting"><Sparkles className="h-4 w-4" /> Prepare invoice or quotation</Link>
        <button className="btn btn-primary" onClick={newDraft} disabled={create.isPending || !ws.isSuccess} data-testid="button-new-draft">
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />} New blank draft
        </button></div>
      </header>
      {create.error && <p role="alert" className="mt-4 rounded-xl bg-destructive/10 px-4 py-3 text-sm text-destructive">{describeError(create.error).message}</p>}

      {ws.isLoading ? (
        <div className="mt-10 grid gap-4 lg:grid-cols-[1fr_2fr]"><Skel className="h-60" /><Skel className="h-60" /></div>
      ) : ws.isError ? (
        <div className="mt-10"><ErrorState error={ws.error} onRetry={() => ws.refetch()} /></div>
      ) : (
        <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_2fr]">
          <aside className="surface h-fit p-6" data-testid="card-profile">
            <div className="flex items-center justify-between"><p className="eyebrow">Business profile</p><span className="font-mono text-xs text-muted-foreground">rev {ws.data?.profileRevision ?? 0}</span></div>
            {profile ? (
              <>
                <p className="font-display mt-4 text-2xl" data-testid="text-business-name">{profile.businessName}</p>
                <dl className="mt-4 grid gap-2 text-sm">
                  <Row k="Legal form" v={profile.legalForm.replace(/_/g, ' ')} />
                  <Row k="Registration" v={profile.registrationStatus} />
                  <Row k="Location" v={[profile.lga, profile.state].filter(Boolean).join(', ') || 'Not given'} />
                  <Row k="Activities" v={String(profile.activities.length)} />
                </dl>
              </>
            ) : (
              <div className="mt-4"><UserRound className="h-6 w-6 text-muted-foreground" /><p className="mt-3 text-sm leading-relaxed text-muted-foreground">No profile yet. It helps keep your drafts consistent. Every question accepts "unknown".</p></div>
            )}
            <Link href="/workspace/profile" className="btn btn-ghost btn-sm mt-6 w-full" data-testid="link-edit-profile">{profile ? 'Edit profile' : 'Set up profile'} <ArrowRight className="h-4 w-4" /></Link>
          </aside>

          <section>
            <div className="mb-4 flex items-center justify-between"><p className="eyebrow">Business drafts</p><span className="text-sm text-muted-foreground">{ws.data?.documentCount ?? 0} total</span></div>
            {docs.isLoading ? <div className="grid gap-3">{[0, 1].map((i) => <Skel key={i} className="h-24" />)}</div> : docs.isError ? <ErrorState error={docs.error} onRetry={() => docs.refetch()} /> : docs.data && docs.data.length > 0 ? (
              <ul className="grid gap-3">
                {docs.data.map((d) => {
                  const miss = missingFields(d.content).length;
                  return (
                    <li key={d.id}>
                      <Link href={'/workspace/documents/' + d.id} className="surface group flex items-center gap-5 p-5 transition-shadow hover:shadow-[var(--shadow-md)]" data-testid={'link-doc-' + d.id}>
                        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent text-primary"><FileText className="h-5 w-5" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{d.title}</span>
                          <span className="mt-1 flex flex-wrap gap-x-3 text-xs text-muted-foreground"><span>Business draft</span><span className="font-mono">rev {d.revision}</span><span>{formatDate(d.updatedAt)}</span></span>
                        </span>
                        {miss > 0 && <span className="pill pill-ochre hidden sm:inline-flex">{miss} missing</span>}
                        <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState mark={<FilePlus2 className="h-5 w-5 text-muted-foreground" />} title="No drafts yet" action={<button className="btn btn-primary" onClick={newDraft} disabled={create.isPending}>Start a blank draft</button>}>
                A new draft starts empty. Choose a released template from the library when one fits, or write your own document.
              </EmptyState>
            )}
            <Notice className="mt-4" tone="ink" title="Development workspace">Use synthetic test details only. Open a saved draft to request private, visibly marked DOCX or PDF exports. Production recovery and release approval remain unproved.</Notice>
          </section>
        </div>
      )}
      {ws.isSuccess&&<SavedTemplates/>}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-4 border-t border-border pt-2"><dt className="text-muted-foreground">{k}</dt><dd className="text-right capitalize">{v}</dd></div>;
}
