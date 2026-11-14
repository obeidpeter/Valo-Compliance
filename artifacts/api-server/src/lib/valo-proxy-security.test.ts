import assert from "node:assert/strict";
import test from "node:test";
test("real development proxy cannot establish trusted identity from forwarding headers",{
  skip:process.env.VALO_RUN_HTTP_TESTS!=="synthetic-development-only",
},async t=>{
  assert.equal(process.env.NODE_ENV,"development");
  assert.ok(process.env.REPLIT_DEV_DOMAIN);
  const origin=`https://${process.env.REPLIT_DEV_DOMAIN}`;
  const internal=process.env.VALO_INTERNAL_SECURITY_TEST_URL;
  if(internal)assert.match(internal,/^http:\/\/127\.0\.0\.1:\d+$/,"Direct checks must stay on the local development server");
  const hostile="https://hostile.synthetic.invalid";
  const cases=[
    {label:"matching hostile host and protocol",origin:hostile,headers:{"x-forwarded-host":"hostile.synthetic.invalid","x-forwarded-proto":"https"}},
    {label:"multi-hop hostile host first",origin:hostile,headers:{"x-forwarded-host":`hostile.synthetic.invalid, ${process.env.REPLIT_DEV_DOMAIN}`,"x-forwarded-proto":"https, http"}},
    {label:"multi-hop trusted host first",origin:hostile,headers:{"x-forwarded-host":`${process.env.REPLIT_DEV_DOMAIN}, hostile.synthetic.invalid`,"x-forwarded-proto":"http, https"}},
    {label:"wrong scheme despite matching forwarded protocol",origin:origin.replace("https:","http:"),headers:{"x-forwarded-proto":"http"}},
    {label:"wrong port",origin:`${origin}:8443`,headers:{"x-forwarded-host":`${process.env.REPLIT_DEV_DOMAIN}:8443`}},
    {label:"RFC Forwarded cannot redefine site",origin:hostile,headers:{"forwarded":'host=hostile.synthetic.invalid;proto=https'}},
    {label:"multiple Origin values",origin:`${origin}, ${hostile}`,headers:{}},
  ];
  for(const base of[origin,...(internal?[internal]:[])])for(const c of cases)await t.test(`${base===origin?"real proxy":"direct backend"}: ${c.label}`,async()=>{
    const r=await fetch(`${base}/api/workspace/documents`,{method:"POST",headers:{"Content-Type":"application/json",Origin:c.origin,...c.headers},body:"{}"});
    assert.equal(r.status,403);assert.equal(((await r.json()) as {code:string}).code,"UNTRUSTED_ORIGIN");
  });
  for(const base of[origin,...(internal?[internal]:[])])await t.test(`${base===origin?"real proxy":"direct backend"}: legitimate origin reaches authentication even with spoofed forwarding headers`,async()=>{
    const r=await fetch(`${base}/api/workspace/documents`,{method:"POST",headers:{"Content-Type":"application/json",Origin:origin,
      "x-forwarded-host":"hostile.synthetic.invalid, another.invalid","x-forwarded-proto":"http, https"},body:"{}"});
    assert.equal(r.status,401,"Forwarding headers must neither grant identity nor deny the configured legitimate origin");
  });
});
