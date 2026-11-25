/**
 * The words for whom a staff-library withdrawal tells (docs/architecture/library-holds.md, slice 1,
 * ADM-007). The open entry says it for its published template edition, the withdrawal form says it before
 * the editor confirms, and a withdrawn edition says how many workspaces it told. The words are the
 * owner's to confirm.
 */
export type Reach = {
  version: number;
  workspaces: number;
  bought: number;
  documentWorkspaces: number;
  documents: number;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Who bought the template and who made documents from the version: "1 bought this template, and …". */
function who(reach: Reach) {
  const parts: string[] = [];
  if (reach.bought > 0) parts.push(`${reach.bought} bought this template`);
  if (reach.documentWorkspaces > 0)
    parts.push(
      `${reach.documentWorkspaces} made ${count(reach.documents, "document", "documents")} from this version`,
    );
  return parts.join(", and ");
}

/** The open entry's line for its published template edition. */
export function reachLine(reach: Reach) {
  return reach.workspaces === 0
    ? `Withdrawing version ${reach.version} would tell no workspace: none bought this template or made a document from this version.`
    : `Withdrawing version ${reach.version} would tell ${count(reach.workspaces, "workspace", "workspaces")}: ${who(reach)}.`;
}

/** What the withdrawal form says under its question, before the editor confirms. */
export function withdrawalHelp(version: number, template: boolean, reach: Reach | null) {
  const gone = `Readers can no longer open version ${version}.`;
  if (!template)
    return `${gone} A guide has no buyers or documents, so no customer is told. Write the reason for the record, in 20 to 1,000 characters.`;
  if (!reach)
    return `${gone} The customers who bought or used it are told, with this reason, so write it for them, in 20 to 1,000 characters.`;
  if (reach.workspaces === 0)
    return `${gone} No customer is told: none bought this template or made a document from this version. Write the reason for the record, in 20 to 1,000 characters.`;
  return `${gone} ${count(reach.workspaces, "workspace is", "workspaces are")} told, with this reason: ${who(reach)}. Write it for them, in 20 to 1,000 characters.`;
}

/** A withdrawn template edition's line: how many workspaces its withdrawal told. */
export function toldLine(told: number) {
  return told === 0
    ? "Its withdrawal told no workspace: none had bought the template or made a document from this version."
    : `Its withdrawal told ${count(told, "workspace", "workspaces")}, with its reason.`;
}
