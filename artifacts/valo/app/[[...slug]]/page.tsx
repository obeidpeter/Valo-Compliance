import ClientApp from '@/client-app';
import type { Metadata } from 'next';
import {metadataOrigin,publicPages,fetchPublicMetadata} from '@/lib/public-metadata';

export async function generateMetadata({params}:{params:Promise<{slug?:string[]}>}):Promise<Metadata>{
  const {slug=[]}=await params;
  const path='/'+slug.map(encodeURIComponent).join('/'),origin=metadataOrigin();
  const fixed=publicPages[path];
  const detail=!fixed&&slug.length===2&&['library','resources','industries'].includes(slug[0]!)&&origin?
    (await fetchPublicMetadata(origin)).find(item=>item.path===path):undefined;
  const item=fixed??detail;
  if(!item)return{title:'Page unavailable or private — Valo',robots:{index:false,follow:false}};
  return{title:item.title.endsWith('Valo')?item.title:item.title+' — Valo',description:item.description,
    alternates:origin?{canonical:origin+path}:undefined,
    // Public launch is not approved. Preserve the existing no-index boundary.
    robots:{index:false,follow:false}};
}

export default function Page() {
  return <ClientApp />;
}
