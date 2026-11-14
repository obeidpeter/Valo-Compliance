/** Page numbers refer to retained extracted PDF pages, not a search title.
 * Unknown locator syntaxes stay held instead of becoming arbitrary labels. */
export function claimLocatorMatches(text:string,quote:string,locator:string){
  const compact=(s:string)=>s.replace(/\s+/g," ").trim().toLowerCase();
  if(!quote.trim()||!compact(text).includes(compact(quote)))return false;
  const page=locator.match(/\b(?:pdf|pages?|p\.)\s*(\d+)(?:\s*[-–]\s*(\d+))?/i);
  if(page){
    const parts=text.split("\f"),from=Number(page[1]),to=Number(page[2]??page[1]);
    if(from<1||to<from||to>parts.length)return false;
    if(!compact(parts.slice(from-1,to).join("\n")).includes(compact(quote)))return false;
  }
  const section=locator.match(/\b(?:sections?|ss?\.?)\s*(\d+[a-z]?)/i);
  if(section){
    const n=section[1]!.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    if(!new RegExp(`(?:\\bsection\\s+${n}\\b|(?:^|\\n)\\s*${n}\\s*[.(])`,"i").test(text))return false;
  }
  if(page||section)return true;
  const heading=locator.replace(/^(?:heading|passage|paragraph)\s*:\s*/i,"").trim();
  return heading.length>=12&&compact(text).includes(compact(heading));
}
