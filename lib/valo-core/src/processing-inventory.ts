/**
 * Valo's processing inventory (PRV-001; docs/architecture/processing-inventory.md). One record of what
 * Valo processes, why, on what proposed basis, about whom, who receives it, how long it is kept and in
 * which database tables. The privacy notice is made from it, and a test checks it against the database
 * schema and the processor review (docs/valo/processor-review.md).
 *
 * It is a draft for the privacy owner. Each lawful basis, recipient and retention period here is a
 * proposal for that owner to decide. It is not legal advice and not a privacy professional's review.
 */

/** The lawful bases the Nigeria Data Protection Act 2023 names for processing personal data. */
export type LawfulBasis =
  "consent" | "contract" | "legal_obligation" | "vital_interests" | "public_task" | "legitimate_interests";

/**
 * An outside service that may receive personal data, by its name in the processor review's table of
 * services. Healthchecks.io and GitHub are not among them: the review says they receive no customer data.
 */
export type ProcessorName =
  | "Replit"
  | "Clerk"
  | "Resend, through Replit Connectors"
  | "Paystack"
  | "OpenAI, through Replit AI Integrations"
  | "Backblaze B2";

export type ProcessingActivity = {
  id: string;
  /** What the activity is, as the notice names it. */
  title: string;
  purpose: string;
  /** The proposed lawful basis, and why, for the privacy owner to decide. */
  basis: LawfulBasis;
  basisReason: string;
  /** The kinds of data, in plain words. */
  data: readonly string[];
  /** The people the data is about. */
  subjects: readonly string[];
  /** Who at Valo reads it, if anyone. */
  staff: string | null;
  /** The outside services it reaches. */
  services: readonly ProcessorName[];
  retention: string;
  /** For optional processing: the consent that starts it, which the person can withdraw. */
  consent: string | null;
  /** The database tables that hold it. */
  tables: readonly string[];
};

/** Held for every activity: the encrypted backups and their period, as the owner approved them. */
export const BACKUP_RETENTION =
  "Valo's encrypted backups hold a copy of every record for 35 days (the owner's approval of 20 November 2026).";

export const processingInventory: readonly ProcessingActivity[] = [
  {
    id: "accounts",
    title: "Your account and sign-in",
    purpose:
      "To let you sign in, keep your workspace private to you, and tell your workspace apart from others.",
    basis: "contract",
    basisReason: "Needed to give you the service you signed up for.",
    data: [
      "the identifier the sign-in provider gives your account",
      "your verified email address",
      "your workspace and who belongs to it",
    ],
    subjects: ["account holders"],
    staff: null,
    services: ["Clerk", "Replit"],
    retention:
      "Kept while your account is open. A verified deletion request removes your workspace's records at Valo. The sign-in provider keeps its own account record, which Valo's deletion does not yet reach.",
    consent: null,
    tables: ["valo_workspaces", "valo_memberships"],
  },
  {
    id: "business_profile",
    title: "Your business profile",
    purpose:
      "To tailor the requirements check and your documents to your business, and to keep each earlier version of the profile.",
    basis: "contract",
    basisReason: "Needed to give you the requirements check and documents you ask for.",
    data: [
      "your business's name, legal form, registration status and activities",
      "its state and local government area, number of employees and turnover band",
      "whether it handles personal data, imports or manufactures",
      "your choice about marketing messages",
      "each change to your choices about marketing messages and reminders, with the version of this notice in force",
    ],
    subjects: ["account holders", "sole traders whose business details are about them"],
    staff: null,
    services: ["Replit"],
    retention:
      "Kept while your account is open, with every earlier version. A verified deletion request removes them.",
    consent: null,
    tables: ["valo_profile_versions", "valo_consent_changes"],
  },
  {
    id: "documents",
    title: "Your documents and their files",
    purpose:
      "To let you make, edit, keep and download your documents, and to tell you when a template they came from changes.",
    basis: "contract",
    basisReason: "Needed to give you the documents you make.",
    data: [
      "what you write in your documents, and every saved version",
      "the details of other people your documents name, such as employees or customers",
      "the Word and PDF files made from them",
      "the templates you save, and notices about their editions",
    ],
    subjects: ["account holders", "people named in their documents"],
    staff: null,
    services: ["Replit"],
    retention:
      "Kept while your account is open, until you delete them. The Word and PDF files Valo makes for you to download are kept at Valo only until their retention date; a copy you have saved stays yours. A verified deletion request removes your documents from Valo.",
    consent: null,
    tables: [
      "valo_documents",
      "valo_document_revisions",
      "valo_saved_templates",
      "valo_file_assets",
      "valo_export_jobs",
      "valo_export_objects",
      "valo_export_requests",
      "valo_edition_notices",
    ],
  },
  {
    id: "requirements_check",
    title: "The requirements check and your tasks",
    purpose:
      "To show which requirements may apply to your business, keep the results you save, and track the tasks you make from them.",
    basis: "contract",
    basisReason: "Needed to give you the requirements check you ask for.",
    data: [
      "your answers to the requirements check and its results",
      "your tasks, their dates and their state",
      "notices about rule changes and corrections that affect your results",
    ],
    subjects: ["account holders"],
    staff: null,
    services: ["Replit"],
    retention: "Kept while your account is open. A verified deletion request removes them.",
    consent: null,
    tables: ["valo_assessments", "valo_tasks", "valo_rule_notices", "valo_correction_notices"],
  },
  {
    id: "reminders",
    title: "Reminder emails",
    purpose: "To email you before a task you made is due, only if you turn reminders on.",
    basis: "consent",
    basisReason: "Optional. You turn reminders on and off, and nothing else depends on them.",
    data: [
      "your reminder setting and the days before a due date you chose",
      "the reminders waiting to be sent",
    ],
    subjects: ["account holders"],
    staff: null,
    services: ["Replit", "Resend, through Replit Connectors"],
    retention:
      "Your setting is kept while your account is open. Reminders are not yet sent to real addresses: only test mail goes out, to one test address.",
    consent: "Turning reminders on in your workspace.",
    tables: ["valo_reminder_preferences", "valo_reminder_outbox"],
  },
  {
    id: "orders",
    title: "Orders and payments",
    purpose:
      "To sell premium templates, record what you bought and its terms, and handle refunds, disputes and payment concerns.",
    basis: "contract",
    basisReason:
      "Needed to sell you what you buy. Keeping the record of a sale afterwards may also be a legal obligation, which the privacy owner has not yet decided.",
    data: [
      "what you ordered, its price and terms, and its reference",
      "your email address, sent to the payment provider at checkout",
      "the payment provider's reports of each payment, refund and dispute",
      "what you tell Valo about a payment concern",
    ],
    subjects: ["buyers"],
    staff: "Finance staff, for refunds, disputes and reconciliation.",
    services: ["Paystack", "Replit"],
    retention:
      "Kept, including after a deletion request, until the owner decides how long financial records are kept. The owner has not decided. Payments run in test mode only.",
    consent: null,
    tables: [
      "valo_orders",
      "valo_payment_events",
      "valo_entitlements",
      "valo_purchase_outbox",
      "valo_refund_requests",
      "valo_refund_transitions",
      "valo_payment_disputes",
      "valo_dispute_information",
      "valo_dispute_actions",
      "valo_dispute_transitions",
      "valo_payment_reconciliations",
      "valo_payment_concerns",
      "valo_payment_concern_events",
      "valo_concern_messages",
    ],
  },
  {
    id: "ai_drafting",
    title: "The drafting assistant",
    purpose:
      "To suggest wording for a document, only when you ask for it and agree to the inputs being sent.",
    basis: "consent",
    basisReason: "Optional. You choose it for each request, and you can make every document without it.",
    data: [
      "the answers you choose to send with a request",
      "the suggestion that comes back",
      "how much the request cost",
    ],
    subjects: ["account holders", "people named in the answers they send"],
    staff: null,
    services: ["OpenAI, through Replit AI Integrations", "Replit"],
    retention:
      "Not decided by the owner. No customer request reaches a model yet: none is approved. The AI provider's own retention has not been assessed.",
    consent: "Your agreement for each drafting request.",
    tables: ["valo_ai_drafts", "valo_inference_budget_events"],
  },
  {
    id: "support",
    title: "Support",
    purpose:
      "To answer your questions, including from someone who cannot sign in, and to let support staff see what you agree to share.",
    basis: "contract",
    basisReason:
      "Needed to answer you. Staff see your workspace's content only with your consent to share it, which you can refuse.",
    data: [
      "your messages and Valo's replies",
      "the contact email of someone who cannot sign in",
      "what you agree to share with support staff, and the version of that agreement",
    ],
    subjects: ["account holders", "people who contact Valo without an account"],
    staff: "Support staff, and content staff for a problem with content.",
    services: ["Replit"],
    retention:
      "Kept while your account is open. A verified deletion request replaces the words of your messages; the case and its record are kept.",
    consent: null,
    tables: [
      "valo_support_tickets",
      "valo_support_cases",
      "valo_support_messages",
      "valo_support_actions",
      "valo_support_events",
      "valo_support_escalations",
      "valo_access_support",
    ],
  },
  {
    id: "privacy_requests",
    title: "Your privacy requests",
    purpose:
      "To handle your requests to see, download, correct or delete your data, and to show later that each was handled.",
    basis: "legal_obligation",
    basisReason: "The Nigeria Data Protection Act 2023 gives you these rights, and Valo must answer them.",
    data: [
      "your request, its messages and its steps",
      "the download prepared for you",
      "a minimal record that an erasure took place",
    ],
    subjects: ["account holders"],
    staff: "Privacy staff, who handle each request.",
    services: ["Replit"],
    retention:
      "The data download prepared for you is kept at Valo only until its retention date; a copy you have saved stays yours. A minimal record of each erasure is kept to show it happened, until the owner decides how long.",
    consent: null,
    tables: [
      "valo_privacy_cases",
      "valo_privacy_events",
      "valo_privacy_messages",
      "valo_privacy_tombstones",
      "valo_privacy_erasure_objects",
      "valo_workspace_exports",
      "valo_workspace_export_attempts",
    ],
  },
  {
    id: "security",
    title: "Security and abuse prevention",
    purpose:
      "To keep each workspace's data apart, limit repeated requests, and notice and investigate misuse.",
    basis: "legitimate_interests",
    basisReason: "Needed to protect your data and the service. It is limited to what keeps the service safe.",
    data: [
      "a record of what happens in your workspace",
      "counts of recent requests",
      "security events, which record a checksum in place of who was involved",
      "the keys that keep each workspace's data apart",
    ],
    subjects: ["account holders", "visitors"],
    staff: "System staff, to investigate a security event.",
    services: ["Replit"],
    retention: "Not decided by the owner. Request counts expire within minutes.",
    consent: null,
    tables: ["valo_events", "valo_rate_buckets", "valo_security_signals", "valo_scope_keys"],
  },
  {
    id: "staff",
    title: "Valo's staff and the record of their work",
    purpose:
      "To give each member of staff only the access their role needs, and to record what they read, change, check and release.",
    basis: "legitimate_interests",
    basisReason: "Needed to run Valo safely and to show who did what.",
    data: [
      "each member of staff's sign-in identifier and roles",
      "what they read in customers' areas, and why",
      "the checks, sign-offs, notes, prices, settings and releases they record",
    ],
    subjects: ["Valo's staff"],
    staff: "System staff, and the owner.",
    services: ["Clerk", "Replit"],
    retention:
      "Kept as the record of Valo's work. It is never changed or removed. The owner has not decided a period.",
    consent: null,
    tables: [
      "valo_staff_assignments",
      "valo_staff_access_audit",
      "valo_staff_role_changes",
      "valo_acceptance_reviews",
      "valo_acceptance_runs",
      "valo_safety_control_audit",
      "valo_safety_switches",
      "valo_manual_regulatory_checks",
      "valo_manual_library",
      "valo_manual_withdrawals",
      "valo_manual_changes",
      "valo_manual_holds",
      "valo_manual_hold_lifts",
      "valo_manual_reviews",
      "valo_reviewed_guide_checks",
      "valo_rule_owner_signoffs",
      "valo_rule_changes",
      "valo_source_register",
      "valo_source_review_notes",
      "valo_source_review_preparations",
      "valo_source_impacts",
      "valo_publication_audit",
      "valo_price_changes",
      "valo_bundle_changes",
      "valo_commercial_setting_changes",
    ],
  },
];

/**
 * Tables that hold no personal data, each with why: Valo's own content, official sources, prices and
 * settings, and the machinery around them. A table with a column naming a person or a workspace never
 * belongs here (the inventory's test checks it).
 */
export const tablesWithoutPersonalData: Readonly<Record<string, string>> = {
  valo_commerce_versions: "which content versions can be sold",
  valo_prices: "template prices and their terms",
  valo_bundles: "bundles of templates and their prices",
  valo_commercial_settings: "Valo's commercial settings",
  valo_publication_policies: "Valo's publication policies",
  valo_content_versions: "Valo's templates and guides",
  valo_prepared_candidates: "content candidates awaiting their reviews",
  valo_publication_ai_attempts: "AI review attempts on Valo's own content",
  valo_editorial_runs: "AI runs on Valo's own content",
  valo_source_watches: "official sources the daily check reads",
  valo_source_check_jobs: "the daily source check's work",
  valo_source_snapshots: "copies of official sources",
  valo_source_release_bindings: "which copies a release rests on",
  valo_source_review_work: "content to review after a source changed",
  valo_source_dependency_jobs: "the work of finding what depends on a source",
  valo_rule_releases: "the requirements check's rules",
  valo_inference_budgets: "Valo's AI budget allocations",
  valo_history_digests: "checksums of the audit histories",
  valo_history_checks: "checks of those checksums",
};
