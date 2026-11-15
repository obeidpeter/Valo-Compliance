import {productionPreflight} from "../lib/valo-production-readiness";
const args=process.argv.slice(2);
if(args.length>1||args.length===1&&args[0]!=="--configuration-only"){
  console.error("USAGE: production-preflight [--configuration-only]");process.exitCode=1;
}else{
  const report=productionPreflight(process.env);console.log(JSON.stringify(report,null,2));
  // Default invocation remains nonzero while launch evidence/approval is absent.
  process.exitCode=report.configurationValid?(args[0]==="--configuration-only"?0:2):1;
}
