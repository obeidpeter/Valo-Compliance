import {execFile} from "node:child_process";
import {promisify} from "node:util";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {createHash} from "node:crypto";
const exec=promisify(execFile);
export const historicalDigestFindings=[
  {commit:"e29bacedc806e51831d5508225995d6c2fffa0be",evidence:"docs/valo/evidence/workspace-export-development.json",
    line:95,source:"artifacts/api-server/src/lib/valo-customer-access.ts"},
  {commit:"32834e72411fa3bfc8e39cf44aacd0c6685f7064",evidence:"docs/valo/evidence/dispute-actions-development.json",
    line:60,source:"artifacts/api-server/src/routes/valo-customer-access.ts"},
  {commit:"6059bb30d085e0ea904599fc7902235ef0da084b",evidence:"docs/valo/evidence/dispute-actions-development.json",
    line:60,source:"artifacts/api-server/src/routes/valo-customer-access.ts"},
] as const;
export function exactDigestField(line:string,source:string,digest:string){
  const match=line.match(/^\s*"([^"]+)"\s*:\s*"([a-f0-9]{64})"\s*,?\s*$/);
  return !!match&&match[1]===source&&match[2]===digest;
}
/** Immutable finding fingerprints only. No general rule/path allowlist and no
 * raw secret or original candidate value is returned, including on failure. */
export async function verifyHistoricalDigestDispositions(root:string){
  const ignored=(await readFile(join(root,".gitleaksignore"),"utf8")).split(/\r?\n/);
  for(const finding of historicalDigestFindings){
    const fingerprint=`${finding.commit}:${finding.evidence}:generic-api-key:${finding.line}`;
    if(!ignored.includes(fingerprint))throw Error("EXACT_HISTORICAL_DISPOSITION_MISSING");
    const options={cwd:root,maxBuffer:4_000_000};
    const report=await exec("git",["show",`${finding.commit}:${finding.evidence}`],options);
    const source=await exec("git",["show",`${finding.commit}:${finding.source}`],options);
    const digest=createHash("sha256").update(source.stdout).digest("hex");
    if(!exactDigestField(report.stdout.split("\n")[finding.line-1]??"",finding.source,digest))
      throw Error("HISTORICAL_DIGEST_BINDING_FAILED");
  }
  return{exactHistoricalSourceDigestsVerified:historicalDigestFindings.length,generalRuleExemption:false,futureCommitExemption:false};
}
