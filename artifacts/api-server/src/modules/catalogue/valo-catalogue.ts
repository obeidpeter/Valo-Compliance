/** Public metadata only. Callers supply currently eligible releases or shipped
 * public directory pages, never candidate bodies or customer drafts. */
export type ReleasedLibraryItem = {
  id: string;
  slug: string;
  title: string;
  type: string;
  industry: string;
  summary: string;
  templateId?: string;
  /** The template's number in the specification's list, when it is known (`TPL-29`). */
  templateNumber?: string;
  category?: string;
  access?: "free" | "premium";
  amountKobo?: number;
  priceId?: string;
  freeDownloadPath?: string;
  premiumDownloadPath?: string;
  reviewedAt?: string;
  href?: string;
};
/** A template's number in the specification's list. */
export const TEMPLATE_NUMBER = /^TPL-\d{2}$/;
export type CatalogueQuery = {
  q?: string | undefined;
  type?: string | undefined;
  industry?: string | undefined;
  category?: string | undefined;
  access?: string | undefined;
  sort?: string | undefined;
  page?: number | undefined;
  /** Only the templates with these numbers, comma-separated, as the route validated them. */
  templateIds?: string | undefined;
};
const normal = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const aliases: Record<string, string> = {
  bill: "invoice",
  quote: "quotation",
  employees: "staff",
  employee: "staff",
  workers: "staff",
};
function terms(s: string) {
  return normal(s)
    .split(" ")
    .filter(Boolean)
    .map((t) => aliases[t] ?? t);
}
export function relevance(item: ReleasedLibraryItem, q: string) {
  const wanted = terms(q),
    title = terms(item.title),
    body = terms([item.title, item.summary, item.category ?? "", item.industry].join(" "));
  if (!wanted.every((t) => body.some((w) => w.startsWith(t)))) return -1;
  const phrase = normal(q),
    name = normal(item.title);
  return (
    (name === phrase ? 1000 : name.startsWith(phrase) ? 200 : name.includes(phrase) ? 100 : 0) +
    wanted.reduce(
      (score, t) => score + (title.includes(t) ? 30 : title.some((w) => w.startsWith(t)) ? 10 : 1),
      0,
    )
  );
}
export function paginateReleasedItems(released: ReleasedLibraryItem[], query: CatalogueQuery = {}) {
  const page = Number.isSafeInteger(query.page) && query.page! > 0 ? query.page! : 1;
  const q = query.q?.trim().slice(0, 120) ?? "";
  const numbers = query.templateIds ? new Set(query.templateIds.split(",")) : undefined;
  const ranked = released
    .map((item, index) => ({ item, index, score: q ? relevance(item, q) : 0 }))
    .filter(
      ({ item, score }) =>
        score >= 0 &&
        (!query.type || query.type === "all" || item.type === query.type) &&
        (!query.industry ||
          item.industry === "All industries" ||
          item.industry.split(",").includes(query.industry)) &&
        (!query.category || item.category === query.category) &&
        (!query.access || query.access === "all" || item.access === query.access) &&
        (!numbers || (item.templateNumber !== undefined && numbers.has(item.templateNumber))),
    );
  ranked.sort((a, b) => {
    if (query.sort === "name")
      return a.item.title.localeCompare(b.item.title, "en-NG") || a.item.id.localeCompare(b.item.id);
    if (query.sort === "recently_checked")
      return (
        (Date.parse(b.item.reviewedAt ?? "") || 0) - (Date.parse(a.item.reviewedAt ?? "") || 0) ||
        a.index - b.index
      );
    return b.score - a.score || a.index - b.index;
  });
  return {
    items: ranked.slice((page - 1) * 20, page * 20).map((r) => r.item),
    total: ranked.length,
    page,
    heldTemplates: Math.max(0, 40 - released.filter((i) => i.type === "template").length),
  };
}
export function templateCategory(id: string) {
  const n = Number(id.replace(/^TPL-/, ""));
  if ([1, 2, 3, 4, 5, 6, 7, 12].includes(n)) return "Finance and operations";
  if ([10, 11, 16, 17, 26, 27, 28].includes(n)) return "People";
  if ([13, 14, 15, 18, 19, 20, 21, 22, 23, 39].includes(n)) return "Agreements and sales";
  if ([29, 30, 31, 32].includes(n)) return "Privacy and data";
  return "Business management";
}
export function templateSummary(id: string) {
  const summaries: Record<string, string> = {
    "TPL-01": "Prepare an invoice showing items, prices and payment details supplied by your business.",
    "TPL-02": "Prepare a quotation with proposed prices and scope for a customer.",
    "TPL-03":
      "Record a payment received using details you confirm; a draft receipt does not verify a payment.",
    "TPL-04": "Record goods or services ordered from a supplier in a purchase order.",
    "TPL-05": "Record goods dispatched or delivered and the details supplied by your business.",
    "TPL-06": "Record staff expenses, amounts and reimbursement details for internal review.",
    "TPL-07": "Record stock movements, inventory receipts, issues and physical counts.",
    "TPL-08": "Record meeting discussions, decisions, action owners and minutes.",
    "TPL-09": "Record a customer complaint, reported problem and follow-up actions.",
    "TPL-10": "Record an employee leave or holiday request and internal approval details.",
    "TPL-11": "Organise staff onboarding and new employee induction tasks.",
    "TPL-12": "Prepare a payment reminder from an invoice balance and dates you supply.",
    "TPL-13": "Prepare service agreement details, responsibilities and commercial scope for review.",
    "TPL-14": "Prepare consultancy engagement details, deliverables and proposed fees for review.",
    "TPL-15": "Prepare confidentiality and non-disclosure agreement details for review.",
    "TPL-16": "Prepare employment contract details from the role and terms you supply.",
    "TPL-17": "Prepare a job offer letter from confirmed role and pay details.",
    "TPL-18": "Prepare supplier agreement details and purchasing arrangements for review.",
    "TPL-19": "Prepare sales agreement details from supplied goods, prices and terms.",
    "TPL-20": "Prepare partnership agreement details and proposed responsibilities for review.",
    "TPL-21": "Prepare independent contractor engagement details and deliverables for review.",
    "TPL-22": "Organise a business proposal with your objectives, scope and costs.",
    "TPL-23": "Define a statement of work with project scope and deliverables for review.",
    "TPL-24": "Record procurement bids, evaluation criteria and supplier comparisons.",
    "TPL-25": "Record a proposed board resolution and supplied decision details.",
    "TPL-26": "Organise an employee handbook with supplied workplace policies for review.",
    "TPL-27": "Prepare a staff leave policy from the rules your business supplies.",
    "TPL-28": "Organise a disciplinary procedure and internal staff process for review.",
    "TPL-29": "Prepare a privacy notice describing the personal data practices you supply.",
    "TPL-30": "Prepare website terms and conditions from supplied service details for review.",
    "TPL-31": "Prepare a data processing agreement describing supplied processing roles.",
    "TPL-32": "Organise a data retention policy and supplied record disposal schedule.",
    "TPL-33": "Record health and safety checks, workplace hazards and follow-up actions.",
    "TPL-34": "Record an incident, accident details and actions using confirmed facts.",
    "TPL-35": "Document a standard operating procedure with work steps and responsibilities.",
    "TPL-36": "Organise a product recall plan with supplied contacts and response steps.",
    "TPL-37": "Record food hygiene checks and cleaning observations.",
    "TPL-38": "Record equipment maintenance, servicing dates and repair notes.",
    "TPL-39": "Organise a commercial lease checklist for premises review.",
    "TPL-40": "Organise a compliance evidence checklist from the records your business identifies.",
  };
  return (
    summaries[id] ??
    "Prepare this business document using your own information. Check its scope and required inputs before use."
  );
}
export function recommendTemplates(items: ReleasedLibraryItem[], savedIds: string[], activities: unknown) {
  const selected = new Set(savedIds),
    saved = items.filter((i) => i.templateId && selected.has(i.templateId));
  const categories = new Set(saved.map((i) => i.category).filter(Boolean));
  const supplied = Array.isArray(activities)
    ? activities.filter((x): x is string => typeof x === "string")
    : [];
  return items
    .filter((i) => i.type === "template" && i.templateId && !selected.has(i.templateId))
    .map((item) => {
      const industry = item.industry.split(",").some((s) => supplied.includes(s));
      const related = !!item.category && categories.has(item.category);
      return {
        ...item,
        reason: industry
          ? "Matches an activity in your business profile"
          : related
            ? "In a category you saved"
            : "General business template",
        score: (industry ? 20 : 0) + (related ? 10 : 0),
      };
    })
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "en-NG"))
    .slice(0, 6)
    .map(({ score, ...item }) => item);
}
