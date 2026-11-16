import type {MetadataRoute} from 'next';
import {metadataOrigin,publicPages,fetchPublicMetadata} from '@/lib/public-metadata';
export const dynamic='force-dynamic';
export default async function sitemap():Promise<MetadataRoute.Sitemap>{
  const origin=metadataOrigin();if(!origin)return[];
  const entries=await fetchPublicMetadata(origin);
  return[...Object.keys(publicPages).map(path=>({url:origin+path})),...entries.map(item=>({url:origin+item.path,
    ...(item.modifiedAt?{lastModified:new Date(item.modifiedAt)}:{})}))];
}
