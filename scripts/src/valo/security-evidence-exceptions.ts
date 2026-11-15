/** Three immutable historical findings were independently verified against their
 * referenced source file bytes: these are SHA-256 source-binding values, not
 * credentials. Do not generalise this to hashes, evidence paths or future rows. */
const approved=[
 {Commit:"32834e72411fa3bfc8e39cf44aacd0c6685f7064",File:"docs/valo/evidence/dispute-actions-development.json",line:60},
 {Commit:"6059bb30d085e0ea904599fc7902235ef0da084b",File:"docs/valo/evidence/dispute-actions-development.json",line:60},
 {Commit:"e29bacedc806e51831d5508225995d6c2fffa0be",File:"docs/valo/evidence/workspace-export-development.json",line:95},
];
export function withoutVerifiedSourceHashFindings(input:unknown){
 if(!Array.isArray(input))throw Error("SECRET_SCAN_UNAVAILABLE");
 return input.filter(r=>!(r&&r.RuleID==="generic-api-key"&&approved.some(a=>
   r.File===a.File&&r.StartLine===a.line&&r.EndLine===a.line&&r.Commit===a.Commit)));
}
