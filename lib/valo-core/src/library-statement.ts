/**
 * What a template released from the staff library says about how it was written and checked
 * (docs/architecture/library-entries.md), from whether its release records that AI drafted it. Valo
 * runs no AI review on this route, so the reviewed route's disclosure would be untrue here. Proposed
 * wording, for the owner to approve. It needs nothing but text, so the browser reads it too: the staff
 * screen previews it before a release.
 */
export function libraryTemplateStatement(aiDrafted: boolean | null) {
  const read = "A Valo Content editor read this version before releasing it.";
  if (aiDrafted === true)
    return `Drafted with AI. ${read} Valo ran no AI review of it, and no Nigerian legal, tax or sector specialist reviewed it.`;
  if (aiDrafted === false)
    return `Written without AI. ${read} No Nigerian legal, tax or sector specialist reviewed it.`;
  return `${read} No Nigerian legal, tax or sector specialist reviewed it.`;
}
