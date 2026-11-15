import {Link} from 'wouter';
import {useQueryClient} from '@tanstack/react-query';
import {Bookmark,BookmarkCheck,Trash2} from 'lucide-react';
import {useListSavedTemplates,useSaveReleasedTemplate,useUnsaveTemplate,getListSavedTemplatesQueryKey} from '@workspace/api-client-react';
import {ErrorState,EmptyState,Skel} from '@/components/states';
import {describeError} from '@/lib/api';

export function SaveTemplateButton({releaseId,templateId}:{releaseId:string;templateId:string}){
  const cache=useQueryClient(),list=useListSavedTemplates({query:{refetchOnWindowFocus:true}});
  const save=useSaveReleasedTemplate(),remove=useUnsaveTemplate();
  const saved=list.data?.items.some(i=>i.templateId===templateId)??false;
  const pending=save.isPending||remove.isPending;
  const refresh=()=>cache.invalidateQueries({queryKey:getListSavedTemplatesQueryKey()});
  return <div>
    <button className="btn btn-ghost w-full" aria-pressed={saved} disabled={pending||!list.isSuccess}
      onClick={()=>saved?remove.mutate({templateId},{onSuccess:refresh}):save.mutate({id:releaseId},{onSuccess:refresh})}
      data-testid="button-save-template">{saved?<BookmarkCheck className="h-4 w-4"/>:<Bookmark className="h-4 w-4"/>}
      {pending?'Saving…':saved?'Saved — remove':'Save template'}</button>
    {(save.error||remove.error)&&<p role="alert" className="mt-2 text-sm text-destructive">{describeError(save.error??remove.error).message}</p>}
    {list.isError&&<ErrorState error={list.error} onRetry={()=>list.refetch()}/>}
  </div>;
}

export function SavedTemplates(){
  const cache=useQueryClient(),list=useListSavedTemplates({query:{refetchOnWindowFocus:true,refetchInterval:15000}});
  const remove=useUnsaveTemplate({mutation:{onSuccess:()=>cache.invalidateQueries({queryKey:getListSavedTemplatesQueryKey()})}});
  if(list.isLoading)return <Skel className="h-36"/>;
  if(list.isError)return <ErrorState error={list.error} onRetry={()=>list.refetch()}/>;
  return <section className="mt-10" aria-labelledby="saved-heading">
    <div className="flex items-center justify-between gap-3"><h2 id="saved-heading" className="font-display text-2xl">Saved templates</h2><Link href="/library?type=template" className="btn btn-ghost btn-sm">Browse templates</Link></div>
    {list.data?.items.length?<ul className="mt-4 grid gap-3 sm:grid-cols-2">
      {list.data.items.map(item=><li className="surface p-5" key={item.templateId} data-testid={'saved-'+item.templateId}>
        {item.current?<Link href={item.current.href??'/library/'+encodeURIComponent(item.current.slug)} className="font-medium underline underline-offset-4">{item.title}</Link>:<p className="font-medium">{item.title}</p>}
        <p className="mt-2 text-sm text-muted-foreground">{item.available?'Open to see the current released version. Saving does not include a purchase.':'Currently unavailable. The template may have been withdrawn or removed. Your existing drafts are unchanged.'}</p>
        <button className="btn btn-ghost btn-sm mt-3" disabled={remove.isPending} onClick={()=>remove.mutate({templateId:item.templateId})}><Trash2 className="h-4 w-4"/>Remove saved item</button>
      </li>)}
    </ul>:<div className="mt-4"><EmptyState title="Keep useful templates here">Open a released template and choose Save template. Saved items stay with your account across devices.</EmptyState></div>}
    {remove.error&&<p role="alert" className="mt-3 text-sm text-destructive">{describeError(remove.error).message}</p>}
    {!!list.data?.recommendations.length&&<section className="mt-8" aria-labelledby="recommended-heading">
      <h3 id="recommended-heading" className="eyebrow">Templates you may find useful</h3><p className="mt-2 text-sm text-muted-foreground">{list.data.notice}</p>
      <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{list.data.recommendations.map(item=><li key={item.id}><Link href={item.href??'/library/'+encodeURIComponent(item.slug)} className="surface block p-5"><p className="font-medium">{item.title}</p><p className="mt-2 text-sm text-muted-foreground">{item.reason}</p></Link></li>)}</ul>
    </section>}
  </section>;
}
