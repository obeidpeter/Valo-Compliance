/** The title and description of each fixed public page: for its metadata and the sitemap, and for
 * the title the app gives the page when a visitor moves to it in the app. */
export const publicPages: Record<string, { title: string; description: string }> = {
  "/": {
    title: "Valo — Documents and business requirements",
    description:
      "Prepare business documents and explore source-backed guidance for Nigerian SMEs. Check the stated scope and availability of every item.",
  },
  "/library": {
    title: "Documents and guidance — Valo",
    description:
      "Search the business templates and guidance Valo has published, by keyword, category, industry and access level.",
  },
  "/resources": {
    title: "Guides — Valo",
    description:
      "Browse the business guidance Valo has published, with its sources and the dates they were checked.",
  },
  "/industries": {
    title: "Guidance by industry — Valo",
    description: "Explore available guidance by business activity. A coverage gap is not an exemption.",
  },
  "/services": {
    title: "Ask about a service — Valo",
    description:
      "Ask Valo staff about registration, tax, accounting, employment, legal, privacy or sector approvals. An enquiry does not book an appointment or pass you to a provider.",
  },
  "/about": {
    title: "About Valo",
    description: "What Valo does for small businesses in Nigeria, and what it is not.",
  },
  "/contact": {
    title: "Contact us — Valo",
    description: "Write to Valo without an account. Your message is saved for staff, with a reference.",
  },
  "/help": {
    title: "Help — Valo",
    description: "Questions and answers about making documents, checking requirements and your account.",
  },
  "/support": {
    title: "Report a problem — Valo",
    description:
      "Report a problem for staff to look at and get a reference at once. No response time is promised.",
  },
  "/account-access": {
    title: "Trouble signing in — Valo",
    description: "Ask for help signing in, verifying your email or using a suspended account.",
  },
  "/compliance": {
    title: "Guidance — Valo",
    description:
      "Explore source-backed requirements and understand the limits of currently available guidance.",
  },
  "/checker": {
    title: "Check your requirements — Valo",
    description:
      "Answer a few questions about your business to see which requirements may apply, and why. Results come only from published rules checked against an official source.",
  },
  "/pricing": {
    title: "Pricing — Valo",
    description: "See available access options and the current status of paid features.",
  },
  "/privacy": {
    title: "Privacy — Valo",
    description: "Read Valo’s privacy information and available account request routes.",
  },
  "/terms": { title: "Terms — Valo", description: "Read the current terms and limits for using Valo." },
};
