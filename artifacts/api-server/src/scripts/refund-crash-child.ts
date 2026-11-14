import {processRefund} from "../lib/valo-refunds";
if(process.env.NODE_ENV!=="development"||process.env.VALO_RUN_REFUND_TESTS!=="synthetic-development-only"||!process.send)
  throw Error("OWNED_SYNTHETIC_PROCESS_HARNESS_REQUIRED");
await processRefund(process.argv[2],{
  configured:()=>true,
  async find(){process.send!({stage:"refund_lookup_after_durable_claim"});return new Promise(()=>{});},
  async create(){throw Error("CRASH_HARNESS_CANNOT_CREATE");},
});
