/**
 * The words a public search reads (WEB-003, docs/architecture/public-search.md).
 *
 * A search finds an item whose title, description, category, industry and kind have every word that
 * was typed. These lists let it read a search as a business owner types one: without the small words
 * of a question, with a plural as its singular, and with an everyday word as the site's own word for
 * the same thing.
 *
 * The lists are a starting point, and the owner's to change. A word here only widens what a search
 * finds. It says nothing about what an item covers.
 */

/** A text in lower case, without accents, possessive marks or punctuation, its words one space apart. */
export const plainText = (text: string) =>
  text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(?<=[a-z0-9])['\u2019](?=[a-z])/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A plural as its singular, so that "invoices" finds "Invoice" and "policies" finds "policy". */
export function singular(word: string) {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(?:ss|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}

/**
 * The same thing written two ways, where one of them takes more than one word. Each is read as the
 * second, in a search and in an item.
 */
const SAME_PHRASES: readonly (readonly [string, string])[] = [
  ["privacy policy", "privacy notice"],
  ["hand over", "handover"],
  ["time off", "leave"],
  ["time away", "leave"],
  ["tax identification number", "tax id"],
  ["online shop", "e commerce"],
  ["online store", "e commerce"],
  ["estate agent", "real estate"],
  ["fast food", "restaurant"],
  ["scope of work", "statement of work"],
];

/** A text's words as a search compares them: plain, each plural as its singular, and each phrase that
 * is written two ways written the one way. */
export function searchWords(text: string): string[] {
  const words = plainText(text).split(" ").filter(Boolean).map(singular);
  if (!words.length) return [];
  let line = ` ${words.join(" ")} `;
  for (const [from, to] of SAME_PHRASES) line = line.replaceAll(` ${from} `, ` ${to} `);
  return line.trim().split(" ");
}

const table = (words: Readonly<Record<string, string>>) =>
  new Map(Object.entries(words).map(([word, other]) => [singular(word), searchWords(other)]));

/**
 * Two words for the same thing, each read as the second in a search and in an item: a search for
 * "staff" finds the Employee handbook, and one for "employees" finds the Staff onboarding checklist.
 */
const SAME_WORDS = table({
  bill: "invoice",
  quote: "quotation",
  employee: "staff",
  worker: "staff",
  personnel: "staff",
  contract: "agreement",
  holiday: "leave",
  vacation: "leave",
  absence: "leave",
  licence: "permit",
  license: "permit",
  stock: "inventory",
  nda: "non disclosure",
  waybill: "delivery note",
  lpo: "purchase order",
  sop: "standard operating procedure",
  tin: "tax id",
  ecommerce: "e commerce",
});

/**
 * An everyday word, and the word the site files such a thing under. Read in a search only: a search
 * for "hotel" also finds what is filed under hospitality, and a search for "hospitality" finds nothing
 * more for it.
 */
const FILED_UNDER = table({
  // What a document is called.
  sample: "template",
  format: "template",
  guide: "guidance",
  tenancy: "lease",
  rent: "lease",
  deed: "agreement",
  application: "request",
  detail: "particular",
  confidential: "non disclosure",
  confidentiality: "non disclosure",
  freelance: "independent contractor",
  freelancer: "independent contractor",
  accident: "incident",
  chase: "reminder",
  chasing: "reminder",
  overdue: "unpaid",
  owing: "unpaid",
  // People, pay and advisers.
  hr: "staff",
  hire: "employment",
  hiring: "employment",
  recruit: "employment",
  recruiting: "employment",
  recruitment: "employment",
  salary: "payroll",
  wage: "payroll",
  accountant: "accounting",
  audit: "accounting",
  auditor: "accounting",
  bookkeeper: "bookkeeping",
  lawyer: "legal",
  solicitor: "legal",
  attorney: "legal",
  consultant: "consultancy",
  // Registration, tax and data protection, by the names and short names people use.
  register: "registration",
  registering: "registration",
  incorporate: "registration",
  incorporation: "registration",
  cac: "registration",
  firs: "tax",
  nrs: "tax",
  vat: "tax",
  paye: "tax",
  ndpa: "privacy",
  ndpr: "privacy",
  ndpc: "privacy",
  gdpr: "privacy",
  // Kinds of business, by the industry the site lists them under.
  shop: "retail",
  store: "retail",
  supermarket: "retail",
  kiosk: "retail",
  trader: "retail",
  wholesaler: "wholesale",
  distributor: "wholesale",
  hotel: "hospitality",
  guesthouse: "hospitality",
  caterer: "hospitality",
  catering: "hospitality",
  eatery: "restaurant",
  canteen: "restaurant",
  bakery: "packaged food",
  farm: "agriculture",
  farming: "agriculture",
  farmer: "agriculture",
  poultry: "agriculture",
  fishery: "agriculture",
  livestock: "agriculture",
  factory: "manufacturing",
  manufacturer: "manufacturing",
  haulage: "logistics",
  trucking: "logistics",
  courier: "logistics",
  freight: "logistics",
  transporter: "transport",
  builder: "construction",
  property: "real estate",
  landlord: "real estate",
  realtor: "real estate",
  app: "software",
  saas: "software",
  ict: "technology",
  salon: "beauty",
  barber: "beauty",
  spa: "beauty",
  cosmetic: "beauty",
  makeup: "beauty",
  hairdresser: "beauty",
  tailor: "fashion",
  tailoring: "fashion",
  clothing: "fashion",
  clothes: "fashion",
  boutique: "fashion",
  fabric: "textiles",
  clinic: "healthcare",
  hospital: "healthcare",
  pharmacy: "healthcare",
  chemist: "healthcare",
  doctor: "healthcare",
  dentist: "healthcare",
  laboratory: "healthcare",
  school: "education",
  college: "education",
  university: "education",
  tutor: "education",
  creche: "education",
  nursery: "education",
  photographer: "creative",
  photography: "creative",
  videographer: "creative",
  filmmaker: "creative",
  importer: "import",
  importation: "import",
  exporter: "export",
  solar: "energy",
  generator: "energy",
  fuel: "energy",
  petrol: "energy",
  electricity: "energy",
  inverter: "energy",
  loan: "financial",
  lender: "financial",
  lending: "financial",
  microfinance: "financial",
  fintech: "financial",
  insurance: "financial",
  bank: "financial",
});

/** The other word or words for the same thing as `word`, if the lists have any. */
export const sameAs = (word: string) => SAME_WORDS.get(word);
/** The word or words the site files `word` under, if the lists have any. */
export const filedUnder = (word: string) => FILED_UNDER.get(word);

/**
 * The small words of a question or a phrase. A search leaves them out when it has other words to go
 * on, so that "how to write a quotation" is a search for "write" and "quotation".
 */
const SMALL_WORDS = new Set(
  [
    "a an the to of for in on at by with from about and or",
    "i me my we our your do does is are can should need",
    "how what when where which why long much many",
  ]
    .flatMap((line) => line.split(" "))
    .flatMap((word) => [word, singular(word)]),
);
/** The words of a search that say what is wanted: all of them when every one is a small word. */
export function wantedWords(words: readonly string[]) {
  const kept = words.filter((word) => !SMALL_WORDS.has(word));
  return kept.length ? kept : [...words];
}

/**
 * Words that say only that the searcher is a business. Every item is for a business, and few say so:
 * such a word never rules an item out when the search has other words, and counts for an item that
 * has it. So "construction company" finds the construction page, and "company annual returns" still
 * puts the company's guide first.
 */
const BUSINESS_WORDS = new Set(
  [
    "business",
    "company",
    "firm",
    "enterprise",
    "organisation",
    "organization",
    "venture",
    "startup",
    "sme",
  ].map(singular),
);
/** The wanted words an item must have: all but the business words, or all when there are no others. */
export function neededWords(wanted: readonly string[]) {
  const needed = wanted.filter((word) => !BUSINESS_WORDS.has(word));
  return new Set(needed.length ? needed : wanted);
}

/**
 * A word in "-ing" or "-ed" as the word it comes from, when that leaves four letters or more:
 * "starting" also finds "start", and "registered" finds "register". Null when there is none.
 */
export function baseWord(word: string) {
  const ending = ["ing", "ed"].find((end) => word.endsWith(end) && word.length - end.length >= 4);
  return ending ? word.slice(0, -ending.length) : null;
}
