export type ReleasedLibraryItem={id:string;slug:string;title:string;type:string;industry:string;summary:string};
/** Input must be the current eligible release selection, not the research inventory. */
export function paginateReleasedItems(released:ReleasedLibraryItem[],query:{q?:string;type?:string;industry?:string;page?:number}={}){
  const q=query.q?.trim().toLowerCase()??"";
  const items=released.filter(i=>(!q||`${i.title} ${i.summary}`.toLowerCase().includes(q))&&
    (!query.type||query.type==="all"||query.type===i.type)&&
    (!query.industry||query.industry==="all"||i.industry==="All industries"||i.industry.split(",").includes(query.industry)));
  const page=query.page??1;
  return{items:items.slice((page-1)*20,page*20),total:items.length,page,heldTemplates:Math.max(0,40-released.length)};
}
