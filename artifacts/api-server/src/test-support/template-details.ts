/**
 * Synthetic entry details for a test template's draft (docs/architecture/library-entries.md). A
 * template is released only with what it is for, its limits and how it was written, so every test
 * that releases one gives them.
 */
export const templateDetails = {
  purpose: "Keep a synthetic record for a test.",
  needs: "The first synthetic fact\nThe second synthetic fact",
  limits: "A synthetic test template; it shows nothing beyond what is entered.",
  aiDrafted: true,
} as const;
/** The same details as SQL column values, for a test that writes the table directly. */
export const templateDetailColumns = {
  purpose: templateDetails.purpose,
  needs: templateDetails.needs,
  limits: templateDetails.limits,
  aiDrafted: templateDetails.aiDrafted,
} as const;
