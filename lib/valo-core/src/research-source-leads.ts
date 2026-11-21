import { allSourceLeads as baseline } from "./coordinating.generated";

/** Issue evidence is a retrieval lead, never publication or currentness approval. */
export const businessNameSourceLeads = [
  {
    id: "CAC-BN-PROCESS",
    title: "CAC business-name registration process",
    url: "https://www.cac.gov.ng/services/business-name",
    category: "regulatory",
    baselineNotes:
      "Current process retrieval required; no inferred fees, guarantees or universal SME duties.",
    sourceLocator: "https://github.com/obeidpeter/Valo-Compliance/issues/4",
  },
  {
    id: "NIPC-BFA-2022",
    title: "Business Facilitation (Miscellaneous Provisions) Act — NIPC copy",
    url: "https://nipc.gov.ng/assets/resources/business-facilitation-miscellaneous-provisions-act-2022/business-facilitation-misc-provisions-act-2022.pdf",
    category: "regulatory",
    baselineNotes:
      "Review Schedule Part I, printed A103–A107/PDF9–13, including CAMA20/283 dependency. Does not establish absence of later amendments or judgments.",
    sourceLocator: "https://github.com/obeidpeter/Valo-Compliance/issues/4",
  },
  {
    id: "NCC-COPYRIGHT",
    title: "Copyright Act — official NCC copy",
    url: "https://copyright.gov.ng/CopyrightAct/CopyrightAct2023FinalPublication1.pdf",
    category: "regulatory",
    baselineNotes:
      "Section3(b), printed A184/PDF8: statutory-passage rights only, including compilation exception. Not website, commentary or AI-provider rights.",
    sourceLocator: "https://github.com/obeidpeter/Valo-Compliance/issues/4",
  },
] as const;
/**
 * Official addresses the guidance drafts rest on that the lists above lack (decision 0017). A lead
 * lets the address be fetched and watched; it approves nothing and says nothing is current.
 */
export const guidanceSourceLeads = [
  {
    id: "NASS-NTAA-2025",
    title: "Nigeria Tax Administration Act 2025, National Assembly copy",
    url: "https://nass.gov.ng/documents/download/11250",
    category: "regulatory",
    baselineNotes:
      "The copy GUD-07 to GUD-10 quote. The Gazette copy (S02) differs from it in places; see the Act's amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NRS-TAXID-HOW",
    title: "Nigeria Revenue Service: how Tax ID retrieval works",
    url: "https://taxid.nrs.gov.ng/how-it-works",
    category: "regulatory",
    baselineNotes: "An official service page GUD-08 describes. A page says what it says when it is read.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
] as const;
export const allSourceLeads = [...baseline, ...businessNameSourceLeads, ...guidanceSourceLeads];
