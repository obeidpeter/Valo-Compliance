/** Two immutable historical findings were independently verified against their
 * referenced source file bytes: these are SHA-256 source-binding values, not
 * credentials. Do not generalise this to hashes, evidence paths or future rows. */
const approved=new Set([
 "32834e72411fa3bfc8e39cf44aacd0c6685f7064",
 "6059bb30d085e0ea904599fc7902235ef0da084b",
]);
export function withoutVerifiedSourceHashFindings(input:unknown){
 if(!Array.isArray(input))throw Error("SECRET_SCAN_UNAVAILABLE");
 return input.filter(r=>!(r&&r.RuleID==="generic-api-key"&&r.File==="docs/valo/evidence/dispute-actions-development.json"&&
   r.StartLine===60&&r.EndLine===60&&approved.has(r.Commit)));
}
