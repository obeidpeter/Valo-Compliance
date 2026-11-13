/** Synthetic fixtures only. Never seed these as customers or published content. */
export const syntheticProfile = {
  businessName: "Synthetic development business", legalForm: "unknown", registrationStatus: "unknown",
  activities: ["unknown"], state: "unknown", lga: "", employees: "unknown",
  turnoverBand: "unknown", turnoverYear: "unknown", turnoverMetric: "unknown", turnoverCurrency: "unknown",
  premises: "unknown", manufacturing: "unknown", importing: "unknown", personalData: "unknown", marketingConsent: false,
};
export const syntheticDocument = {
  title: "Synthetic manual draft",
  content: {
    fields: { issuerName: "", recipientName: "", documentNumber: "", issueDate: "", dueDate: "", notes: "" },
    blocks: [{ id: "section-1", type: "paragraph", text: "User-provided synthetic test text", rows: [] }],
    selectedClauses: [], formatting: { font: "sans", accent: "forest" },
  },
};
