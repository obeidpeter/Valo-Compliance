import { formatDay } from "./format";

/**
 * The support, triage and owner screens' words for a reported problem that points at a guide or template
 * (an entry of the staff library) or at a rule the owner signed (docs/architecture/library-holds.md,
 * slice 3, ADM-008). Support staff find the entry by its title; triage holds that exact version from new
 * use at once, and a Content editor, or the owner for a regulatory article, reassesses it. They use the
 * site's words, as the staff library's own screen does. The words are the owner's to confirm.
 */
type LibraryKind =
  | "practical_guide"
  | "industry_introduction"
  | "industry_pack"
  | "template"
  | "premium_template"
  | "regulatory_article";

export const libraryKindNames: Record<LibraryKind, string> = {
  practical_guide: "Practical guide",
  industry_introduction: "Industry introduction",
  industry_pack: "Industry pack",
  template: "Template",
  premium_template: "Premium template",
  regulatory_article: "Regulatory article",
};

/** What a referral can point at, as the support screen offers it. */
export const targetKindNames = {
  content: "Content record",
  rule: "Rule record",
  library: "Guide or template",
} as const;

export const findLabel = "Find the guide or template by words of its title";
export const findHint =
  "Only published guides and templates are listed, and the referral points at the version published now.";
export const findButton = "Find";
export const noEntries = "No published guide or template has these words in its title.";
export const chooseLegend = "Published guides and templates";

/** A found entry, as the support screen lists it to choose from. */
export function entryLine(entry: { title: string; kind: LibraryKind; version: number }) {
  return `${entry.title} · ${libraryKindNames[entry.kind]} · version ${entry.version}`;
}

/** The triage queue's line for what a referral points at. A reviewed version's or a rule release's
 * stays as it was. */
export function referredLine(row: {
  targetKind: keyof typeof targetKindNames;
  targetTitle: string | null;
  targetVersion: number;
}) {
  if (row.targetKind === "library")
    return `Referred guide or template "${row.targetTitle ?? "untitled"}", version ${row.targetVersion}`;
  return `Referred ${row.targetKind} version ${row.targetVersion}`;
}

/** The triage queue's hold, for a library entry and for the reviewed route's versions. */
export const libraryHoldButton = "Hold this version from new use";
export const libraryHoldExplained =
  "“Hold this version from new use” takes the exact referred version out of new use at once, as a Content editor's hold does: customers cannot find, download or buy it, and what they already have is unchanged. Its reason names this request and copies none of its words. A Content editor then reassesses it, or the owner for a regulatory article. Customers are not told, nothing is published, and no AI review is sent.";
export const libraryHeldMessage =
  "The referred version is held from new use. A Content editor reassesses it, or the owner for a regulatory article. No AI work was dispatched and publication was not approved.";
export const libraryHoldTerm = "Hold from new use";

/** The owner's panel: the reported problems with the versions of a rule the owner signed. */
export const referralsHeading = "Reported problems";
export const referralsHint =
  "Content staff triage these in the support queue. If a report is right, withdraw the version here or sign a corrected one.";
export function referralLine(referral: {
  reference: string;
  version: number;
  held: boolean;
  referredAt: string;
}) {
  return `${referral.reference}, about version ${referral.version}, reported ${formatDay(referral.referredAt)}. ${
    referral.held
      ? "Content staff held that version, so the requirements check no longer uses it."
      : "That version is not held."
  }`;
}
