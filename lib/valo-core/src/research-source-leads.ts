import {allSourceLeads as baseline} from "./coordinating.generated";

/** Issue evidence is a retrieval lead, never publication or currentness approval. */
export const businessNameSourceLeads=[
  {id:"CAC-BN-PROCESS",title:"CAC business-name registration process",
    url:"https://www.cac.gov.ng/services/business-name",category:"regulatory",
    baselineNotes:"Current process retrieval required; no inferred fees, guarantees or universal SME duties.",
    sourceLocator:"https://github.com/obeidpeter/Valo-Compliance/issues/4"},
  {id:"NIPC-BFA-2022",title:"Business Facilitation (Miscellaneous Provisions) Act — NIPC copy",
    url:"https://nipc.gov.ng/assets/resources/business-facilitation-miscellaneous-provisions-act-2022/business-facilitation-misc-provisions-act-2022.pdf",category:"regulatory",
    baselineNotes:"Review Schedule Part I, printed A103–A107/PDF9–13, including CAMA20/283 dependency. Does not establish absence of later amendments or judgments.",
    sourceLocator:"https://github.com/obeidpeter/Valo-Compliance/issues/4"},
  {id:"NCC-COPYRIGHT",title:"Copyright Act — official NCC copy",
    url:"https://copyright.gov.ng/CopyrightAct/CopyrightAct2023FinalPublication1.pdf",category:"regulatory",
    baselineNotes:"Section3(b), printed A184/PDF8: statutory-passage rights only, including compilation exception. Not website, commentary or AI-provider rights.",
    sourceLocator:"https://github.com/obeidpeter/Valo-Compliance/issues/4"},
] as const;
export const allSourceLeads=[...baseline,...businessNameSourceLeads];
