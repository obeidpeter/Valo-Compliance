export function dependencySummary(input:unknown){
  const raw=input as {metadata?:{vulnerabilities?:Record<string,number>};advisories?:Record<string,{id?:number;module_name?:string;severity?:string;github_advisory_id?:string}>};
  if(!raw.metadata?.vulnerabilities)throw Error("DEPENDENCY_AUDIT_UNAVAILABLE");
  const counts=Object.fromEntries(["critical","high","moderate","low","info"].map(k=>[k,Number(raw.metadata!.vulnerabilities![k]??0)]));
  const findings=Object.values(raw.advisories??{}).map(a=>({id:a.github_advisory_id??String(a.id),
    package:String(a.module_name??"unknown").replace(/[^a-zA-Z0-9@/_.-]/g,"").slice(0,120),severity:a.severity}));
  return{status:counts.critical!+counts.high!>0?"blocked":"pass",counts,findings};
}
export function secretSummary(input:unknown){
  if(!Array.isArray(input))throw Error("SECRET_SCAN_UNAVAILABLE");
  return{status:input.length?"blocked":"pass",count:input.length,
    findings:input.map(r=>({rule:String(r.RuleID).slice(0,100),file:String(r.File).slice(0,300),
      line:Number(r.StartLine),commit:/^[a-f0-9]{40}$/.test(r.Commit)?r.Commit:undefined}))};
}
