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
/**
 * A synthetic reason for a staff-library withdrawal (docs/architecture/editions.md, slice 3): every
 * withdrawal gives one, of 20 to 1,000 characters, and the customers it concerns read it.
 */
export const withdrawalReason = "A synthetic reason for this withdrawal, as its customers read it.";
/** A staff-library action's body, with the withdrawal's reason when it is a withdrawal. */
export const libraryAction = (action: string, revision: { version: number; digest: string }) => ({
  action,
  version: revision.version,
  digest: revision.digest,
  ...(action === "withdraw" ? { reason: withdrawalReason } : {}),
});
