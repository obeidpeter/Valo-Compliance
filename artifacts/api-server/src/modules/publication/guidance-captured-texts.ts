import type { GuideInstrument } from "./guidance-passages";

/**
 * Official texts whose words are not kept in the repository, and the passages of them guides quote.
 *
 * The first ten guides rest on passages of two Acts that are kept in the repository. For every
 * other text, only a passage's place and checksum are kept here: the words it starts and ends with,
 * and the SHA-256 of its words as the project's extractor read them from the official file on
 * 21 November 2026 (decision 0017, decision 7 for the owner). The words themselves are read from a
 * capture of the official address. A capture that does not hold exactly those words supplies no
 * passage, and the sentences of a guide that rest on it stay unbound.
 *
 * Nothing here says a text is current. That is the work of its amendment record
 * (guidance-amendments.ts).
 */
export type CapturedText = {
  /** The text's id, as its passages and its amendment record name it. */
  id: string;
  kind: Exclude<GuideInstrument["kind"], "official_page">;
  /** The source lead whose capture holds the text. */
  leadId: string;
  title: string;
  issuingBody: string;
  /** The day the text is treated as in force from. Its amendment record says why. */
  effectiveFrom: string;
};
export type CapturedPassage = {
  id: string;
  /** The captured text it is a passage of. */
  text: string;
  /** Where the passage is in its text, as a reader would look it up. */
  recordedLocator: string;
  /** The sections of an Act the passage holds. Empty for a text set out in articles. */
  sections: readonly string[];
  /** The passage runs from the one place these words occur in a capture to the end of the next `to`. */
  from: string;
  to: string;
  /** The SHA-256 of the passage's words, without the spaces around them. */
  sha256: string;
};

export const capturedTexts: readonly CapturedText[] = [
  {
    id: "NDPC-NDPA-2023",
    kind: "act",
    leadId: "S04",
    title: "Nigeria Data Protection Act 2023",
    issuingBody: "Nigeria Data Protection Commission (official copy)",
    effectiveFrom: "2023-06-12T00:00:00+01:00",
  },
  {
    id: "NDPC-GAID-2025",
    kind: "regulatory_document",
    leadId: "S05",
    title: "Nigeria Data Protection Act General Application and Implementation Directive 2025",
    issuingBody: "Nigeria Data Protection Commission",
    // The directive prints the day it was issued, 20 March 2025. Its amendment record says why the
    // later day is used.
    effectiveFrom: "2025-09-19T00:00:00+01:00",
  },
];

const p = (
  id: string,
  text: string,
  sections: readonly string[],
  recordedLocator: string,
  from: string,
  to: string,
  sha256: string,
): CapturedPassage => ({ id, text, sections, recordedLocator, from, to, sha256 });

export const capturedPassages: readonly CapturedPassage[] = [
  p(
    "NDPA-2",
    "NDPC-NDPA-2023",
    ["2"],
    "section 2; Gazette page A723",
    "2.—(1) This Act shall apply to the processing of personal data, whether",
    "in Nigeria.",
    "68755ed73521304050716bf6862a5300971dc8f78b48ea8d32c0ddb3b36ccfaa",
  ),
  p(
    "NDPA-3",
    "NDPC-NDPA-2023",
    ["3"],
    "section 3; Gazette page A724",
    "3.—(1) This Act shall not apply to the processing of personal data",
    "processing violates or is likely to violate sections 24 and 25 of this Act.",
    "c2823e924a084f9039e7e16e9bdc1feb9798cdd497d8978ca38d2c64e3f4274f",
  ),
  p(
    "NDPA-24",
    "NDPC-NDPA-2023",
    ["24"],
    "section 24; Gazette pages A732–A733",
    "24.—(1) A data controller or data processor shall ensure that personal",
    "contained in this Act.",
    "80843b485db90e0ae7a1a73b3befdea04525618c10b00ba09e6cad1018f6fbc4",
  ),
  p(
    "NDPA-24-1c",
    "NDPC-NDPA-2023",
    ["24"],
    "section 24(1)(a)–(c); Gazette page A732",
    "24.—(1) A data controller or data processor shall ensure that personal",
    "collected or further processed ;",
    "9e6f5c291c362862115dccc2ca22957c8866193fee1cbf121e5145c31e06930e",
  ),
  p(
    "NDPA-25",
    "NDPC-NDPA-2023",
    ["25"],
    "section 25; Gazette page A733",
    "25.—(1) Without prejudice to the principles set out in this Act, data",
    "personal data would be processed in the manner envisaged.",
    "af61289cf058c65de4b67f8a627c713883d2f3f379caec2ba512ebb338517941",
  ),
  p(
    "NDPA-26",
    "NDPC-NDPA-2023",
    ["26"],
    "section 26; Gazette pages A733–A734",
    "26.—(1) A data controller shall bear the burden of proof",
    "(b) may be provided in writing, orally, or through electronic means.",
    "719eebd69a11dad9703cc009a3d585ae9b6633cdffbfcef07b13711d2bef68ed",
  ),
  p(
    "NDPA-27",
    "NDPC-NDPA-2023",
    ["27"],
    "section 27; Gazette pages A734–A735",
    "27.—(1) Before a data controller collects personal data directly from a",
    "targeted by the data processing.",
    "9b8bdc94cb67707d6aee89bb139da2e43c4349c890fd7ce11e2ad15e0bfc2066",
  ),
  p(
    "NDPA-28",
    "NDPC-NDPA-2023",
    ["28"],
    "section 28; Gazette page A735",
    "28.—(1) Where the processing of personal data may likely result in",
    "persons concerned.",
    "68ad9f949bd1b597d26f4e23b03aebb13f22561350f786882ee0016c8a51d0e8",
  ),
  p(
    "NDPA-29",
    "NDPC-NDPA-2023",
    ["29"],
    "section 29; Gazette pages A735–A736",
    "29.—(1) Where a data controller engages the services of a data",
    "processors, as the case may be.",
    "a1f545b2d71f8dc81e7acfc34351d1eb1427a1c26f124e335fff8fa719f77a20",
  ),
  p(
    "NDPA-30-1a",
    "NDPC-NDPA-2023",
    ["30"],
    "section 30(1)(a); Gazette page A736",
    "30.—(1) Without prejudice to the principles set out in this Act, a data",
    "for the specific purpose or purposes for which it will be processed ;",
    "fbee0cb08ee3f2cea0cee6204de62e8138c7513cace48fcb8f68165146305b96",
  ),
  p(
    "NDPA-31-1",
    "NDPC-NDPA-2023",
    ["31"],
    "section 31(1); Gazette page A737",
    "31.—(1) Where a data subject is a child",
    "to rely on consent under this Act.",
    "c85668e45ce178a04a3e8313cf9c33ecf3961c362a52622f15974d9977bd13d7",
  ),
  p(
    "NDPA-34",
    "NDPC-NDPA-2023",
    ["34"],
    "section 34; Gazette pages A738–A739",
    "34.—(1) A data subject has the right to obtain from a data controller,",
    "lawful basis to retain the personal\ndata.",
    "3587e43ee5561a56a21f7665157219ac0a7619e111800706f1b23cd8d84582c3",
  ),
  p(
    "NDPA-35",
    "NDPC-NDPA-2023",
    ["35"],
    "section 35; Gazette page A739",
    "35.—(1) A data subject shall have the right to withdraw",
    "to withdraw, as to give consent.",
    "66fb1ed10127c076a709af6ff9803824175f2ce302cd33a089ca3af80a930e68",
  ),
  p(
    "NDPA-36",
    "NDPC-NDPA-2023",
    ["36"],
    "section 36; Gazette pages A739–A740",
    "36.—(1) A data subject shall have the right to object",
    "the personal data shall no longer be processed for such purposes.",
    "a3becdf0f7b7af949c064f57d9ee9c0a9954353e5d878b97a25bf77de1bfb060",
  ),
  p(
    "NDPA-37",
    "NDPC-NDPA-2023",
    ["37"],
    "section 37; Gazette page A740",
    "37.—(1) A data subject shall have the right not to be subject to a decision",
    "(c) contest the decision.",
    "a8afe22baf4c274e839f08f10cf4146f41160bef2cd6a18ab7f8e6beae2e37d5",
  ),
  p(
    "NDPA-37-1",
    "NDPC-NDPA-2023",
    ["37"],
    "section 37(1); Gazette page A740",
    "37.—(1) A data subject shall have the right not to be subject to a decision",
    "which produces legal or similar significant effects concerning the data subject.",
    "a938184bbba2795f5fd71c11788ed90cec15b16b3784ffd75d1f9a3d47c3bf0b",
  ),
  p(
    "NDPA-38",
    "NDPC-NDPA-2023",
    ["38"],
    "section 38; Gazette page A740",
    "38.—(1) The Commission may make regulations establishing a right of",
    "costs and timing.",
    "87103dc66568c085be16b5a77d3f6c5c7825325491b45d9db8da9e3b73acecfa",
  ),
  p(
    "NDPA-40",
    "NDPC-NDPA-2023",
    ["40"],
    "section 40(1); Gazette page A741",
    "40.—(1) Where a personal data breach has occurred with respect to",
    "under this section.",
    "bfbd69fcb0705628ddbdc6d5a5589b1689df1267f92cfe5e9d6c4b75acecc11b",
  ),
  p(
    "NDPA-41",
    "NDPC-NDPA-2023",
    ["41"],
    "section 41; Gazette page A743",
    "41.—(1) A data controller or data processor shall not transfer or permit",
    "country based on the nature of such personal data and risks to data subjects.",
    "b936e5f583269aa48baa18464394ece75f976afd0487ba16c7937d3b48203a13",
  ),
  p(
    "NDPA-41-1",
    "NDPC-NDPA-2023",
    ["41"],
    "section 41(1); Gazette page A743",
    "41.—(1) A data controller or data processor shall not transfer or permit",
    "(b) one of the conditions set out in section 43 of this Act applies.",
    "da8517a82a5cefe544358427f0b69d55a34bac92e9865be7a611d4415d152df6",
  ),
  p(
    "NDPA-42",
    "NDPC-NDPA-2023",
    ["42"],
    "section 42; Gazette pages A743–A744",
    "42.—(1) A level of protection is adequate for the purposes of this section",
    "those listed in this section.",
    "15d3832575bbb35683b46244a7a3d2f3a62c87b1b21a623ea43ae1c5a02240ca",
  ),
  p(
    "NDPA-43",
    "NDPC-NDPA-2023",
    ["43"],
    "section 43; Gazette pages A744–A745",
    "43.—(1) In the absence of adequacy of protection under section",
    "sovereignty without approval of the National\nAssembly.",
    "deb22b2701446c7cac8e2159b1e698fef89f38af0576276407b81c40548762a5",
  ),
  p(
    "NDPA-65-data-controller",
    "NDPC-NDPA-2023",
    ["65"],
    "section 65, “data controller”; Gazette page A758",
    "“data controller” means an individual, private entity, public Commission,",
    "purposes and means of processing of personal data ;",
    "783971adbaf8aa7e8dc1dc8c2acd364f0f47853fbbfff5508e5a3e025ead533b",
  ),
  p(
    "NDPA-65-data-processor",
    "NDPC-NDPA-2023",
    ["65"],
    "section 65, “data processor”; Gazette page A758",
    "“data processor” means an individual, private entity, public authority, or",
    "of a data controller or another data processor ;",
    "1b65cd015c4dd3e5062e81f11257157ce5a02fd77ee227325d2e04c3ce61009e",
  ),
  p(
    "GAID-18",
    "NDPC-GAID-2025",
    [],
    "Article 18",
    "Article 18: Data Processing Which Requires Consent\n(1) Without prejudice",
    "1 of this Article.",
    "8dd5bac8491858bb3b1d81eaeaa5bc9a78b2760d6942cca4d26d075483ba5758",
  ),
  p(
    "GAID-18-1a",
    "NDPC-GAID-2025",
    [],
    "Article 18, sub-article (1)(a)",
    "Article 18: Data Processing Which Requires Consent\n(1) Without prejudice",
    "a) For any direct marketing activity;",
    "6e3cf51dcc672676479ce7fd751b2c363605ea8ece075031e0a4a72609f826ec",
  ),
  p(
    "GAID-19",
    "NDPC-GAID-2025",
    [],
    "Article 19",
    "Article 19: Consent to Cookies and other Tracking Tools\n(1) Operation",
    "same rules shall apply.",
    "1e011c7de3082fbcbe2c964b1dfd809eb78c945812c154525a13e4c565fc0a18",
  ),
  p(
    "GAID-26-2c",
    "NDPC-GAID-2025",
    [],
    "Article 26, sub-articles (1) to (2)(c)",
    "Article 26: Reliance on Legitimate Interest\n(1) A data controller",
    "the legitimate interest pursued;",
    "4cbe8def3d6cdc82e0a967c2f52fc19143fe0ea2d175a23ce9a8d86eddd749d0",
  ),
  p(
    "GAID-27",
    "NDPC-GAID-2025",
    [],
    "Article 27",
    "Article 27: Consideration Regarding Information to Data Subjects\n(1) Provision",
    "has been duly provided prior to the processing of personal data.",
    "c7383673fdb69afde93645cf050b8212dda18e5f6111e17d56654e899ce27dec",
  ),
  p(
    "GAID-34",
    "NDPC-GAID-2025",
    [],
    "Article 34",
    "Article 34: Data Processing Agreement\n(1) In line with Section 29(2)",
    "rebuttable proof of compliance with the\n    NDP Act.",
    "cc13b3fc40d0e20e68c56c39b7ab4d20643e0a822b88a419939e5db80b55cbb8",
  ),
  p(
    "GAID-37",
    "NDPC-GAID-2025",
    [],
    "Article 37",
    "Article 37: Exercise of Right to Data Portability\n(1) A data subject has a right",
    "as long as are necessary for the performance of that contract.",
    "4bfac7fc15a6659efcd4081bcec74b61fac8287bfeab2a036e65c92efe0a6320",
  ),
  p(
    "GAID-45",
    "NDPC-GAID-2025",
    [],
    "Article 45",
    "Article 45: Cross-Border Data Transfer\n(1) Part VIII",
    "considered for adequacy decisions.",
    "5015d6be0cd3826d5633f9fd29d03354e1445ad5667dae95d2ce7a905d1e99c8",
  ),
  p(
    "GAID-SCHEDULE-5-GROUNDS",
    "NDPC-GAID-2025",
    [],
    "Schedule 5, paragraph 1",
    "SCHEDULE 5\n",
    "c) Other lawful bases.",
    "3be8e95aeec036caf5e684eacee88ffd13bc76005bf2896f76e0d9d32318b5e9",
  ),
];
