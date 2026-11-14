import {useState} from 'react';
import {useLocation} from 'wouter';
import {useQueryClient} from '@tanstack/react-query';
import {useCreateDocument,getGetWorkspaceQueryKey,getListDocumentsQueryKey} from '@workspace/api-client-react';
import {GUIDED_TEMPLATE_IDS,type GuidedTemplateId} from '@workspace/valo-core/guided';
import {GUIDED_SPECS_V1} from '@workspace/valo-core/guided-specs';
import {emptyGuidedData,compileGuidedContent} from '@workspace/valo-core/guided-runtime';
import {describeError} from '@/lib/api';

export function GuidedDraftStarter(){
  const[id,setId]=useState<GuidedTemplateId>('TPL-01');
  const create=useCreateDocument(),qc=useQueryClient(),[,navigate]=useLocation();
  function start(){
    create.mutate({data:{title:`${GUIDED_SPECS_V1[id].title} — private business draft`,
      content:compileGuidedContent(emptyGuidedData(id))}},{
      onSuccess:doc=>{
        qc.invalidateQueries({queryKey:getGetWorkspaceQueryKey()});
        qc.invalidateQueries({queryKey:getListDocumentsQueryKey()});
        navigate('/workspace/documents/'+doc.id);
      },
    });
  }
  return <section className="surface my-7 p-5 sm:p-7" aria-labelledby="guided-start-title" data-testid="guided-draft-starter">
    <h2 id="guided-start-title" className="font-display text-2xl">Prepare a structured private draft</h2>
    <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground">
      Answer document-specific questions using your own facts and terms. This does not include a released Valo catalogue master,
      independent legal review, verified payment or a signature. Published-template access is separate.
    </p>
    <div className="mt-5 flex flex-wrap items-end gap-3">
      <div className="min-w-0 flex-1">
        <label className="label" htmlFor="guided-document-kind">Document questions</label>
        <select id="guided-document-kind" className="field" value={id} onChange={e=>setId(e.target.value as GuidedTemplateId)}
          disabled={create.isPending} data-testid="select-guided-template">
          {GUIDED_TEMPLATE_IDS.map(id=><option value={id} key={id}>{GUIDED_SPECS_V1[id].title}</option>)}
        </select>
      </div>
      <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={start}
        data-testid="button-start-guided">{create.isPending?'Saving private draft…':'Start with questions'}</button>
    </div>
    {create.isError&&<p role="alert" className="mt-3 text-sm text-destructive">{describeError(create.error).message}</p>}
  </section>;
}
