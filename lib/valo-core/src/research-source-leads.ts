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
    id: "FCCPC-GAZETTE-2018",
    title: "Federal Competition and Consumer Protection Act 2018",
    url: "https://fccpc.gov.ng/wp-content/uploads/2022/07/FCCPA-2018.pdf",
    category: "regulatory",
    baselineNotes:
      "Scanned Official Gazette. Consumer guidance uses the printed pages and the checksum of the inspected edition.",
    sourceLocator: "https://fccpc.gov.ng/resources-library/fccpa/",
  },
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
  {
    id: "NAFDAC-FSAN-GDL-004-03",
    title:
      "NAFDAC: Guidelines for Production Inspection of Micro Scale Food Manufacturing Facilities in Nigeria (New Applicants)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guidelines-for-Inspection-of-Micro-Scale-Enterprises-in-Nigeria.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-19 quotes. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-FSAN-GDL-005-03",
    title:
      "NAFDAC: Guidelines for Production Inspection of Small Scale Food Enterprises in Nigeria (New Applicants)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guidelines-for-Inspection-of-Small-Scale-Enterprises.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-19 quotes. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-FSAN-GDL-001-03",
    title:
      "NAFDAC: Guidelines for Inspection and Requirements for Pre-packaged Food Manufacturing/Packaging Facilities in Nigeria",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Guideline-for-Inspection-and-Requirements-for-Pre-Packaged-Food-Facilities-in-Nigeria.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-19 and GUD-20 quote. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-FRRA-GDL-002-01",
    title: "NAFDAC: Guidelines for Registration of Pre-packaged Food Products Made in Nigeria",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FR_and_R/Guidelines-for-Registration-of-Food-Products-Made-in-Nigeria.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-21 and GUD-26 quote. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-FSAN-GDL-006-03",
    title: "NAFDAC: Current Good Manufacturing Practice Guidelines for Food and Food Products (Revised)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/Current-Good-Manufacturing-Practice-Guidelines-for-Food-and-Food-Products.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-22 and GUD-23 quote. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-FSAN-GDL-008-03",
    title: "NAFDAC: NAFDAC Guidelines for Food Hygienic Practices (NGFHP)",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FSAN/2025-2030/NAFDAC-Guidelines-for-Food-Hygienic-Practices.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-24 quotes. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-IE-GDL-001-02",
    title:
      "NAFDAC: Guidelines for Handling and Disposal of Unwholesome Medicines and NAFDAC Regulated Products in Nigeria",
    url: "https://www.nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/INVESTIGATION_ENFORCEMENT_GUIDELINES/Guidelines-for-Handling-and-Disposal-of-Unwholesome-Medicines-and-Other-NAFDAC-Regulated-Products.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-25 quotes. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NAFDAC-FRR-GDL-003-01",
    title: "NAFDAC: Guidelines for Advertisement of Food Products in Nigeria",
    url: "https://nafdac.gov.ng/wp-content/uploads/Files/Resources/Guidelines/FR_and_R/Guidelines-for-Advertisement-Control-of-Food-Products-in-Nigeria-Revised.pdf",
    category: "regulatory",
    baselineNotes:
      "The edition GUD-26 quotes. A later edition is a different text; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
  {
    id: "NIPC-LABOUR-ACT",
    title: "Labour Act — NIPC reference copy",
    url: "https://m.nipc.gov.ng/assets/resources/labour-act/labour-act.pdf",
    category: "regulatory",
    baselineNotes:
      "The copy GUD-27 to GUD-30 quote. The commission lists it for reference and says the authoritative version remains with the issuing authority; see its amendment record.",
    sourceLocator: "docs/architecture/decisions/0017-clear-guidance-holds.md",
  },
] as const;
export const allSourceLeads = [...baseline, ...businessNameSourceLeads, ...guidanceSourceLeads];
