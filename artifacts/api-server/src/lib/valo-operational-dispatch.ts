/** Independent durable domains must not block each other when one fails. */
export async function dispatchOperationalJobs(jobs:Record<string,()=>Promise<unknown>>){
  const entries=Object.entries(jobs);
  const results=await Promise.allSettled(entries.map(([,run])=>Promise.resolve().then(run)));
  return results.flatMap((result,index)=>result.status==="rejected"?[entries[index]![0]]:[]);
}
