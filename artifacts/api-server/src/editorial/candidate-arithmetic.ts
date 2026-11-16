import {sha256,type PublicationBundle} from "@workspace/valo-core";
/** Extract the candidate's own relationship. No eval, model verdict or unrelated
 * demonstration calculation can certify an absent/altered expression. */
export function candidateArithmetic(candidate:PublicationBundle["candidate"]){
  let text=candidate.body;
  try{const d=JSON.parse(text);text=d.content.blocks.map((b:{text:string;rows:string[][]})=>[b.text,...b.rows.flat()].join("\n")).join("\n");}catch{/* non-JSON guidance remains text */}
  const normalized=text.toLowerCase().replace(/[−–—]/g,"-").replace(/\*\*/g,"");
  const expressions:{text:string;hash:string;actual:string|null;expected:string;pass:boolean}[]=[];
  if(candidate.id==="TPL-07"){
    const expression=normalized.match(/new running quantity\s*=\s*([^.\n]+)/)?.[1]?.trim()??
      normalized.match(/closing (?:quantity|balance)\s*=\s*([^.\n]+)/)?.[1]?.trim()??"";
    const compact=expression.replace(/previous running quantity|opening quantity/g,"p")
      .replace(/quantity received|received/g,"r").replace(/quantity issued|issued/g,"i")
      .replace(/signed adjustment|adjustment/g,"a").replace(/\s+/g,"");
    const values:Record<string,bigint>={p:1000n,r:250n,i:500n,a:-100n};
    let actual:bigint|null=null;
    if(/^[pria](?:[+-][pria]){3}$/.test(compact)){
      actual=values[compact[0]!]!;
      for(let n=1;n<compact.length;n+=2)actual+=compact[n]==="+"?values[compact[n+1]!]!:-values[compact[n+1]!]!;
    }
    expressions.push({text:expression,hash:sha256(expression),actual:actual?.toString()??null,expected:"650",
      pass:compact==="p+r-i+a"&&actual===650n});
  }else if(candidate.id==="TPL-06"){
    const requested=normalized.match(/requested balance,\s*([^:\n]+)/)?.[1]?.replace(/\s+/g,"")??"";
    const approved=normalized.match(/approved expense total\s*([+-])\s*b\s*([+-])\s*c\s*=/);
    for(const [label,expr,expected]of[["requested",requested,"a-b-c"],["approved",approved?`a${approved[1]}b${approved[2]}c`:"","a-b-c"]] as const){
      let actual:bigint|null=null;if(/^a[+-]b[+-]c$/.test(expr))actual=10000n+(expr[1]==="+"?2000n:-2000n)+(expr[3]==="+"?1000n:-1000n);
      expressions.push({text:`${label}:${expr}`,hash:sha256(expr),actual:actual?.toString()??null,expected:"7000",
        pass:expr===expected&&actual===7000n});
    }
  }else if(candidate.id==="TPL-12"){
    const relationships=[...normalized.matchAll(/recorded balance\s*=\s*([^.\n]+)/g)];
    const expression=relationships[0]?.[1]?.trim()??"";
    const compact=expression.replace(/invoice amount/g,"i")
      .replace(/confirmed allocated payments/g,"p").replace(/confirmed credits\/reductions/g,"c")
      .replace(/separately established additional adjustments/g,"a").replace(/\s+/g,"");
    const structurallyValid=relationships.length===1&&(normalized.match(/=/g)?.length??0)===1&&
      !/\d+(?:\.\d+)?\s*%/.test(normalized)&&compact==="i-p-c+a";
    // Amounts are integer minor units, including overpayments, a negative
    // separately recorded adjustment and amounts beyond Number precision.
    for(const [label,i,p,c,a,expected]of[
      ["part-paid",2500000n,1000000n,200000n,0n,1300000n],
      ["settled",10000n,9000n,1000n,0n,0n],
      ["excess-payment",10000n,12500n,0n,0n,-2500n],
      ["negative-adjustment",10000n,1000n,2000n,-500n,6500n],
      ["large-minor-units",900719925474099300n,100n,99n,1n,900719925474099102n],
    ] as const){
      const actual=structurallyValid?i-p-c+a:null;
      expressions.push({text:`${label}: ${expression}`,hash:sha256(expression),actual:actual?.toString()??null,
        expected:expected.toString(),pass:actual===expected});
    }
  }else if(candidate.id==="TPL-24"){
    const relationships=[...normalized.matchAll(/weighted points\s*=\s*([^.\n]+)/g)];
    const expression=relationships[0]?.[1]?.trim()??"",compact=expression.replace(/\s+/g,"");
    const percentages=[...normalized.matchAll(/\d+(?:\.\d+)?\s*%/g)].map(m=>m[0].replace(/\s/g,""));
    const structurallyValid=relationships.length===1&&(normalized.match(/=/g)?.length??0)===1&&
      compact==="score÷5×weight"&&/weights total 100%/.test(normalized)&&/from 0 to 5/.test(normalized)&&
      percentages.length===1&&percentages[0]==="100%";
    // Scores and weights use hundredths. This executes the stated relationship
    // without floating-point loss; weights are a business method, not tax rates.
    for(const [label,score,weight,expected]of[
      ["zero-score",0n,6000n,0n],["partial-score",300n,4000n,2400n],
      ["maximum-score",500n,10000n,10000n],["fractional-score",250n,1234n,617n],
    ] as const){
      const actual=structurallyValid?score*weight/500n:null;
      expressions.push({text:`${label}: ${expression}`,hash:sha256(expression),actual:actual?.toString()??null,
        expected:expected.toString(),pass:actual===expected});
    }
  }else if(/[=]|(?:subtotal|balance|quantity|total|rate)\s*(?:is|equals|=)|\d+(?:\.\d+)?\s*[%×]/i.test(normalized)){
    return{pass:false,applicability:"Candidate contains a numeric relationship without a supported exact expression validator",
      candidateHash:candidate.hash,bodyHash:sha256(candidate.body),expressions};
  }
  return{pass:expressions.every(e=>e.pass),applicability:expressions.length?"Actual candidate expressions parsed and evaluated":
    "Not applicable: no detected numerical relationship or rate; candidate-specific text scan retained",
    candidateHash:candidate.hash,bodyHash:sha256(candidate.body),expressions};
}
