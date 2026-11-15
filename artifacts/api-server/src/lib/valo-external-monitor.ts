import {workerReadiness,type WorkerHeartbeat} from "./valo-worker-health";

type Environment=Record<string,string|undefined>;
export type MonitorCheck="worker"|"operations";
export type MonitorConfiguration=Readonly<Record<MonitorCheck,string>>;
const uuid="[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
function invalid():never{throw Error("EXTERNAL_MONITOR_CONFIGURATION_INVALID");}
/** Ping URLs are capabilities. Never include them in logs, reports, or client config. */
export function externalMonitorConfiguration(env:Environment=process.env):MonitorConfiguration|null{
  const worker=env.VALO_WORKER_MONITOR_URL,operations=env.VALO_OPERATIONS_MONITOR_URL;
  if(!env.VALO_EXTERNAL_MONITORING&&!worker&&!operations)return null;
  if(env.VALO_EXTERNAL_MONITORING!=="healthchecks")invalid();
  const checked=(raw:string|undefined)=>{
    if(!raw||raw.trim()!==raw)invalid();
    let url:URL;try{url=new URL(raw);}catch{invalid();}
    if(url.protocol!=="https:"||url.hostname!=="hc-ping.com"||url.port||url.username||url.password||url.search||url.hash||
      !new RegExp(`^/${uuid}$`).test(url.pathname)||url.href!==raw)invalid();
    return raw;
  };
  const result={worker:checked(worker),operations:checked(operations)};
  if(result.worker===result.operations)invalid();
  return Object.freeze(result);
}
type Transport=typeof fetch;
/** No customer data, operational counts, raw errors or request body leave the process. */
export async function pingExternalMonitor(config:MonitorConfiguration,check:MonitorCheck,healthy:boolean,
  transport:Transport=fetch,signal?:AbortSignal):Promise<boolean>{
  const timeout=AbortSignal.timeout(5000);
  try{
    const response=await transport(config[check]+(healthy?"":"/fail"),{
      method:"POST",redirect:"manual",signal:signal?AbortSignal.any([signal,timeout]):timeout,
    });
    await response.body?.cancel();return response.status===200;
  }catch{return false;}
}

/** Runs in the supervisor. Missed pings are detected outside the application host. */
export class ExternalMonitor{
  private health:WorkerHeartbeat|null=null;
  private operations:{healthy:boolean;at:number}|null=null;
  private timer:ReturnType<typeof setInterval>|undefined;
  private stopping=false;
  private inFlight:Promise<void>|undefined;
  private abort=new AbortController();
  constructor(private config:MonitorConfiguration|null,private report:(event:{event:string;check:MonitorCheck})=>void,
    private transport:Transport=fetch,private now=Date.now){}
  observeWorker(value:WorkerHeartbeat|null){
    this.health=value;
    // A failed operational probe also fails worker health. Do not reuse an older
    // green sample when the next ordinary dispatch recovers before the next probe.
    if(workerReadiness(value,this.now())!=="healthy")this.operations=null;
  }
  observeOperations(value:{healthy:boolean;checkedAt:string}){
    const at=Date.parse(value.checkedAt),age=this.now()-at;
    if(typeof value.healthy!=="boolean"||!Number.isFinite(age)||age<0||age>120_000){this.operations=null;return;}
    this.operations={healthy:value.healthy,at};
  }
  start(){if(this.timer||!this.config||this.stopping)return;
    this.timer=setInterval(()=>{void this.tick();},30_000);
  }
  async tick(){
    if(!this.config||this.stopping||this.inFlight)return;
    const worker=workerReadiness(this.health,this.now())==="healthy";
    const age=this.operations?this.now()-this.operations.at:Infinity;
    const operations=worker&&this.operations?.healthy===true&&age>=0&&age<=120_000;
    this.inFlight=Promise.all((["worker","operations"]as const).map(async check=>{
      const acknowledged=await pingExternalMonitor(this.config!,check,check==="worker"?worker:operations,this.transport,this.abort.signal);
      if(!this.stopping)this.report({event:acknowledged?"external_monitor.acknowledged":"external_monitor.delivery_failed",check});
    })).then(()=>{});
    try{await this.inFlight;}finally{this.inFlight=undefined;}
  }
  async stop(){this.stopping=true;clearInterval(this.timer);this.abort.abort();await this.inFlight;}
}
