import {dispatchDisputeIntent} from "./valo-dispute-workflow";
import {makeDisputeTransport} from "./valo-dispute-provider";
if(process.env.NODE_ENV!=="development"||process.env.REPLIT_DEPLOYMENT||process.env.VALO_RUN_DISPUTE_TESTS!=="synthetic-development-only"||process.env.PAYSTACK_SECRET_KEY||!process.send)throw Error("CONTROLLED_CHILD_REQUIRED");
const input=JSON.parse(process.env.VALO_DISPUTE_CRASH!);
const provider=makeDisputeTransport(async(_path,_body,method)=>{
 if(!method||method==="GET")return input.canonical;
 // The controlled provider has applied its mutation, but the parent kills this
 // actual dispatch process before an acknowledgement can be committed.
 process.send!({stage:"controlled-provider-applied"});await new Promise<void>(()=>{});
},async()=>{throw Error("UNEXPECTED_UPLOAD");},()=>true);
await dispatchDisputeIntent(input.actor,input.id,input.intentId,input.expectedVersion,provider);
throw Error("CRASH_BARRIER_WAS_NOT_REACHED");
