import type {FiniteWork} from "./inference-batch-dispatch";
/** Admission is to a particular role and corpus, never a caller's lane label. */
export function assertFiniteWorkShape(work:FiniteWork){
  const corpus={publication:null,editorial_evaluation:"editorial",checker_challenge:"checker",customer:"customer-ai"} as const;
  const binding=work.bindings;
  if(!binding||!(work.lane in corpus)||binding.corpus!==corpus[work.lane])
    throw Error("WORK_LANE_CORPUS_MISMATCH");
  if(work.lane==="publication"){
    if(binding.caseId!==null||!binding.operationalPlan)throw Error("PUBLICATION_PLAN_REQUIRED");
  }else if(typeof binding.caseId!=="string"||!binding.caseId.trim())throw Error("CASE_BINDING_REQUIRED");
  if(work.lane==="customer"){
    if(work.role!=="customer"||work.pair!==null||binding.candidateVersionId!==null||binding.operationalPlan)
      throw Error("CUSTOMER_WORK_SCOPE_INVALID");
  }else if(!binding.candidateVersionId||!/^[a-f0-9-]{36}$/.test(binding.candidateVersionId))
    throw Error("CANDIDATE_VERSION_REQUIRED");
  if(work.lane==="checker_challenge"&&(work.role!=="challenge"||work.pair!==null))
    throw Error("CHECKER_CHALLENGE_SCOPE_INVALID");
  if(["publication","editorial_evaluation"].includes(work.lane)&&
    (!work.pair||!["factual","challenge"].includes(work.role)))throw Error("REVIEW_PAIR_REQUIRED");
}
