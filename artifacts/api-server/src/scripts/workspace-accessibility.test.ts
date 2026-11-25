import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { expect, type Page } from "@playwright/test";
import * as api from "@workspace/api-zod";
import { sha256 } from "@workspace/valo-core";
import { parseFormText } from "@workspace/valo-core/form-text";
import { DRAFT_NOTICE } from "@workspace/valo-core/printed-page";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { emptyFormData, formDocumentContent } from "@workspace/valo-core/guided-runtime-v2";
import { GUIDED_SPECS_V2 } from "@workspace/valo-core/guided-specs-v2";
import type { GuidedDataV2 } from "@workspace/valo-core/guided-v2";
import {
  compileGuidedContent,
  emptyGuidedData,
  guidedDataFromBlocks,
} from "@workspace/valo-core/guided-runtime";
import { GUIDED_SPECS_V1 } from "@workspace/valo-core/guided-specs";
import {
  menuProblems,
  phoneProblems,
  ready,
  settled,
  startApp,
  wcagFailures,
  type Api,
} from "../test-support/app-in-browser";
import { proposedFormText } from "../modules/manual-library/form-text-maps";
import { oldWordsIn } from "../test-support/old-words";
import { answers as publicAnswers } from "../test-support/public-answers";
import { everyAnswer } from "../test-support/complete-answers";

/**
 * NFR-006: "WCAG 2.2 AA target across critical flows; keyboard, visible focus, screen-reader labels,
 * errors and reflow", checked by "Automated checks plus manual keyboard and assistive-technology
 * review".
 *
 * The web app signed in, on an emulated phone. The compiled app cannot sign in here: the identity
 * provider's script cannot load in a test. So the app is bundled with a stand-in for the identity
 * library that reports one signed-in synthetic account. Everything else is the app's own code, from
 * its routes and account boundary to each screen, styled with its compiled CSS. The API is answered
 * in the page with synthetic data its contract's schemas accept. The automated check is axe-core
 * with the WCAG 2.0, 2.1 and 2.2 A and AA rules. It is not a manual or assistive-technology review,
 * and it does not check the identity provider's own sign-in and account widgets.
 */
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp("signed-in");
});
after(() => app.close());

const WORKSPACE = "00000000-0000-4000-8000-000000000001",
  DOCUMENT = "00000000-0000-4000-8000-00000000d001",
  ASSESSMENT = "00000000-0000-4000-8000-00000000a001",
  DRAFT = "00000000-0000-4000-8000-00000000e001",
  TASK = "00000000-0000-4000-8000-00000000c001";
const at = (day: number) => new Date(Date.UTC(2026, 10, day, 9)).toISOString();
const profile = {
  businessName: "Synthetic Trading Ltd",
  legalForm: "limited_company",
  registrationStatus: "registered",
  activities: ["Retail of household goods"],
  state: "Lagos",
  lga: "Ikeja",
  employees: "4",
  turnoverBand: "under_5m",
  turnoverYear: "2025",
  turnoverMetric: "gross_revenue",
  turnoverCurrency: "NGN",
  premises: "yes",
  manufacturing: "no",
  importing: "no",
  personalData: "yes",
  marketingConsent: false,
} as const;
const content = {
  fields: {
    issuerName: "Synthetic Trading Ltd",
    recipientName: "Synthetic Customer Enterprises",
    documentNumber: "INV-0007",
    issueDate: "2026-11-18",
    dueDate: "2026-12-02",
    notes: "Synthetic test fixture.",
  },
  blocks: [{ id: "section-1", type: "paragraph", text: "Supply of synthetic goods, as agreed.", rows: [] }],
  selectedClauses: [],
  financialInput: {
    kind: "invoice",
    lines: [
      { description: "Synthetic item", quantity: "2", unitPriceKobo: "150000" },
      { description: "Synthetic delivery", quantity: "1", unitPriceKobo: "50000" },
    ],
    taxAmountKobo: null,
    taxLabel: "VAT",
    discountKobo: null,
    amountDueKobo: null,
  },
  formatting: { font: "sans", accent: "forest" },
} as const;
const document = (revision: number) => ({
  revisionId: `00000000-0000-4000-8000-00000000f00${revision}`,
  id: DOCUMENT,
  title: "Synthetic invoice",
  revision,
  content,
  contentHash: String(revision).repeat(64),
  createdAt: at(16),
  updatedAt: at(16 + revision),
  status: "business_draft",
  templateVersion: null,
  form: null,
});
const task = (n: number, state: "not_started" | "in_progress" | "completed_by_user" | "needs_review") => ({
  id: TASK.slice(0, -1) + n,
  title: `Synthetic task ${n}`,
  notes: "Synthetic test fixture.",
  state,
  revision: 1,
  dueDate: `2026-12-0${n}`,
  dateConfirmed: n % 2 === 1,
  assessmentId: null,
  ruleId: null,
  needsReview: state === "needs_review",
  createdAt: at(10),
  updatedAt: at(12),
});
const tasks = [task(1, "not_started"), task(2, "in_progress"), task(3, "needs_review")];
const assessment = {
  id: ASSESSMENT,
  profileRevision: 3,
  facts: {
    legalForm: "limited_company",
    registrationStatus: "registered",
    activities: ["retail"],
    state: "Lagos",
    lga: "Ikeja",
    employees: "4",
    turnoverBand: "under_5m",
    turnoverYear: "2025",
    turnoverMetric: "gross_revenue",
    turnoverCurrency: "NGN",
    premises: "yes",
    manufacturing: "no",
    importing: "no",
    personalData: "yes",
  },
  result: {
    schemaVersion: "checker-result-v1",
    asOfDate: "2026-11-18",
    rulesetVersion: "synthetic-ruleset",
    items: [
      {
        ruleId: "SYNTHETIC-RULE-1",
        ruleVersion: 1,
        requirementVersionId: "synthetic-requirement",
        title: "Synthetic rule, not a released rule",
        label: "May apply",
        reason: "Synthetic test fixture reason.",
        missingFacts: ["employees"],
        matchedFacts: ["legalForm"],
        nextStep: "Synthetic test fixture next step.",
        jurisdiction: { level: "federal" },
        sources: [
          {
            id: "synthetic-source",
            url: "https://example.test/synthetic-source",
            title: "Synthetic source",
            locator: "Section 1",
            quote: "Synthetic quotation, not an official source.",
            snapshotHash: "b".repeat(64),
          },
        ],
        relatedTemplateIds: [],
      },
    ],
    unanswered: [],
    gaps: ["Synthetic coverage gap."],
    recommendedTemplateIds: [],
    officialRoutes: [{ title: "Synthetic official route", url: "https://example.test/route" }],
    notice: "Synthetic test fixture; not legal advice.",
    sourceBackedRecommendations: 1,
    resultHash: "c".repeat(64),
  },
  createdAt: at(18),
};
const privacyCase = {
  id: "00000000-0000-4000-8000-00000000b001",
  workspaceId: WORKSPACE,
  reference: "PRV-SYNTH-1",
  kind: "export",
  message: "Synthetic privacy request.",
  status: "verified",
  version: 2,
  assigned: false,
  verifiedAt: at(15),
  resultAvailable: false,
  resultScope: "Synthetic scope.",
  createdAt: at(14),
  updatedAt: at(15),
} as const;

/** Synthetic answers, each checked against the contract's schema, keyed by method and API path. */
const answers: Record<string, unknown> = {
  // The workspace's support requests page (WRK-001) lists the customer's own requests.
  "GET /workspace/support-cases": api.ListCustomerSupportCasesResponse.parse({
    cases: [],
    page: 1,
    pageSize: 25,
    hasMore: false,
    notice: "Synthetic test fixture: a note in the server's own words.",
  }),
  [`GET /workspace`]: api.GetWorkspaceResponse.parse({
    id: WORKSPACE,
    profileRevision: 3,
    profile,
    documentCount: 1,
  }),
  [`GET /workspace/documents`]: api.ListDocumentsResponse.parse([document(3)]),
  // The document's template has a newer version, so the editor and the list show their notice and mark
  // (docs/architecture/editions.md).
  [`GET /workspace/document-editions`]: api.ListDocumentEditionsResponse.parse({
    items: [
      {
        documentId: DOCUMENT,
        title: "Synthetic invoice",
        version: 1,
        state: "replaced",
        since: "2026-11-25T09:00:00.000Z",
        reason: null,
        current: { version: 2, href: "/library/manual-00000000-0000-4000-8000-00000000a201" },
      },
    ],
  }),
  // No template's wording is released for its form: every document starts with its questions.
  [`GET /workspace/form-templates`]: api.ListFormTemplatesResponse.parse({
    templates: [],
    needsPurchase: [],
  }),
  [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(document(3)),
  [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([
    document(3),
    document(2),
  ]),
  [`GET /workspace/assessments`]: api.ListAssessmentsResponse.parse([assessment]),
  [`GET /workspace/assessments/${ASSESSMENT}`]: api.GetAssessmentResponse.parse(assessment),
  [`GET /workspace/ai-usage`]: api.GetCustomerAIUsageResponse.parse({
    enabled: false,
    workspaceUsed: 0,
    workspaceDailyLimit: 0,
    minuteLimit: 0,
    globalAvailable: false,
    manualFallbackAvailable: true,
    policyNotice: "Synthetic test fixture: AI drafting is not enabled.",
  }),
  [`GET /workspace/ai-drafts/${DRAFT}`]: api.GetCustomerAIDraftResponse.parse({
    id: DRAFT,
    task: "invoice",
    status: "manual_fallback",
    title: "Synthetic invoice draft",
    content,
    missingFields: [],
    limitations: ["Synthetic test fixture limitation."],
    modelUsed: null,
    providerCalls: 0,
    inputHash: "d".repeat(64),
    previewHash: "e".repeat(64),
    acceptedDocumentId: null,
  }),
  [`GET /workspace/tasks/page`]: api.ListTasksPageResponse.parse({
    items: tasks,
    total: tasks.length,
    openCount: tasks.length,
    filteredTotal: tasks.length,
    page: 1,
    pageSize: 20,
    hasNext: false,
  }),
  [`GET /workspace/tasks`]: api.ListTasksResponse.parse(tasks),
  [`GET /workspace/reminder-preferences`]: api.GetReminderPreferencesResponse.parse({
    enabled: true,
    offsets: [7, 1],
    revision: 1,
    timezone: "Africa/Lagos",
    deliveryAvailable: false,
    deliveryBlocker: "Synthetic test fixture: email delivery is not configured.",
  }),
  [`GET /workspace/reminders`]: api.ListRemindersResponse.parse([
    {
      id: "00000000-0000-4000-8000-00000000c101",
      taskId: tasks[0]!.id,
      scheduledAt: at(25),
      status: "held",
      attempts: 0,
      nextAttemptAt: null,
      lastAttemptAt: null,
      reason: "Synthetic test fixture.",
      deliveredAt: null,
    },
  ]),
  [`GET /workspace/purchases`]: api.GetCustomerPurchasesResponse.parse({
    ownedDownloads: [],
    available: true,
    message: "Synthetic test fixture: payments run in test mode only.",
    livePaymentsEnabled: false,
    orders: [
      {
        id: "00000000-0000-4000-8000-00000000a101",
        reference: "ORD-SYNTH-1",
        title: "Synthetic premium template",
        amountKobo: 250000,
        currency: "NGN",
        status: "verified_success",
        createdAt: at(12),
        lastCheckedAt: at(12),
        licenceVersion: "synthetic-licence-v1",
        licenceText: "Synthetic licence text.",
        taxTreatment: "Synthetic tax treatment.",
        contentVersionId: "00000000-0000-4000-8000-00000000a201",
        refundStatus: null,
        receiptReference: "RCT-SYNTH-1",
        refunds: [],
        refundableKobo: 250000,
        refundedKobo: 0,
        refundPolicy: "Synthetic refund policy.",
        disputeStatus: null,
      },
    ],
    products: [],
  }),
  [`GET /workspace/data-exports`]: api.ListWorkspaceDataExportsResponse.parse({
    items: [],
    nextCursor: null,
  }),
  [`GET /workspace/privacy-cases`]: api.ListPrivacyCasesResponse.parse([privacyCase]),
  [`GET /workspace/account`]: api.GetCustomerAccountResponse.parse({
    workspaceId: WORKSPACE,
    privacyRequests: [{ reference: "PRV-SYNTH-1", request: "export", status: "verified", createdAt: at(14) }],
  }),
  "GET /public/coverage": publicAnswers["GET /public/coverage"],
  // The rules the requirements check uses, one of each kind, so that all their questions are drawn.
  "GET /checker/questions": publicAnswers["GET /checker/questions"],
  "GET /admin/manual-library": api.ListManualLibraryResponse.parse({
    items: [
      {
        itemId: "00000000-0000-4000-8000-00000000a601",
        title: "Synthetic regulatory draft",
        kind: "regulatory_article",
        version: 1,
        state: "draft",
        industry: null,
      },
    ],
    hasMore: false,
  }),
  "GET /admin/manual-library/retained": api.ListRetainedDraftsResponse.parse({
    items: [
      {
        retainedId: "TPL-01",
        kind: "template",
        title: "Synthetic invoice template",
        industry: null,
        itemId: null,
        state: "not_in_library",
        version: null,
        liveVersion: null,
        shown: false,
        sourceCheck: null,
        formText: "proposed",
        details: "proposed",
      },
      {
        retainedId: "GUD-01",
        kind: "regulatory_article",
        title: "Synthetic regulatory draft",
        industry: null,
        itemId: "00000000-0000-4000-8000-00000000a601",
        state: "draft",
        version: 1,
        liveVersion: null,
        shown: false,
        sourceCheck: { checkedAt: at(18), holds: 1, validThrough: null },
        formText: null,
        details: null,
      },
    ],
    notInLibrary: 1,
    published: 0,
    shown: 0,
  }),
  [`GET /admin/operations`]: (query: URLSearchParams) =>
    api.GetStaffOperationsResponse.parse({
      area: query.get("area"),
      notice: "Synthetic test fixture.",
      records:
        query.get("area") === "support"
          ? [
              {
                reference: "SUP-SYNTH-1",
                category: "account_access",
                status: "open",
                createdAt: at(17),
                message: "Synthetic support request.",
              },
            ]
          : [],
      ...(query.get("area") === "content"
        ? {
            preparedCandidates: [
              {
                artifactId: "00000000-0000-4000-8000-00000000a301",
                artifactHash: "a".repeat(64),
                versionId: "00000000-0000-4000-8000-00000000a302",
                templateId: "TPL-12",
                version: 1,
                preparedAt: at(18),
                reviewBy: at(30),
                state: "awaiting_reviews",
                savedStatus: null,
              },
            ],
          }
        : {}),
    }),
  [`GET /admin/source-controls`]: (query: URLSearchParams) =>
    api.GetSourceControlsResponse.parse({
      area: query.get("area"),
      page: 1,
      hasMore: false,
      notice: "Synthetic test fixture.",
      versions: [
        {
          kind: "content",
          id: "00000000-0000-4000-8000-00000000a401",
          key: "TPL-07",
          version: 1,
          status: "held",
          reviewBy: at(28),
          safetyHeld: true,
        },
      ],
      sources: [
        {
          sourceId: "synthetic-source",
          url: "https://example.test/synthetic-source",
          risk: "high",
          checkedAt: at(18),
          failureCode: null,
          nextCheckAt: at(19),
        },
      ],
      review: [],
      services: [
        { key: "publication", enabled: false, reason: "Synthetic test fixture.", updatedAt: at(10) },
      ],
      sourceChoices: [{ id: "synthetic-source-2", title: "Synthetic official source" }],
    }),
  [`GET /admin/support-escalations`]: api.ListContentEscalationsResponse.parse({
    escalations: [],
    page: 1,
    pageSize: 20,
    hasMore: false,
    notice: "Synthetic test fixture.",
  }),
  [`GET /workspace/correction-notices`]: api.GetCorrectionNoticesResponse.parse({
    page: 1,
    hasMore: false,
    notices: [
      {
        id: "00000000-0000-4000-8000-00000000a501",
        entityKind: "tasks",
        entityId: tasks[2]!.id,
        message: "Synthetic correction notice: a source this task relied on changed.",
        createdAt: at(17),
      },
    ],
  }),
  // A template the workspace bought was replaced, and another it used was withdrawn, so the home lists
  // both notices (docs/architecture/editions.md, slice 3).
  [`GET /workspace/edition-notices`]: api.ListEditionNoticesResponse.parse({
    items: [
      {
        id: "00000000-0000-4000-8000-00000000a601",
        route: "library",
        title: "Synthetic service agreement",
        version: 1,
        kind: "replaced",
        replacementVersion: 2,
        reason: null,
        held: true,
        documents: 0,
        createdAt: at(18),
      },
      {
        id: "00000000-0000-4000-8000-00000000a602",
        route: "library",
        title: "Synthetic stock register",
        version: 2,
        kind: "withdrawn",
        replacementVersion: null,
        reason: "A synthetic reason the customers who used this version read.",
        held: false,
        documents: 2,
        createdAt: at(19),
      },
    ],
  }),
  [`GET /v1/exports`]: api.ListWorkspaceExportsResponse.parse([
    {
      id: "00000000-0000-4000-8000-00000000a601",
      documentId: DOCUMENT,
      documentTitle: "Synthetic invoice",
      revisionId: document(3).revisionId,
      revision: 3,
      format: "pdf",
      finished: false,
      readyAt: at(18),
      expiresAt: at(25),
      downloadUrl: "/api/v1/exports/00000000-0000-4000-8000-00000000a601/file",
      template: null,
    },
  ]),
  [`GET /v1/documents/${DOCUMENT}/exports`]: api.ListDocumentExportsResponse.parse([
    {
      id: "00000000-0000-4000-8000-00000000a601",
      documentId: DOCUMENT,
      revisionId: document(3).revisionId,
      revision: 3,
      format: "pdf",
      renderVersion: "synthetic-render",
      sourceHash: "f".repeat(64),
      finished: false,
      status: "ready",
      attempts: 1,
      errorCode: null,
      checksum: "1".repeat(64),
      size: 12345,
      downloadUrl: "/api/v1/exports/00000000-0000-4000-8000-00000000a601/file",
      expiresAt: at(25),
      createdAt: at(18),
      updatedAt: at(18),
    },
  ]),
  [`GET /workspace/saved-templates`]: api.ListSavedTemplatesResponse.parse({
    notice: "Synthetic test fixture.",
    recommendations: [],
    items: [],
  }),
  [`GET /public/recommendations`]: api.ListOperationalRecommendationsResponse.parse({
    items: [],
    total: 0,
    page: 1,
    heldTemplates: 0,
  }),
  [`GET /workspace/disputes`]: api.GetWorkspaceDisputesResponse.parse({
    concerns: [],
    notice: "Synthetic test fixture.",
  }),
  [`GET /admin/support-cases`]: api.ListStaffSupportCasesResponse.parse({
    cases: [
      {
        id: "00000000-0000-4000-8000-00000000a701",
        sourceKind: "workspace",
        reference: "SUP-SYNTH-1",
        category: "account_access",
        status: "open",
        version: 1,
        updatedAt: at(17),
        assignedTo: null,
      },
    ],
    page: 1,
    pageSize: 20,
    hasMore: false,
    notice: "Synthetic test fixture.",
  }),
  [`GET /admin/support-cases/assignees`]: api.ListSupportAssigneesResponse.parse({
    assignees: [{ identityId: "user_synthetic_support" }],
  }),
  [`GET /admin/refunds`]: api.GetFinanceRefundsResponse.parse({
    refunds: [
      {
        id: "00000000-0000-4000-8000-00000000a801",
        orderId: "00000000-0000-4000-8000-00000000a101",
        amountKobo: 250000,
        status: "requested",
        reference: "RFD-SYNTH-1",
        reason: "Synthetic refund request.",
        decisionReason: null,
        policyVersion: "synthetic-refund-policy-v1",
        version: 1,
        attempts: 0,
        createdAt: at(17),
        checkedAt: null,
        completedAt: null,
        failure: null,
      },
    ],
    disputes: [],
    policy: "Synthetic refund policy.",
  }),
  [`GET /admin/payment-concerns`]: api.GetFinancePaymentConcernsResponse.parse({
    concerns: [],
    notice: "Synthetic test fixture.",
  }),
  [`GET /admin/owner-guidance`]: api.ListOwnerGuidanceResponse.parse({
    items: [
      {
        itemId: "00000000-0000-4000-8000-00000000a902",
        version: 1,
        digest: "a".repeat(64),
        title: "Synthetic regulatory article",
        body: "An article prepared for the development owner's source check.",
        state: "draft",
        checkId: null,
        checkedAt: null,
        holds: ["The official sources still need checking."],
        sources: [],
        live: null,
      },
    ],
    hasMore: false,
  }),
  [`GET /admin/owner-rules`]: api.ListOwnerRulesResponse.parse({
    items: [
      {
        ruleId: "synthetic-owner-rule",
        title: "Synthetic checker rule",
        reason: "A synthetic reason this may matter.",
        nextStep: "A synthetic next step.",
        appliesWhen: "When legal form is company.",
        jurisdiction: "Nigeria as a whole (a federal rule).",
        validFrom: "2026-01-01",
        validTo: null,
        risk: "privacy",
        scope: "A synthetic scope.",
        limitations: "A synthetic limit.",
        assumptions: [],
        disclosure:
          "Released on the Valo development owner's sign-off after a check of its official sources; not reviewed by a Nigerian legal, tax or sector specialist",
        version: 1,
        manifestHash: "a".repeat(64),
        live: null,
        holds: ["Synthetic passage has no copy of its official source checked within the last day."],
        checks: [],
        sources: [],
        scenarios: [],
        profilesRun: 0,
        changedProfiles: 0,
      },
    ],
  }),
  [`GET /admin/staff-roles`]: api.GetStaffRoleAdministrationResponse.parse({
    assignments: [
      {
        id: "00000000-0000-4000-8000-00000000a901",
        identityId: "user_synthetic_accessibility",
        role: "system",
        active: true,
        grantMode: "permanent",
        expiresAt: null,
        version: 1,
        grantedBy: "synthetic-fixture",
        grantedAt: at(1),
        reason: "Synthetic test fixture.",
      },
    ],
    changes: [],
    notice: "Synthetic test fixture.",
  }),
  [`GET /admin/privacy-cases`]: api.ListStaffPrivacyCasesResponse.parse({
    items: [privacyCase],
    page: 1,
    total: 1,
    pageSize: 20,
  }),
};

const answer: Api = async (route, method, path, query) => {
  const found = answers[`${method} ${path}`];
  if (found === undefined) throw Error("no test answer");
  const body = typeof found === "function" ? (found as (query: URLSearchParams) => unknown)(query) : found;
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
};

/** A phone-sized page whose API calls `api` answers, by default from the fixtures. */
const phone = (path: string, api: Api = answer) => app.phone(path, api);
/** The same on a desktop-sized page. */
const desktop = (path: string, api: Api = answer) => app.desktop(path, api);

test("account security fits a two-column profile and an authenticator square at desktop and phone widths", async () => {
  const { page, close } = await desktop("/workspace/account");
  try {
    await ready(page);
    // Model the provider's card, sidebar and section width in its own cascade layer. The classes
    // from Valo's real ClerkProvider and Valo's compiled CSS still take precedence.
    await page.addStyleTag({
      content: `@layer clerk {
        .cl-userProfile-root .cl-cardBox { display: grid; width: 55rem; grid-template-columns: 13.75rem minmax(0, 1fr); }
        .cl-userProfile-root .cl-scrollBox { grid-column: -2 / -1; overflow: auto; padding: 1.25rem; }
        .cl-userProfile-root .cl-scrollBox p { width: 16.5rem; }
        .cl-userProfile-root .cl-scrollBox::before {
          content: ""; display: block; width: 12rem; aspect-ratio: 1;
          background: repeating-conic-gradient(black 0 25%, white 0 50%) 0 0 / 12px 12px;
        }
        @media (max-width: 48rem) { .cl-userProfile-root .cl-cardBox { grid-template-columns: minmax(0, 1fr); } }
      }`,
    });
    const card = page.getByTestId("account-profile").locator(".cl-cardBox");
    for (const width of [1132, 768, 708, 360, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const bounds = await card.boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `profile at ${width}px`);
      const fits = await card.locator(".cl-scrollBox").evaluate((el) => el.scrollWidth <= el.clientWidth);
      assert.ok(fits, `security controls and setup square fit at ${width}px`);
    }
  } finally {
    await close();
  }
});

/** Each signed-in screen, the title it gives the page, and for the staff screen the area shown. */
const SIGNED_IN: { path: string; title: string; area?: string }[] = [
  { path: "/workspace", title: "Your workspace" },
  { path: "/workspace/documents", title: "Your documents" },
  { path: "/workspace/documents/new", title: "New document" },
  { path: `/workspace/documents/${DOCUMENT}`, title: "Document editor" },
  { path: "/workspace/checker", title: "Check your requirements" },
  { path: "/workspace/assessments", title: "Saved results" },
  { path: `/workspace/assessments/${ASSESSMENT}`, title: "Saved result" },
  { path: "/workspace/ai", title: "Drafting assistant" },
  { path: `/workspace/ai/${DRAFT}`, title: "Draft preview" },
  { path: "/workspace/tasks", title: "Tasks" },
  { path: "/workspace/reminders", title: "Reminders" },
  { path: "/workspace/notifications", title: "Reminders" },
  { path: "/workspace/profile", title: "Business profile" },
  { path: "/workspace/purchases", title: "Purchases and licences" },
  { path: "/workspace/account", title: "Sign-in and security" },
  { path: "/workspace/privacy", title: "Your data and privacy requests" },
  { path: "/workspace/support", title: "Support requests" },
  { path: "/staff", title: "Staff operations", area: "content" },
  { path: "/staff", title: "Staff operations", area: "support" },
  { path: "/staff", title: "Staff operations", area: "finance" },
  { path: "/staff", title: "Staff operations", area: "system" },
  { path: "/staff/privacy", title: "Privacy request operations" },
];

test("on a phone, each signed-in screen names itself in the page title, fits 360 and 320 pixels, moves keyboard focus only to visible outlined elements and has no automated WCAG 2.2 AA failure", async () => {
  const problems: string[] = [];
  for (const screen of SIGNED_IN) {
    const path = screen.area ? `${screen.path} (${screen.area} area)` : screen.path;
    const { page, unknown, errors, close } = await phone(screen.path);
    try {
      const shown = await ready(page)
        .then(async () => {
          if (!screen.area) return;
          await page.getByTestId(`tab-staff-${screen.area}`).click();
          await page.locator(`[data-testid="tab-staff-${screen.area}"][aria-pressed="true"]`).waitFor();
          await settled(page);
        })
        .then(
          () => true,
          async (error: unknown) => {
            const text = (await page.evaluate("document.body.innerText")) as string;
            problems.push(
              `${path}: not ready (${String(error).split("\n")[0]}); shows: ${text.slice(0, 300).replace(/\s+/g, " ")}`,
            );
            problems.push(
              ...errors.map((e) => `${path}: page error ${e}`),
              ...unknown.map((c) => `${path}: no test answer for ${c}`),
            );
            return false;
          },
        );
      if (!shown) continue;
      const title = await page.title();
      if (title !== `${screen.title} — Valo`) problems.push(`${path}: titled "${title}"`);
      problems.push(...(await phoneProblems(page, path)));
      problems.push(...unknown.map((call) => `${path}: no test answer for ${call}`));
      problems.push(...errors.map((error) => `${path}: page error ${error}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

/** Answers from the fixtures, except these paths, which answer as given. */
const except =
  (overrides: Record<string, unknown>): Api =>
  async (route, method, path, query) => {
    const key = `${method} ${path}`;
    if (key in overrides)
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(overrides[key]),
      });
    else await answer(route, method, path, query);
  };

test("a signed-in list with nothing in it shows its empty state, with no automated WCAG 2.2 AA failure", async () => {
  const problems: string[] = [];
  const nothingSaved = {
    "GET /workspace": api.GetWorkspaceResponse.parse({
      id: WORKSPACE,
      profileRevision: 0,
      profile: null,
      documentCount: 0,
    }),
    "GET /workspace/documents": [],
    "GET /v1/exports": [],
    "GET /workspace/correction-notices": { page: 1, hasMore: false, notices: [] },
    "GET /workspace/edition-notices": { items: [] },
  };
  const empty: [string, Record<string, unknown>][] = [
    ["/workspace", nothingSaved],
    ["/workspace/documents", nothingSaved],
    [
      "/workspace/tasks",
      {
        "GET /workspace/tasks/page": api.ListTasksPageResponse.parse({
          items: [],
          total: 0,
          openCount: 0,
          filteredTotal: 0,
          page: 1,
          pageSize: 20,
          hasNext: false,
        }),
      },
    ],
    ["/workspace/assessments", { "GET /workspace/assessments": [] }],
  ];
  for (const [path, overrides] of empty) {
    const { page, unknown, errors, close } = await phone(path, except(overrides));
    try {
      await ready(page);
      if (!(await page.getByTestId("status-empty").first().isVisible()))
        problems.push(`${path}: no empty state`);
      problems.push(...(await wcagFailures(page)).failures.map((failure) => `${path} empty: ${failure}`));
      problems.push(...unknown.map((call) => `${path}: no test answer for ${call}`));
      problems.push(...errors.map((error) => `${path}: page error ${error}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

test("a signed-in screen whose data fails to load shows an alert with a retry button, with no automated WCAG 2.2 AA failure, and retrying recovers", async () => {
  const problems: string[] = [];
  for (const path of [
    "/workspace",
    "/workspace/documents",
    `/workspace/documents/${DOCUMENT}`,
    "/workspace/assessments",
    `/workspace/assessments/${ASSESSMENT}`,
    "/workspace/tasks",
    "/workspace/reminders",
    "/workspace/purchases",
    "/workspace/privacy",
    "/staff",
    "/staff/privacy",
  ]) {
    let failing = true;
    const { page, unknown, errors, close } = await phone(path, async (route, method, apiPath, query) => {
      if (failing)
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: '{"error":"Synthetic failure"}',
        });
      else await answer(route, method, apiPath, query);
    });
    try {
      const alert = page.getByTestId("status-error").first();
      await alert
        .waitFor({ state: "visible", timeout: 30_000 })
        .catch(() => problems.push(`${path}: no error alert`));
      if ((await alert.getAttribute("role").catch(() => null)) !== "alert")
        problems.push(`${path}: the error is not announced as an alert`);
      // A failure at Valo is said in words, with no status code, and offers the way to report it.
      const said = await alert.innerText().catch(() => "");
      if (/\b500\b/.test(said)) problems.push(`${path}: the alert shows a status code: ${said}`);
      const report = alert.getByRole("link", { name: "report a problem" });
      if ((await report.getAttribute("href").catch(() => null)) !== "/support")
        problems.push(`${path}: the alert does not offer the way to report a failure at Valo`);
      problems.push(...(await wcagFailures(page)).failures.map((failure) => `${path} error: ${failure}`));
      failing = false;
      for (let press = 0; press < 5 && (await page.getByTestId("button-retry").count()) > 0; press++) {
        await page.getByTestId("button-retry").first().click();
        await delay(500);
      }
      await page
        .getByTestId("status-error")
        .first()
        .waitFor({ state: "detached", timeout: 30_000 })
        .catch(() => problems.push(`${path}: retrying did not clear the error`));
      problems.push(...unknown.map((call) => `${path}: no test answer for ${call}`));
      problems.push(...errors.map((error) => `${path}: page error ${error}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

/** The workspace's five sections in the header's order: each one's name, the word under its icon on
 * the phone's bar, the address it opens, its pages as the tabs name them, and each of its screens
 * with the tab that marks it (null where a screen shows no tabs). */
const SECTIONS: {
  label: string;
  bar: string;
  href: string;
  tabs: string[];
  screens: [path: string, tab: string | null][];
}[] = [
  { label: "Home", bar: "Home", href: "/workspace", tabs: [], screens: [["/workspace", null]] },
  {
    label: "Documents",
    bar: "Documents",
    href: "/workspace/documents",
    tabs: ["Your documents", "Drafting assistant"],
    screens: [
      ["/workspace/documents", "Your documents"],
      // The page where a document starts is a page of the documents.
      ["/workspace/documents/new", "Your documents"],
      ["/workspace/ai", "Drafting assistant"],
      [`/workspace/ai/${DRAFT}`, "Drafting assistant"],
      // The editor is one document's own screen and shows no tabs.
      [`/workspace/documents/${DOCUMENT}`, null],
    ],
  },
  {
    label: "Requirements",
    bar: "Requirements",
    href: "/workspace/checker",
    tabs: ["Check requirements", "Saved results"],
    screens: [
      ["/workspace/checker", "Check requirements"],
      ["/workspace/assessments", "Saved results"],
      [`/workspace/assessments/${ASSESSMENT}`, "Saved results"],
    ],
  },
  {
    label: "Tasks",
    bar: "Tasks",
    href: "/workspace/tasks",
    tabs: ["Tasks", "Reminders"],
    screens: [
      ["/workspace/tasks", "Tasks"],
      ["/workspace/reminders", "Reminders"],
      ["/workspace/notifications", "Reminders"],
    ],
  },
  {
    label: "Business profile",
    bar: "Profile",
    href: "/workspace/profile",
    tabs: [],
    screens: [["/workspace/profile", null]],
  },
];
/** The pages about the account itself. The account menu lists them, and they belong to no section. */
const ACCOUNT: [path: string, label: string][] = [
  ["/workspace/account", "Sign-in and security"],
  ["/workspace/privacy", "Privacy and data"],
  ["/workspace/purchases", "Purchases"],
  ["/workspace/support", "Support requests"],
];

test("on a desktop, every workspace screen's header lists the five sections and marks its own, and the screen shows its section's pages as tabs with its own page marked", async () => {
  /** Opens a screen and checks the section the header marks and the tabs the screen shows. */
  const check = async (path: string, section: string | null, tabs: string[], tab: string | null) => {
    const { page, unknown, errors, close } = await desktop(path);
    try {
      await ready(page);
      const sections = page.getByRole("navigation", { name: "Workspace" }).getByRole("link");
      await expect(sections, path).toHaveText(SECTIONS.map((s) => s.label));
      for (const [index, s] of SECTIONS.entries())
        await expect(sections.nth(index), path).toHaveAttribute("href", s.href);
      await expect(
        page.locator('header nav[aria-label="Workspace"] [aria-current="page"]'),
        `${path}: the section the header marks`,
      ).toHaveText(section ? [section] : []);
      // Inside the workspace the header has the workspace's sections, not the site's pages.
      await expect(page.getByRole("navigation", { name: "Primary" }), path).toHaveCount(0);
      await expect(page.getByTestId("link-workspace-help"), path).toHaveAttribute("href", "/help");
      const shown = page.getByTestId("nav-section-pages");
      await expect(shown.getByRole("link"), `${path}: the tabs`).toHaveText(tab === null ? [] : tabs);
      if (tab !== null)
        await expect(shown.locator('[aria-current="page"]'), `${path}: the tab marked`).toHaveText([tab]);
      // At 1024 pixels, the narrowest screen with the wide header, its links still share one line.
      await page.setViewportSize({ width: 1024, height: 768 });
      const narrow = await page.evaluate<{ width: number; lines: number; wrapped: number }>(`(() => {
        const boxes = [...document.querySelectorAll('header nav[aria-label="Workspace"] a')].map((a) => a.getBoundingClientRect());
        return {
          width: document.documentElement.scrollWidth,
          lines: new Set(boxes.map((box) => Math.round(box.top))).size,
          wrapped: boxes.filter((box) => box.height > 40).length,
        };
      })()`);
      assert.deepEqual(narrow, { width: 1024, lines: 1, wrapped: 0 }, `${path} at 1024 pixels`);
      assert.deepEqual(unknown, [], `${path}: every API call has a test answer`);
      assert.deepEqual(errors, [], path);
    } finally {
      await close();
    }
  };
  for (const section of SECTIONS)
    for (const [path, tab] of section.screens) await check(path, section.label, section.tabs, tab);
  for (const [path, label] of ACCOUNT)
    await check(
      path,
      null,
      ACCOUNT.map(([, name]) => name),
      label,
    );

  // Outside the workspace a signed-in person keeps the site's own header, with a way back in.
  const { page, close } = await desktop("/checker");
  try {
    await ready(page);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Workspace" })).toHaveCount(0);
    await expect(page.getByTestId("link-workspace")).toHaveAttribute("href", "/workspace");
    await expect(page.getByTestId("nav-section-pages")).toHaveCount(0);
  } finally {
    await close();
  }
});

test("the account menu lists the account's four pages, closes with Escape, a click elsewhere or focus moving on, returns focus to its button, and leaves sign out beside it", async () => {
  const { page, errors, close } = await desktop("/workspace");
  try {
    await ready(page);
    const button = page.getByTestId("button-account-menu"),
      menu = page.getByTestId("menu-account"),
      links = menu.getByRole("link");
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeHidden();
    await expect(page.getByTestId("button-signout")).toBeVisible();

    // The keyboard opens it, moves into it and closes it.
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-expanded", "true");
    assert.equal(await button.getAttribute("aria-controls"), await menu.getAttribute("id"));
    await expect(links).toHaveText(ACCOUNT.map(([, label]) => label));
    for (const [index, [path]] of ACCOUNT.entries())
      await expect(links.nth(index)).toHaveAttribute("href", path);
    await page.keyboard.press("Tab");
    await expect(links.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute("aria-expanded", "false");

    // Tabbing past its last link closes it.
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    for (let press = 0; press <= ACCOUNT.length; press++) await page.keyboard.press("Tab");
    await expect(page.getByTestId("button-signout")).toBeFocused();
    await expect(menu).toBeHidden();

    // A click anywhere else closes it.
    await button.click();
    await expect(menu).toBeVisible();
    await page.locator("main h1").first().click();
    await expect(menu).toBeHidden();

    // Following a link opens that page, with the menu closed.
    await button.click();
    await links.nth(1).click();
    await expect(page).toHaveURL(app.origin + ACCOUNT[1]![0]);
    await expect(page.getByTestId("menu-account")).toBeHidden();
    await expect(page.getByTestId("button-account-menu")).toHaveAttribute("aria-expanded", "false");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("on a phone, the workspace's bottom bar lists the five sections with every word fitting, marks the screen's own, replaces the public pages' two buttons, and the menu lists the account's pages", async () => {
  /** The bar's links on this page, each with whether its word fits its button. */
  const fits = (page: Page) =>
    page.evaluate<boolean[]>(
      `[...document.querySelectorAll('[data-testid="workspace-bar"] a')].map((a) => a.scrollWidth <= a.clientWidth)`,
    );
  for (const section of SECTIONS) {
    const path = section.screens[0]![0];
    const { page, errors, close } = await phone(path);
    try {
      await ready(page);
      const bar = page.getByTestId("workspace-bar").getByRole("link");
      await expect(bar, path).toHaveText(SECTIONS.map((s) => s.bar));
      for (const [index, s] of SECTIONS.entries())
        await expect(bar.nth(index), path).toHaveAttribute("href", s.href);
      await expect(page.locator('[data-testid="workspace-bar"] [aria-current="page"]'), path).toHaveText([
        section.bar,
      ]);
      await expect(page.getByTestId("mobile-dock"), path).toHaveCount(0);
      assert.deepEqual(await fits(page), [true, true, true, true, true], `${path} at 360 pixels`);
      await page.setViewportSize({ width: 320, height: 640 });
      await delay(300);
      assert.deepEqual(await fits(page), [true, true, true, true, true], `${path} at 320 pixels`);
      assert.deepEqual(errors, [], path);
    } finally {
      await close();
    }
  }

  // An account page is in no section. The menu has what the wide header has beside the sections:
  // help, the account's pages and sign out. The site's own pages are not in it, so "Documents"
  // names one place on the screen.
  const account = await phone(ACCOUNT[0]![0]);
  try {
    await ready(account.page);
    await expect(account.page.locator('[data-testid="workspace-bar"] [aria-current="page"]')).toHaveCount(0);
    await account.page.getByRole("button", { name: "Open menu" }).tap();
    const menu = account.page.getByRole("navigation", { name: "Mobile" }).getByRole("link");
    await expect(menu).toHaveText(["Help"]);
    await expect(menu).toHaveAttribute("href", "/help");
    const accountPages = account.page.getByRole("navigation", { name: "Account" });
    await expect(accountPages.getByRole("link")).toHaveText(ACCOUNT.map(([, label]) => label));
    for (const [index, [path]] of ACCOUNT.entries())
      await expect(accountPages.getByRole("link").nth(index)).toHaveAttribute("href", path);
    await expect(accountPages.locator('[aria-current="page"]')).toHaveText([ACCOUNT[0]![1]]);
    await expect(account.page.getByTestId("button-signout-menu")).toBeVisible();
    assert.deepEqual(account.errors, []);
  } finally {
    await account.close();
  }

  // Outside the workspace the public pages' two buttons are back, and there is no workspace bar.
  const outside = await phone("/checker");
  try {
    await ready(outside.page);
    await expect(outside.page.getByTestId("workspace-bar")).toHaveCount(0);
    // Signed in, the first button names the documents screen and opens it.
    await expect(outside.page.getByTestId("link-dock-documents")).toHaveText("Your documents");
    await expect(outside.page.getByTestId("link-dock-documents")).toHaveAttribute(
      "href",
      "/workspace/documents",
    );
    await expect(outside.page.getByTestId("link-dock-compliance")).toHaveText("Check requirements");
  } finally {
    await outside.close();
  }
});

test("the phone's opened menu fits a short screen and a phone on its side: every control in it comes to rest on screen and clear of the bottom bar", async () => {
  const problems: string[] = [];
  // Signed in, the menu is at its longest on a public screen: the site's five pages, the workspace,
  // the account's four pages and sign out. Inside the workspace it has help, those pages and sign out.
  for (const path of ["/checker", "/workspace/account", "/workspace"]) {
    const { page, errors, close } = await phone(path);
    try {
      await ready(page);
      problems.push(...(await menuProblems(page, path)));
      problems.push(...errors.map((error) => `${path}: page error ${error}`));
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

test("the requirements check fills in from the business profile at once while the customer has given no answer of their own, says that it did, keeps to the screen's width with its steps ticked, and asks before it replaces answers they gave", async () => {
  for (const [kind, open] of [
    ["phone", phone],
    ["desktop", desktop],
  ] as const) {
    // The check's own questions alone, which the profile answers: no rule asks more of these steps.
    const { page, errors, close } = await open(
      "/workspace/checker",
      except({ "GET /checker/questions": { asOfDate: "2026-11-18", rules: [] } }),
    );
    try {
      await ready(page);
      const fill = page.getByTestId("button-prefill");
      const dialog = page.locator("dialog[open]");
      const status = page.getByTestId("status-filled-in");
      const company = page.getByTestId("radio-legalForm-limited_company");
      const partnership = page.getByTestId("radio-legalForm-partnership");
      await expect(fill).toHaveText("Fill in from my business profile");
      await expect(status).toHaveText("");
      await expect(page.locator('#checker-step input[type="radio"]:checked')).toHaveCount(0);

      await fill.click();
      await expect(dialog).toHaveCount(0);
      await expect(company).toBeChecked();
      await expect(page.getByTestId("radio-registrationStatus-registered")).toBeChecked();
      await expect(status).toHaveText("Filled in from your business profile.");
      await expect(fill).toHaveText("Fill in again from my business profile");
      // The profile answers every question of four steps, which ticks them. On a phone most of
      // those ticks are past the screen's edge, in the strip of steps, and must not widen the page.
      for (const index of [0, 1, 2, 4])
        await expect(page.getByTestId(`button-step-${index}`)).toContainText("(answered)");
      const width = page.viewportSize()!.width;
      assert.equal(await page.evaluate("document.documentElement.scrollWidth"), width, kind);
      await page.getByTestId("button-step-3").click();
      await expect(page.getByTestId("input-employees")).toHaveValue("4");
      await expect(page.getByTestId("radio-turnoverBand-under_5m")).toBeChecked();
      // The profile does not hold the period the figure covers: it stays untouched, not skipped.
      await expect(page.getByTestId("radio-turnoverPeriod-unanswered")).not.toBeChecked();
      await expect(page.getByTestId("button-step-3")).not.toContainText("(answered)");

      // An answer of the customer's own is asked about before the profile's answers replace it.
      await page.getByTestId("button-step-0").click();
      await partnership.locator("xpath=..").click();
      await expect(partnership).toBeChecked();
      await expect(status).toHaveText("");
      await fill.click();
      await expect(dialog).toContainText("Replace your answers?");
      await expect(dialog.getByTestId("button-keep")).toBeFocused();
      await dialog.getByTestId("button-keep").click();
      await expect(dialog).toHaveCount(0);
      await expect(partnership).toBeChecked();
      await fill.click();
      await dialog.getByTestId("button-confirm").click();
      await expect(dialog).toHaveCount(0);
      await expect(company).toBeChecked();
      await expect(status).toHaveText("Filled in from your business profile.");
      assert.deepEqual(errors, [], kind);
    } finally {
      await close();
    }
  }
});

// RUL-001: "irrelevant questions are skipped, progress is clear, and the user can return to previous answers."
test("signed in, the requirements check asks the business-name requirement's questions by the operator's form: a firm's partners, how a name is composed once there is one, and a sole proprietor's operator answered from how the business is set up", async () => {
  const sent: { facts: Record<string, unknown> }[] = [];
  const checking: Api = async (route, method, path, query) => {
    if (method !== "POST" || path !== "/workspace/checker/preview") return answer(route, method, path, query);
    sent.push(route.request().postDataJSON() as { facts: Record<string, unknown> });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(api.PreviewWorkspaceAssessmentResponse.parse(assessment.result)),
    });
  };
  const { page, errors, unknown, close } = await phone("/workspace/checker", checking);
  const choose = (id: string) => page.getByTestId(id).locator("xpath=..").click();
  try {
    await ready(page);
    const names = page.getByTestId("rule-questions-businessName");
    await expect(names.locator("h3")).toHaveText("Synthetic business-name requirement");
    await expect(page.getByTestId("rule-questions-businessName-sign-in")).toHaveCount(0);
    // Only an operator with a place of business in Nigeria that carries on business under the name
    // is asked the rest.
    await expect(names.getByTestId("radio-rich-businessName-legalForm-firm")).toHaveCount(0);
    await choose("radio-rich-businessName-hasPlaceOfBusinessInNigeria-true");
    await choose("radio-rich-businessName-carryingOnBusiness-true");
    await choose("radio-rich-businessName-legalForm-firm");
    // A firm is asked for its partners, and how the name is composed once there is a name.
    await page.locator("#rich-partners-add").click();
    await choose("radio-rich-partner-0-type-individual");
    await page.getByTestId("input-rich-partner-0-surname").fill("Okafor");
    await expect(page.getByTestId("radio-rich-naming-otherBrandAddition-true")).toHaveCount(0);
    await page.getByTestId("input-rich-businessName-businessName").fill("Okafor Ventures");
    await choose("radio-rich-naming-sameSurnameAllPartners-true");
    const { failures } = await wcagFailures(page);
    assert.deepEqual(failures, [], "the business-name questions have no automated WCAG 2.2 AA failure");
    assert.deepEqual(await phoneProblems(page, "the business-name questions"), []);
    await page.setViewportSize({ width: 360, height: 640 });
    // A sole proprietor is one individual operating under the name: that is answered from how the
    // business is set up, and the individual's names are asked in place of the partners.
    await choose("radio-legalForm-sole_proprietor");
    await expect(page.getByTestId("filled-rich-businessName-legalForm")).toContainText(
      "One individual. From your answer to ‘How is the business set up?’.",
    );
    await expect(page.locator("#rich-partners-add")).toHaveCount(0);
    await expect(page.getByTestId("input-rich-businessName-trueSurname")).toHaveCount(1);
    await page.getByTestId("button-step-5").click();
    await page.getByTestId("button-run").click();
    await page.getByTestId("assessment-result").waitFor();
    assert.equal(sent.length, 1);
    // The partners and the partners' surname question went with the firm: neither is sent.
    assert.deepEqual(sent[0]!.facts["rich"], {
      businessName: {
        hasPlaceOfBusinessInNigeria: true,
        carryingOnBusiness: true,
        legalForm: "individual",
        businessName: "Okafor Ventures",
      },
      tax: { incorporatedAsCompany: false },
    });
    assert.deepEqual(unknown, [], "every API call the page made has a test answer");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("a dialog opens in the middle of the screen and clear of its sides, on a phone and on a desktop", async () => {
  for (const [kind, open, tasks] of [
    ["phone", phone, '[data-testid="workspace-bar"] a[href="/workspace/tasks"]'],
    ["desktop", desktop, 'header nav a[href="/workspace/tasks"]'],
  ] as const) {
    const { page, errors, close } = await open("/workspace/profile");
    try {
      await ready(page);
      await page.getByTestId("input-business-name").fill("Synthetic Trading Ltd, changed");
      await page.locator(tasks).click();
      const dialog = page.locator("dialog[open]");
      await expect(dialog).toContainText("Save before leaving?");
      const box = (await dialog.boundingBox())!,
        view = page.viewportSize()!;
      assert.ok(
        Math.abs(box.x + box.width / 2 - view.width / 2) <= 1 &&
          Math.abs(box.y + box.height / 2 - view.height / 2) <= 1,
        `${kind}: the dialog is not in the middle: ${JSON.stringify(box)} of ${JSON.stringify(view)}`,
      );
      assert.ok(
        box.x >= 8 && box.y >= 8 && box.x + box.width <= view.width - 8,
        `${kind}: the dialog touches the screen's edge: ${JSON.stringify(box)}`,
      );
      await dialog.getByTestId("button-stay-editor").click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByTestId("input-business-name")).toHaveValue("Synthetic Trading Ltd, changed");
      assert.deepEqual(errors, [], kind);
    } finally {
      await close();
    }
  }
});

test("a document starts in one place: the home and the documents screen each have one button to the New document page, which starts each of the twelve everyday documents with one press, a blank one, and leads to the drafting assistant", async () => {
  // The buttons that used to start a document from these two screens are gone.
  const former = [
    "button-new-draft",
    "button-new-document",
    "select-guided-template",
    "button-start-guided",
    "link-ai-drafting",
    "link-documents-assistant",
  ];
  for (const path of ["/workspace", "/workspace/documents"]) {
    const { page, errors, close } = await desktop(path);
    try {
      await ready(page);
      const start = page.locator('main a[href="/workspace/documents/new"]');
      await expect(start).toHaveCount(1);
      await expect(start).toHaveText("New document");
      for (const id of former) await expect(page.getByTestId(id)).toHaveCount(0);
      await start.click();
      await expect(page.locator("main h1")).toHaveText("New document");
      await expect(page.locator('[data-testid^="button-start-"]')).toHaveCount(GUIDED_TEMPLATE_IDS.length);
      assert.deepEqual(errors, [], path);
    } finally {
      await close();
    }
  }

  // With nothing saved yet, the empty list leads to the same page.
  const nothingSaved = {
    "GET /workspace": api.GetWorkspaceResponse.parse({
      id: WORKSPACE,
      profileRevision: 0,
      profile: null,
      documentCount: 0,
    }),
    "GET /workspace/documents": [],
    "GET /v1/exports": [],
    "GET /workspace/correction-notices": { page: 1, hasMore: false, notices: [] },
    "GET /workspace/edition-notices": { items: [] },
  };
  for (const path of ["/workspace", "/workspace/documents"]) {
    const { page, errors, close } = await desktop(path, except(nothingSaved));
    try {
      await ready(page);
      // The documents screen has other lists with nothing in them; this is the documents' own.
      await expect(page.getByTestId("status-empty").filter({ hasText: "No documents yet" })).toHaveCount(1);
      // Still one button: the empty list's own.
      const start = page.locator('main a[href="/workspace/documents/new"]');
      await expect(start).toHaveCount(1);
      await expect(start).toHaveAttribute("data-testid", "link-first-document");
      await expect(page.getByTestId("link-all-documents")).toHaveCount(0);
      assert.deepEqual(errors, [], path);
    } finally {
      await close();
    }
  }

  // Each way to start saves a new document, named for what was chosen, and opens its editor. No
  // template's wording is released for its form here, so none is asked for.
  const created: { title: string }[] = [];
  const formStarts: unknown[] = [];
  const creating: Api = async (route, method, path, query) => {
    if (method === "POST" && path === "/workspace/form-documents") {
      formStarts.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "This template's wording is not released for its form yet. Start its questions-only form instead.",
        }),
      });
    } else if (method === "POST" && path === "/workspace/documents") {
      created.push(route.request().postDataJSON() as { title: string });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(api.CreateDocumentResponse.parse(document(1))),
      });
    } else await answer(route, method, path, query);
  };
  const { page, errors, close } = await desktop("/workspace/documents/new", creating);
  try {
    await ready(page);
    const editor = new RegExp(`/workspace/documents/${DOCUMENT}$`);
    for (const id of GUIDED_TEMPLATE_IDS) {
      const button = page.getByTestId(`button-start-${id}`);
      await expect(button).toContainText(GUIDED_SPECS_V1[id].title);
      await button.click();
      await page.waitForURL(editor);
      assert.ok(
        created.at(-1)!.title.startsWith(GUIDED_SPECS_V1[id].title),
        `${id}: ${created.at(-1)!.title}`,
      );
      await page.goBack();
      await expect(page.locator("main h1")).toHaveText("New document");
    }
    assert.equal(created.length, GUIDED_TEMPLATE_IDS.length);
    assert.deepEqual(formStarts, []);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.getByTestId("button-new-draft").click();
    await page.waitForURL(editor);
    assert.equal(created.length, GUIDED_TEMPLATE_IDS.length + 1);
    await page.goBack();
    await expect(page.getByTestId("link-ai-drafting")).toHaveAttribute("href", "/workspace/ai");
    await page.getByTestId("link-ai-drafting").click();
    await expect(page.locator("main h1")).toBeVisible();
    assert.equal(new URL(page.url()).pathname, "/workspace/ai");
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("the phone's opened menu closes when keyboard focus moves on from the header, so no control on the screen is focused under it", async () => {
  // On the home screen the first control after the header is at the top of the screen, where the
  // opened menu lies over it.
  const { page, errors, close } = await phone("/workspace");
  try {
    await ready(page);
    const button = page.getByTestId("button-menu");
    const menu = page.getByRole("navigation", { name: "Mobile" });
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toBeVisible();
    let presses = 0;
    while (presses < 40 && (await menu.isVisible())) {
      await page.keyboard.press("Tab");
      presses++;
    }
    await expect(menu).toBeHidden();
    assert.ok(presses > 3, `Tab left the menu after ${presses} presses, before going through it`);
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByTestId("link-new-document")).toBeFocused();
    // Shift+Tab goes back to the header without opening the menu again.
    await page.keyboard.press("Shift+Tab");
    await expect(menu).toBeHidden();
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

test("the New document page puts first the documents of a task chosen before signing up, starts one with a press, and shows no such section for a choice the site does not offer", async () => {
  const chosen: [start: string, task: string, documents: string[]][] = [
    ["invoice", "Send an invoice", ["TPL-01"]],
    ["hire", "Hire someone", ["TPL-17", "TPL-16"]],
    ["agreement", "Sign an agreement", ["TPL-13", "TPL-14", "TPL-15"]],
  ];
  for (const [start, task, documents] of chosen) {
    for (const open of [desktop, phone]) {
      const { page, errors, close } = await open(`/workspace/documents/new?start=${start}`);
      try {
        await ready(page);
        const section = page.getByTestId("chosen-task");
        await expect(section.locator("h2")).toHaveText(task);
        await expect(section.locator("button")).toHaveCount(documents.length);
        for (const id of documents)
          await expect(section.getByTestId(`button-start-chosen-${id}`)).toContainText(
            GUIDED_SPECS_V1[id as "TPL-01"].title,
          );
        // It comes before the full list, which still has all twelve. (4 is "the other node follows".)
        assert.ok(
          await page.evaluate(
            `!!(document.querySelector('[data-testid="chosen-task"]').compareDocumentPosition(
              document.querySelector('[data-testid="button-start-TPL-01"]')) & 4)`,
          ),
          `${start}: the chosen task comes first`,
        );
        await expect(page.locator('[data-testid^="button-start-TPL-"]')).toHaveCount(
          GUIDED_TEMPLATE_IDS.length,
        );
        assert.equal(await page.evaluate("document.documentElement.scrollWidth"), page.viewportSize()!.width);
        assert.deepEqual(errors, [], start);
      } finally {
        await close();
      }
    }
  }

  // A press on the chosen task's document starts it.
  const created: { title: string }[] = [];
  const creating: Api = async (route, method, path, query) => {
    if (method === "POST" && path === "/workspace/documents") {
      created.push(route.request().postDataJSON() as { title: string });
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(api.CreateDocumentResponse.parse(document(1))),
      });
    } else await answer(route, method, path, query);
  };
  {
    const { page, errors, close } = await desktop("/workspace/documents/new?start=hire", creating);
    try {
      await ready(page);
      await page.getByTestId("button-start-chosen-TPL-16").click();
      await page.waitForURL(new RegExp(`/workspace/documents/${DOCUMENT}$`));
      assert.equal(created.length, 1);
      assert.ok(created[0]!.title.startsWith(GUIDED_SPECS_V1["TPL-16"].title), created[0]!.title);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  }

  // Nothing chosen, "any document", or a made-up choice: the page as it is from the home screen.
  for (const address of [
    "/workspace/documents/new",
    "/workspace/documents/new?start=document",
    "/workspace/documents/new?start=nothing",
    "/workspace/documents/new?start=%2Fstaff",
  ]) {
    const { page, errors, close } = await desktop(address);
    try {
      await ready(page);
      await expect(page.getByTestId("chosen-task")).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-start-"]')).toHaveCount(GUIDED_TEMPLATE_IDS.length);
      assert.deepEqual(errors, [], address);
    } finally {
      await close();
    }
  }
});

/** The words the editor used for a document's standing, its versions and its files before they were
 * put in the customer's words. None of them is on the screen now. */
const OLD_EDITOR_WORDS = /\brev\b|\brevisions?\b|business draft|released template|\bexports?\b|\bkobo\b/i;

// EDT-003: "Support section-level text editing, undo, preview and a clear draft status."
// EDT-002's acceptance: "preview, DOCX and PDF use the same saved revision".
// EDT-005's acceptance: "final export blocks mandatory omissions or requires a deliberately
// watermarked incomplete draft".
test("the document editor shows a draft status and the saved version, lists the versions with the current one marked, previews the saved version, and makes a file only once a marked draft is asked for", async () => {
  const asked: unknown[] = [];
  const job = api.ListDocumentExportsResponse.parse(answers[`GET /v1/documents/${DOCUMENT}/exports`])[0]!;
  const making: Api = async (route, method, path, query) => {
    if (method === "POST" && path === `/v1/documents/${DOCUMENT}/exports`) {
      asked.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify(api.CreateDocumentExportResponse.parse({ ...job, status: "queued" })),
      });
    } else await answer(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, making);
  try {
    await ready(page);
    // Where the document stands, and the way back to the list it came from.
    await expect(page.getByTestId("status-doc")).toHaveText("Draft");
    await expect(page.getByTestId("text-doc-standing")).toHaveText(
      "Your own document: not a Valo template, and not reviewed.",
    );
    await expect(page.getByTestId("status-save")).toHaveText("Saved · version 3");
    await expect(page.getByTestId("link-back")).toHaveText("Your documents");
    await expect(page.getByTestId("link-back")).toHaveAttribute("href", "/workspace/documents");

    // Its versions, newest first, the current one marked and the earlier one restorable.
    const versions = page.getByTestId("card-revisions");
    await expect(versions.locator("li")).toHaveCount(2);
    await expect(page.getByTestId("row-revision-3")).toContainText("Version 3");
    await expect(page.getByTestId("row-revision-3")).toContainText("Current");
    await expect(page.getByTestId("row-revision-2")).toContainText("Version 2");
    await expect(page.getByTestId("button-restore-2")).toBeVisible();

    // Nothing is missing from this document's checked details, and the card says what that covers.
    await expect(page.getByTestId("card-missing")).toContainText("Still needed");
    await expect(page.getByTestId("card-missing")).toContainText(
      "Nothing is missing from the details Valo checks. Read the whole document before you use it.",
    );

    // A file is made only after the customer asks for a draft copy, from the saved version.
    const files = page.getByTestId("private-exports");
    await expect(files.locator("h2")).toHaveText("Download this document");
    await expect(files).toContainText("Saved version 3");
    const word = files.getByRole("button", { name: "Make a Word file", exact: true });
    const pdf = files.getByRole("button", { name: "Make a PDF file", exact: true });
    await expect(word).toBeDisabled();
    await expect(pdf).toBeDisabled();
    await files
      .getByRole("checkbox", {
        name: "I want a draft copy: marked as a draft on every page, with any missing details left as they are.",
      })
      .check();
    await expect(word).toBeEnabled();
    await pdf.click();
    await expect.poll(() => asked.length).toBe(1);
    assert.deepEqual(asked, [{ revisionId: document(3).revisionId, format: "pdf", acknowledgeDraft: true }]);
    // The file already made: its kind, version and standing, its size, and how long it can be fetched.
    await expect(files.locator("li")).toContainText("PDF · version 3 · ready");
    await expect(files.locator("li")).toContainText("13 KB");
    await expect(files.locator("li")).toContainText("You can download it until 25 Nov 2026, 10:00.");
    await expect(files.getByRole("link", { name: "Download the PDF file", exact: true })).toHaveAttribute(
      "href",
      job.downloadUrl!,
    );

    // The screen in the customer's words, while editing and in the preview of the saved version.
    const shown = async () => (await page.locator("main").innerText()).replace(/\s+/g, " ");
    assert.doesNotMatch(await shown(), OLD_EDITOR_WORDS);
    await expect(page.getByRole("tab")).toHaveText(["Edit", "Preview"]);
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    await expect(page.getByTestId("preview-doc")).toContainText("Supply of synthetic goods, as agreed.");
    // The preview prints the page the files print (docs/architecture/editor.md): the draft notice, the
    // line under the title, and the document's own details with their names, its two dates written
    // as the site writes a day, and its notes.
    await expect(page.getByTestId("preview-notice")).toHaveText(DRAFT_NOTICE);
    await expect(page.getByTestId("preview-doc")).toContainText("Valo · Saved version 3");
    await expect(page.getByTestId("preview-doc").locator("dl dt")).toHaveText([
      "Issued by",
      "Addressed to",
      "Reference number",
      "Issue date",
      "Due date",
      "Notes",
    ]);
    await expect(page.getByTestId("preview-doc").locator("dl dd")).toHaveText([
      "Synthetic Trading Ltd",
      "Synthetic Customer Enterprises",
      "INV-0007",
      "18 Nov 2026",
      "2 Dec 2026",
      "Synthetic test fixture.",
    ]);
    assert.doesNotMatch(await shown(), OLD_EDITOR_WORDS);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

/** The same document as an invoice started from its questions, with no answer given yet. */
const invoice = (revision: number) => ({
  ...document(revision),
  title: GUIDED_SPECS_V1["TPL-01"].title,
  content: compileGuidedContent(emptyGuidedData("TPL-01")),
});
const unanswered = except({
  [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(invoice(3)),
  [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([
    invoice(3),
    invoice(2),
  ]),
});

// EDT-005: "Highlight unresolved fields, inconsistent dates and missing party details."
test("an invoice started from its questions lists what it still needs by each question's own name, a table's row and column included, never by an internal key, and on a phone fits 360 and 320 pixels with no automated WCAG 2.2 AA failure", async () => {
  const spec = GUIDED_SPECS_V1["TPL-01"];
  {
    const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, unanswered);
    try {
      await ready(page);
      const questions = page.getByTestId("guided-fields");
      await expect(questions.locator("header .eyebrow")).toHaveText("Questions");
      await expect(questions.locator("header h2")).toHaveText(spec.title);
      // Every unanswered question is listed as it is asked; a table's cell names its row and column.
      const needed = await page.getByTestId("card-missing").locator("li").allInnerTexts();
      const table = spec.tables[0]!;
      assert.deepEqual(
        needed.map((line) => line.trim()),
        [
          ...spec.fields.filter((f) => f.required && !f.when).map((f) => f.label),
          // An amount is asked for in naira; the questions' definitions name it in kobo.
          ...table.columns
            .filter((c) => c.required && !c.when)
            .map((c) => `${table.label}, row 1: ${c.label.replace("whole kobo", "naira")}`),
        ],
      );
      for (const line of needed) assert.doesNotMatch(line, /:\d+:|This answer is required/);
      // A table's row is headed by its number; each answer in it is still named with its row for a
      // screen reader, and a row is added with a button that says so.
      const rows = page.getByTestId(`table-${table.id}`);
      await expect(rows.locator("legend").nth(1)).toHaveText("Row 1");
      await expect(rows.getByLabel("Description (row 1)")).toHaveCount(1);
      await expect(page.getByTestId(`button-add-${table.id}`)).toHaveText("Add a row");
      // The project's own names for the form are not shown.
      const shown = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      assert.doesNotMatch(
        shown,
        /TPL-\d+|Guided form|\brev\b|\brevisions?\b|business draft|\bexports?\b|\bkobo\b|\bNGN\b/i,
      );
      // The preview shows the note such a document starts with, among its details, as the files print
      // it, so it is in plain words and claims nothing.
      await page.getByRole("tab", { name: "Preview", exact: true }).click();
      const preview = page.getByTestId("preview-doc");
      await expect(preview).toContainText(
        "Draft made from the answers the business entered. It does not claim a professional review, a verified payment or a signature.",
      );
      assert.deepEqual(oldWordsIn(await preview.innerText()), []);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }
  const { page, errors, unknown, close } = await phone(`/workspace/documents/${DOCUMENT}`, unanswered);
  try {
    await ready(page);
    await expect(page.getByTestId("guided-fields")).toBeVisible();
    assert.deepEqual(await phoneProblems(page, "a guided invoice's editor"), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// EDT-005: "Highlight unresolved fields, inconsistent dates and missing party details."
test("a new form is not marked as wrong: each unanswered question is marked as still needed, shown as a mistake only once the customer has been to it and left it empty, and a wrong answer is shown as soon as it is given", async () => {
  const spec = GUIDED_SPECS_V1["TPL-01"];
  const sent: { title: string; content: unknown }[] = [];
  const saving: Api = async (route, method, path, query) => {
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      sent.push(route.request().postDataJSON() as { title: string; content: unknown });
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.SaveDocumentResponse.parse({ ...invoice(3 + sent.length), ...sent.at(-1), id: DOCUMENT }),
        ),
      });
    } else await unanswered(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, saving);
  try {
    await ready(page);
    const questions = page.getByTestId("guided-fields");
    const required = [
      ...spec.fields.filter((f) => f.required && !f.when).map((f) => `g-${f.id}`),
      ...spec.tables[0]!.columns.filter((c) => c.required && !c.when).map((c) => `gt-items-0-${c.id}`),
    ];
    // As it opens: nothing is outlined as wrong and no message is shown, and every required
    // question is marked as still needed, in words.
    await expect(questions.locator('[aria-invalid="true"]')).toHaveCount(0);
    await expect(questions.getByText("This answer is required.")).toHaveCount(0);
    await expect(questions.locator('[data-testid^="mark-needed-"]')).toHaveCount(required.length);
    for (const id of required) await expect(page.getByTestId(`mark-needed-${id}`)).toHaveText("Still needed");
    await expect(page.getByTestId("status-guided-issues")).toHaveText(
      `${required.length} answers need attention`,
    );

    // Going to a question and leaving it empty marks that question, and no other.
    const name = page.locator("#g-issuerName");
    await name.focus();
    await page.keyboard.press("Tab");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(questions.locator('[aria-invalid="true"]')).toHaveCount(1);
    await expect(questions.getByText("This answer is required.")).toHaveCount(1);
    assert.match((await name.getAttribute("aria-describedby")) ?? "", /g-issuerName-error/);

    // An answer clears its mark and its message. Tab had moved on to the next question, which the
    // customer has now also left empty, so that one is the question marked.
    await name.fill("Synthetic Trading Ltd");
    await expect(name).toHaveAttribute("aria-invalid", "false");
    await expect(page.getByTestId("mark-needed-g-issuerName")).toHaveCount(0);
    await expect(page.locator("#g-issuerName-error")).toHaveCount(0);
    await expect(questions.locator('[aria-invalid="true"]')).toHaveCount(1);
    await expect(questions.locator('[aria-invalid="true"]')).toHaveAttribute("id", `g-${spec.fields[1]!.id}`);

    // A wrong answer is shown at once, while the customer is still in the question.
    const quantity = page.locator("#gt-items-0-quantity");
    await quantity.fill("abc");
    await expect(quantity).toBeFocused();
    await expect(quantity).toHaveAttribute("aria-invalid", "true");
    await expect(
      questions.getByText("Enter a positive quantity with up to three decimal places."),
    ).toHaveCount(1);

    // What was typed is saved as it is, and the page asked for nothing the test did not answer.
    await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 15_000 });
    assert.ok(sent.length >= 1, "the answers were saved");
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

/**
 * The same document as an invoice started from its form (forms v2): the wording of a released
 * edition of its template, filled from its answers. The edition is synthetic; its form text is the
 * one proposed for the invoice.
 */
const EDITION = "00000000-0000-4000-8000-00000000b001";
async function formInvoice(revision: number, given: Record<string, string> = {}) {
  const spec = GUIDED_SPECS_V2["TPL-01"]!;
  const formText = (await proposedFormText("TPL-01"))!;
  const answers = emptyFormData(spec);
  answers.values = { ...answers.values, issuerName: profile.businessName, ...given };
  const { unfilled: _unfilled, ...content } = formDocumentContent(spec, parseFormText(formText), answers);
  const started = {
    ...document(revision),
    title: spec.title,
    content,
    form: { version: 2, edition: EDITION, digest: sha256(formText) },
  };
  const stubs = except({
    [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(started),
    [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([started]),
    [`GET /workspace/documents/${DOCUMENT}/form`]: api.GetDocumentFormResponse.parse({
      edition: EDITION,
      editionVersion: 1,
      title: "Invoice",
      formText,
    }),
  });
  return { spec, formText, answers, started, stubs };
}

// EDT-001: "Implement the 12 designated guided templates using typed field schemas, conditional
// questions, examples and server validation." EDT-002: "Persist a structured document with
// paragraphs, lists, tables, field values, selected clauses, formatting tokens and template version."
test("an invoice started from its form asks its questions and fills its template's own wording as they are answered: the wording is not edited directly, what is still needed is listed by question, the preview shows the wording with its header rows, and a save sends the answers with exactly the wording they make", async () => {
  const { spec, formText, started, stubs } = await formInvoice(3);
  const sent: { title: string; content: { formAnswers?: GuidedDataV2; blocks: unknown[] } }[] = [];
  const saving: Api = async (route, method, path, query) => {
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      sent.push(route.request().postDataJSON() as (typeof sent)[number]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.SaveDocumentResponse.parse({
            ...started,
            ...sent.at(-1),
            revision: 3 + sent.length,
            id: DOCUMENT,
          }),
        ),
      });
    } else await stubs(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, saving);
  try {
    await ready(page);
    const questions = page.getByTestId("guided-fields");
    await expect(questions.locator("header h2")).toHaveText(spec.title);
    // The saved business name the document started with is its answer.
    await expect(page.locator("#g-issuerName")).toHaveValue(profile.businessName);
    // The wording is the released template's: no part of it is edited directly, and the page says
    // where it comes from.
    await expect(page.getByTestId("text-form-wording")).toBeVisible();
    for (const id of ["button-add-paragraph", "button-add-list", "button-add-table", "input-block-0"])
      await expect(page.getByTestId(id)).toHaveCount(0);
    // What it still needs is listed by each question's own name, as for the questions-only form.
    const needed = await page.getByTestId("card-missing").locator("li").allInnerTexts();
    const table = spec.tables[0]!;
    assert.deepEqual(
      needed.map((line) => line.trim()),
      [
        ...spec.fields.filter((f) => f.required && !f.when && f.id !== "issuerName").map((f) => f.label),
        ...table.columns
          .filter((c) => c.required && !c.when)
          .map((c) => `${table.label}, row 1: ${c.label.replace("whole kobo", "naira")}`),
      ],
    );
    assert.deepEqual((await wcagFailures(page)).failures, []);

    // An answer fills its place in the wording, which the preview shows with its header rows. Of the
    // document's details it lists only the notes, as the files print them: the names and dates are in
    // the wording.
    await page.locator("#g-recipientName").fill("Synthetic Buyer Ltd");
    // The wording is fixed, and the line under the questions says so (docs/architecture/editor.md,
    // slice 4).
    await expect(page.getByTestId("form-wording-fixed")).toHaveText(
      "The template\u2019s wording stays as it was released. You change this document by changing your answers.",
    );
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    const preview = page.getByTestId("preview-doc");
    await expect(preview).toContainText("Bill to: Synthetic Buyer Ltd");
    // The preview marks the answer inside the wording, and the notice as Valo's.
    await expect(
      preview.getByTestId("preview-answer").filter({ hasText: "Synthetic Buyer Ltd" }),
    ).toHaveCount(1);
    await expect(preview.getByTestId("preview-notice-mark")).toHaveText(
      "Added by Valo to every page of the file. It cannot be removed.",
    );
    await expect(preview.locator("table").first().locator("thead th")).toHaveText([
      "Invoice reference",
      "Issue date",
      "Currency",
    ]);
    await expect(preview.locator("dl dt")).toHaveText(["Notes"]);
    assert.deepEqual(oldWordsIn(await preview.innerText()), []);
    assert.deepEqual((await wcagFailures(page)).failures, []);

    // The save sends the answers and exactly the wording they make from the edition, nothing more.
    await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 15_000 });
    const last = sent.at(-1)!;
    assert.equal(last.content.formAnswers?.values.recipientName, "Synthetic Buyer Ltd");
    const made = formDocumentContent(
      spec,
      parseFormText(formText),
      last.content.formAnswers!,
      started.content,
    );
    assert.deepEqual(last.content.blocks, made.blocks);
    assert.ok(!("unfilled" in last.content));
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("'Make another like this' starts an invoice made from its form through its form, with every answer but its reference and its dates, and opens it", async () => {
  const ANOTHER = "00000000-0000-4000-8000-00000000d003";
  const { formText, answers, started, stubs } = await formInvoice(3, {
    recipientName: "Synthetic Customer Enterprises",
    documentNumber: "INV-0007",
    issueDate: "2026-11-18",
    dueDate: "2026-12-02",
  });
  const another = { ...started, id: ANOTHER, revision: 1 };
  const starts: unknown[] = [];
  const created: unknown[] = [];
  const making: Api = async (route, method, path, query) => {
    const json = (status: number, body: unknown) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "POST" && path === "/workspace/form-documents") {
      starts.push(route.request().postDataJSON());
      return json(201, api.StartFormDocumentResponse.parse(another));
    }
    if (method === "POST" && path === "/workspace/documents") {
      created.push(route.request().postDataJSON());
      return json(500, {});
    }
    if (method === "GET" && path === `/workspace/documents/${ANOTHER}`)
      return json(200, api.GetDocumentResponse.parse(another));
    if (method === "GET" && path === `/workspace/documents/${ANOTHER}/revisions`)
      return json(200, api.ListDocumentRevisionsResponse.parse([another]));
    if (method === "GET" && path === `/workspace/documents/${ANOTHER}/form`)
      return json(
        200,
        api.GetDocumentFormResponse.parse({
          edition: EDITION,
          editionVersion: 1,
          title: "Invoice",
          formText,
        }),
      );
    if (method === "GET" && path === `/v1/documents/${ANOTHER}/exports`) return json(200, []);
    return stubs(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, making);
  try {
    await ready(page);
    await expect(page.getByTestId("guided-fields")).toBeVisible();
    const button = page.getByTestId("button-make-another");
    await expect(button).toBeEnabled();
    await button.click();
    await page.waitForURL(new RegExp(`/workspace/documents/${ANOTHER}$`));
    // The new document starts from the form with the saved answers, its reference and its dates
    // blank, and the saved title. It is not made as a document of its own.
    assert.deepEqual(starts, [
      {
        templateId: "TPL-01",
        title: started.title,
        formAnswers: {
          ...answers,
          values: { ...answers.values, documentNumber: "", issueDate: "", dueDate: "" },
        },
      },
    ]);
    assert.deepEqual(created, []);
    await expect(page.getByTestId("guided-fields")).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("the New document page starts the invoice as its form once its template's wording is released, and opens it, and starts it with its questions should the wording be withdrawn meanwhile", async () => {
  const { started } = await formInvoice(1);
  const created: unknown[] = [];
  let withdrawn = false;
  const starting: Api = async (route, method, path, query) => {
    if (method === "GET" && path === "/workspace/form-templates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.ListFormTemplatesResponse.parse({
            templates: [{ templateId: "TPL-01", editionVersion: 1 }],
            needsPurchase: [],
          }),
        ),
      });
    } else if (method === "POST" && path === "/workspace/form-documents") {
      assert.deepEqual(route.request().postDataJSON(), { templateId: "TPL-01" });
      await route.fulfill(
        withdrawn
          ? {
              status: 409,
              contentType: "application/json",
              body: JSON.stringify({
                error:
                  "This template's wording is not released for its form yet. Start its questions-only form instead.",
              }),
            }
          : {
              status: 201,
              contentType: "application/json",
              body: JSON.stringify(api.StartFormDocumentResponse.parse(started)),
            },
      );
    } else if (method === "POST" && path === "/workspace/documents") {
      created.push(route.request().postDataJSON());
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify(api.CreateDocumentResponse.parse(document(1))),
      });
    } else await answer(route, method, path, query);
  };
  const { page, errors, close } = await desktop("/workspace/documents/new", starting);
  try {
    await ready(page);
    await page.getByTestId("button-start-TPL-01").click();
    await page.waitForURL(new RegExp(`/workspace/documents/${DOCUMENT}$`));
    // The form document is the only document started: the questions-only one is not.
    assert.deepEqual(created, []);
    // Withdrawn after the list was read: the server refuses the form, and the invoice starts with its
    // questions, with no error shown.
    withdrawn = true;
    await page.goBack();
    await expect(page.locator("main h1")).toHaveText("New document");
    await page.getByTestId("button-start-TPL-01").click();
    await page.waitForURL(new RegExp(`/workspace/documents/${DOCUMENT}$`));
    assert.equal(created.length, 1);
    assert.deepEqual(errors, []);
  } finally {
    await close();
  }
});

// EDT-001 and DOC-005: a form fills its template's own wording, and a premium template's comes
// with the template bought (forms v2, slice 7).
test("the New document page says which documents use their template's own wording, and sends a premium template the workspace has not bought to the library to buy it, instead of starting it", async () => {
  const started: string[] = [];
  const listing: Api = async (route, method, path, query) => {
    if (method === "GET" && path === "/workspace/form-templates") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.ListFormTemplatesResponse.parse({
            templates: [
              { templateId: "TPL-01", editionVersion: 1 },
              { templateId: "TPL-17", editionVersion: 2 },
            ],
            needsPurchase: ["TPL-13", "TPL-16"],
          }),
        ),
      });
    } else if (method === "POST") {
      started.push(path);
      throw Error("nothing is started in this test");
    } else await answer(route, method, path, query);
  };
  /** The library's premium templates, searched for this template's name. */
  const library = (id: "TPL-13" | "TPL-16") =>
    `/library?type=template&access=premium&q=${encodeURIComponent(GUIDED_SPECS_V1[id].title)}`;
  for (const open of [desktop, phone]) {
    const { page, errors, unknown, close } = await open("/workspace/documents/new?start=hire", listing);
    try {
      await ready(page);
      // In the chosen task and in the full list: the offer letter uses its template's own wording;
      // the employment contract, not bought, is a link to buy it, and is not a button that starts it.
      for (const prefix of ["chosen-", ""]) {
        const offer = page.getByTestId(`button-start-${prefix}TPL-17`);
        await expect(offer.getByTestId(`state-${prefix}TPL-17`)).toHaveText(
          "Uses the template's own wording",
        );
        const buy = page.getByTestId(`link-buy-${prefix}TPL-16`);
        await expect(buy).toHaveAttribute("href", library("TPL-16"));
        await expect(buy.getByTestId(`state-${prefix}TPL-16`)).toHaveText("Buy the template first");
        await expect(buy).toContainText(GUIDED_SPECS_V1["TPL-16"].title);
        await expect(page.getByTestId(`button-start-${prefix}TPL-16`)).toHaveCount(0);
      }
      await expect(page.getByTestId("chosen-task").getByRole("link")).toHaveCount(1);
      await expect(page.getByTestId("chosen-task").getByRole("button")).toHaveCount(1);
      // In the full list, the invoice uses its template's wording too, and the service agreement is
      // to buy. Every other document starts with its questions, with no state of its own.
      await expect(page.getByTestId("state-TPL-01")).toHaveText("Uses the template's own wording");
      await expect(page.getByTestId("link-buy-TPL-13")).toHaveAttribute("href", library("TPL-13"));
      await expect(page.getByTestId("state-TPL-13")).toHaveText("Buy the template first");
      await expect(page.locator('[data-testid^="button-start-TPL-"]')).toHaveCount(
        GUIDED_TEMPLATE_IDS.length - 2,
      );
      await expect(page.locator('[data-testid^="state-"]')).toHaveCount(6);
      for (const id of GUIDED_TEMPLATE_IDS.filter(
        (id) => !["TPL-01", "TPL-13", "TPL-16", "TPL-17"].includes(id),
      ))
        await expect(page.getByTestId(`button-start-${id}`)).not.toContainText(/wording|Buy/);
      if (open === phone)
        assert.deepEqual(await phoneProblems(page, "the New document page, two to buy"), []);
      else assert.deepEqual((await wcagFailures(page)).failures, []);
      assert.deepEqual(started, []);
      assert.deepEqual(unknown, []);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  }
});

// EDT-005: "final export blocks mandatory omissions or requires a deliberately watermarked incomplete
// draft" (docs/architecture/finished-file.md).
test("a complete document's file panel offers the finished file, without the draft notice, and an incomplete or typed one says how its file is made instead", async () => {
  const complete = {
    ...document(3),
    title: GUIDED_SPECS_V1["TPL-01"].title,
    content: compileGuidedContent(everyAnswer(emptyGuidedData("TPL-01"), GUIDED_SPECS_V1["TPL-01"])),
  };
  const made = api.ListDocumentExportsResponse.parse(answers[`GET /v1/documents/${DOCUMENT}/exports`])[0]!;
  const asked: unknown[] = [];
  const finishing: Api = async (route, method, path, query) => {
    const reply = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (method === "GET" && path === `/workspace/documents/${DOCUMENT}`)
      await reply(api.GetDocumentResponse.parse(complete));
    else if (method === "GET" && path === `/workspace/documents/${DOCUMENT}/revisions`)
      await reply(api.ListDocumentRevisionsResponse.parse([complete]));
    else if (method === "GET" && path === `/v1/documents/${DOCUMENT}/exports`)
      await reply(api.ListDocumentExportsResponse.parse(asked.length ? [{ ...made, finished: true }] : []));
    else if (method === "POST" && path === `/v1/documents/${DOCUMENT}/exports`) {
      asked.push(route.request().postDataJSON());
      await reply(api.CreateDocumentExportResponse.parse({ ...made, finished: true, status: "queued" }), 202);
    } else await answer(route, method, path, query);
  };
  {
    const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, finishing);
    try {
      await ready(page);
      const files = page.getByTestId("private-exports");
      await expect(files.getByTestId("finished-file")).toContainText(
        "Nothing is missing from the details Valo checks, so saved version 3 can be made as a finished file, without the draft notice.",
      );
      // The finished file needs no draft notice confirmed; the draft copy still does.
      await expect(files.getByTestId("button-draft-pdf")).toBeDisabled();
      await files.getByRole("button", { name: "Make the finished PDF file", exact: true }).click();
      await expect.poll(() => asked.length).toBe(1);
      assert.deepEqual(asked, [{ revisionId: complete.revisionId, format: "pdf", acknowledgeDraft: false }]);
      await expect(files.locator("li")).toContainText("Finished PDF · version 3");
      assert.deepEqual((await wcagFailures(page)).failures, []);
      assert.deepEqual(unknown, []);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  }
  // An invoice with its questions unanswered, and a document typed by hand: no finished file is offered.
  for (const [doc, says] of [
    [
      invoice(3),
      "Once nothing is missing from Still needed, you can make the finished file, without the draft notice.",
    ],
    [document(3), "A document typed by hand is made as a draft copy: no questions say what it must hold."],
  ] as const) {
    const { page, errors, close } = await desktop(
      `/workspace/documents/${DOCUMENT}`,
      except({
        [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(doc),
        [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([doc]),
      }),
    );
    try {
      await ready(page);
      const files = page.getByTestId("private-exports");
      await expect(files.getByTestId("text-finished-unavailable")).toHaveText(says);
      await expect(files.locator('[data-testid^="button-finished-"]')).toHaveCount(0);
      assert.deepEqual(errors, []);
    } finally {
      await close();
    }
  }
});

// AI-003: "Preserve supplied names and amounts; mark missing facts explicitly. Calculate totals
// deterministically in application code using decimal-safe arithmetic."
test("an amount is typed in naira and saved as the same amount in whole kobo; what is not an amount stays as typed and is refused; and a saved amount is shown and printed in naira", async () => {
  const sent: { title: string; content: { blocks: Parameters<typeof guidedDataFromBlocks>[0] } }[] = [];
  const saving: Api = async (route, method, path, query) => {
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      sent.push(route.request().postDataJSON() as (typeof sent)[number]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.SaveDocumentResponse.parse({ ...invoice(3 + sent.length), ...sent.at(-1), id: DOCUMENT }),
        ),
      });
    } else await unanswered(route, method, path, query);
  };
  /** The unit price the page last saved, as the saved answers hold it. */
  const savedPrice = () => guidedDataFromBlocks(sent.at(-1)!.content.blocks)!.tables.items![0]!.unitPriceKobo;
  {
    const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, saving);
    try {
      await ready(page);
      const price = page.locator("#gt-items-0-unitPriceKobo");
      const reading = page.getByTestId("text-gt-items-0-unitPriceKobo-ngn");
      await expect(page.getByLabel("Unit price in naira, for the chosen quantity unit")).toHaveCount(1);
      await expect(reading).toHaveText("");

      // Naira, with or without separators and kobo: the same amount is saved in whole kobo.
      await price.fill("1,500.50");
      await expect(reading).toHaveText("Reads as ₦1,500.50");
      await expect(price).toHaveAttribute("aria-invalid", "false");
      await expect.poll(() => sent.length && savedPrice(), { timeout: 15_000 }).toBe("150050");
      // The box keeps what the customer typed.
      await expect(price).toHaveValue("1,500.50");

      // Not an amount: it stays as typed, is refused in words about naira, and is saved as typed.
      await price.fill("12.5x");
      await expect(price).toHaveAttribute("aria-invalid", "true");
      await expect(
        page.getByTestId("guided-fields").getByText("Enter an amount in naira, such as 1500 or 1500.50."),
      ).toHaveCount(1);
      await expect(reading).toHaveText("");
      await expect.poll(() => savedPrice(), { timeout: 15_000 }).toBe("12.5x");
      await expect(page.getByTestId("card-missing")).toContainText(
        "Goods, work and agreed charges, row 1: Unit price in naira, for the chosen quantity unit: Enter an amount in naira, such as 1500 or 1500.50.",
      );
      assert.doesNotMatch((await page.locator("main").innerText()).replace(/\s+/g, " "), /\bkobo\b/i);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }

  // A document saved with an amount: the box shows it in naira, and the document prints it with
  // the naira sign under the question's name, without the unit it is stored in.
  const data = emptyGuidedData("TPL-01");
  data.tables.items = [{ ...data.tables.items![0]!, unitPriceKobo: "150000" }];
  const priced = (revision: number) => ({ ...invoice(revision), content: compileGuidedContent(data) });
  const { page, errors, unknown, close } = await desktop(
    `/workspace/documents/${DOCUMENT}`,
    except({
      [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(priced(3)),
      [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([
        priced(3),
      ]),
    }),
  );
  try {
    await ready(page);
    await expect(page.locator("#gt-items-0-unitPriceKobo")).toHaveValue("1500");
    await expect(page.getByTestId("text-gt-items-0-unitPriceKobo-ngn")).toHaveText("Reads as ₦1,500.00");
    await page.getByRole("tab", { name: "Preview", exact: true }).click();
    const printed = page.getByTestId("preview-doc");
    await expect(printed).toContainText("Unit price, for the chosen quantity unit");
    await expect(printed).toContainText("₦1,500.00");
    assert.doesNotMatch(await printed.innerText(), /kobo|NGN/i);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// Some questions are asked only after a choice, such as a tax amount once the customer says they
// have one. When the choice is changed, their answers are kept but hidden, and the form says what
// that means for the document.
test("an answer hidden by a changed choice is said to be kept, not checked and not put in the document; the preview leaves it out; and changing the choice back shows it again", async () => {
  const data = emptyGuidedData("TPL-01");
  Object.assign(data.values, {
    taxMode: "supplied",
    taxLabel: "Synthetic levy label",
    taxAmountKobo: "75000",
    taxBasis: "Synthetic basis for the levy",
  });
  const taxed = (revision: number) => ({ ...invoice(revision), content: compileGuidedContent(data) });
  const sent: { title: string; content: { blocks: Parameters<typeof guidedDataFromBlocks>[0] } }[] = [];
  const opened = except({
    [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(taxed(3)),
    [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([taxed(3)]),
  });
  const saving: Api = async (route, method, path, query) => {
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      sent.push(route.request().postDataJSON() as (typeof sent)[number]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.SaveDocumentResponse.parse({ ...taxed(3 + sent.length), ...sent.at(-1), id: DOCUMENT }),
        ),
      });
    } else await opened(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, saving);
  try {
    await ready(page);
    const hint = page.getByTestId("text-guided-hidden");
    const label = page.locator("#g-taxLabel");
    const printed = page.getByTestId("preview-doc");
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    // With the choice made, its questions show their answers, the document prints them, and
    // nothing is said about hidden answers.
    await expect(label).toHaveValue("Synthetic levy label");
    await expect(hint).toHaveCount(0);
    await tab("Preview").click();
    await expect(printed).toContainText("Synthetic levy label");
    await expect(printed).toContainText("Synthetic basis for the levy");

    // The choice is changed: the three answers are hidden, and the form says what that means.
    await tab("Edit").click();
    await page.locator("#g-taxMode").selectOption("none");
    await expect(label).toHaveCount(0);
    await expect(hint).toHaveText(
      "3 earlier answers are kept but hidden, because a choice they depend on was changed. Hidden answers are not checked and are not put in the document. They are shown again if you change the choice back.",
    );
    // Kept: the saved document still holds them. Not put in the document: the preview does not.
    await expect
      .poll(() => sent.length && guidedDataFromBlocks(sent.at(-1)!.content.blocks)!.values.taxMode, {
        timeout: 15_000,
      })
      .toBe("none");
    assert.equal(guidedDataFromBlocks(sent.at(-1)!.content.blocks)!.values.taxLabel, "Synthetic levy label");
    await tab("Preview").click();
    await expect(printed).toContainText(GUIDED_SPECS_V1["TPL-01"].title);
    assert.doesNotMatch(await printed.innerText(), /Synthetic levy label|Synthetic basis for the levy/);

    // Changing the choice back shows them again, as they were.
    await tab("Edit").click();
    await page.locator("#g-taxMode").selectOption("supplied");
    await expect(label).toHaveValue("Synthetic levy label");
    await expect(hint).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

/** The project's words for a saved result, a version and the check, none of which the workspace's
 * screens show now. */
const OLD_WORKSPACE_WORDS = /assessment|\brev\b|\brevisions?\b|ruleset|questionnaire|snapshot|\bchecker\b/i;

// WRK-001: "Show profile, saved templates, drafts, purchases, assessment history, tasks and
// enquiries."
test("the saved results, the business profile, the tasks and the check's save panel say 'result' and 'version' in the customer's words", async () => {
  /** What a screen's own content reads, on one line. */
  const read = async (page: Page, within = "main") =>
    (await page.locator(within).innerText()).replace(/\s+/g, " ");
  const open = async (path: string, check: (page: Page) => Promise<void>, how: Api = answer) => {
    const { page, errors, unknown, close } = await desktop(path, how);
    try {
      await ready(page);
      await check(page);
      assert.deepEqual(errors, [], path);
      assert.deepEqual(unknown, [], path);
    } finally {
      await close();
    }
  };

  // The list of saved results: what each was worked out from, in words.
  await open("/workspace/assessments", async (page) => {
    await expect(page.locator("main h1")).toHaveText("Saved results");
    const row = page.getByTestId(`link-assessment-${ASSESSMENT}`);
    await expect(row).toContainText("18 Nov 2026, 10:00");
    await expect(row).toContainText("Rules as at 18 Nov 2026");
    await expect(row).toContainText("Rules version synthetic-ruleset");
    await expect(row).toContainText("From your profile, version 3");
    // The fixture's own name for its rules is left out: it happens to hold one of the old words.
    assert.doesNotMatch(
      (await read(page)).replace(assessment.result.rulesetVersion, ""),
      OLD_WORKSPACE_WORDS,
    );
  });

  // One saved result: its heading, where it came from, the way back and the comparison's words.
  await open(`/workspace/assessments/${ASSESSMENT}`, async (page) => {
    await expect(page.locator("main h1")).toHaveText("Result saved 18 Nov 2026, 10:00");
    await expect(page.getByTestId("text-result-origin")).toHaveText(
      "Worked out from your business profile, version 3.",
    );
    await expect(page.getByRole("link", { name: "All saved results" })).toHaveAttribute(
      "href",
      "/workspace/assessments",
    );
    await expect(page.getByLabel("Earlier result")).toContainText("No other saved results");
  });

  // The business profile: its version, the same words for not knowing as the check uses, and a
  // button that says what it does.
  await open("/workspace/profile", async (page) => {
    await expect(page.getByTestId("text-profile-revision")).toHaveText("Version 3");
    await expect(page.getByTestId("button-save-profile")).toHaveText("Save profile");
    // An abbreviation is spelt out where it is asked for, as the check spells it.
    await expect(page.getByTestId("select-registrationStatus")).toHaveAccessibleName(
      "Registration with the Corporate Affairs Commission (CAC)",
    );
    await expect(page.getByTestId("select-employees-mode").locator("option")).toHaveText([
      "I know the number",
      "I do not know",
      "Not answered",
      "Not applicable",
    ]);
    const shown = await read(page);
    assert.doesNotMatch(shown, OLD_WORKSPACE_WORDS);
    assert.doesNotMatch(shown, /\bUnknown\b|Not answered yet/);
    assert.match(shown, /Each save keeps a new version\. “I do not know” is always an acceptable answer\./);
  });

  // The tasks and the reminders.
  await open("/workspace/tasks", async (page) => {
    await expect(page.getByTestId(`card-task-${tasks[0]!.id}`)).toContainText(
      "Version 1 · saved 12 Nov 2026, 10:00",
    );
    assert.doesNotMatch(await read(page), OLD_WORKSPACE_WORDS);
  });
  await open("/workspace/reminders", async (page) => {
    assert.doesNotMatch(await read(page), /\brev\b|\brevisions?\b/i);
  });

  // The check's save panel, after a check worked out from the profile's answers.
  await open(
    "/workspace/checker",
    async (page) => {
      await page.getByTestId("button-prefill").click();
      await page.getByTestId("button-step-5").click();
      await page.getByTestId("button-run").click();
      const panel = page.getByTestId("panel-save");
      await expect(panel).toBeVisible();
      await expect(panel.locator(".eyebrow")).toHaveText("Save this result");
      await expect(panel).toContainText("With the answers I gave here");
      await expect(panel).toContainText("With my business profile, version 3");
      const save = page.getByTestId("button-save-assessment");
      await expect(save).toHaveText("Save this result");
      await expect(save).toBeDisabled();
      await panel
        .getByRole("checkbox", { name: "I agree to Valo storing this result privately in my workspace." })
        .check();
      await expect(save).toBeEnabled();
      assert.doesNotMatch(await read(page, '[data-testid="panel-save"]'), OLD_WORKSPACE_WORDS);
    },
    except({
      "POST /workspace/checker/preview": api.PreviewWorkspaceAssessmentResponse.parse(assessment.result),
    }),
  );
});

// RUL-004: "Return matched facts, requirement ID/version, jurisdiction, source references,
// confidence label and missing facts."
// CMP-003: "Represent federal, state/FCT and LGA requirements separately".
test("a saved result names what it was worked out from, where each requirement applies and which rule and version it is, and links the official sources", async () => {
  const { page, errors, unknown, close } = await desktop(`/workspace/assessments/${ASSESSMENT}`);
  try {
    await ready(page);
    const result = page.getByTestId("assessment-result");
    await expect(page.getByTestId("result-basis").locator("span")).toHaveText([
      "Rules as at 18 Nov 2026",
      "Rules version synthetic-ruleset",
      "1 result with a source",
      "Reference cccccccccccc",
    ]);
    const item = assessment.result.items[0]!;
    const card = page.getByTestId(`card-item-${item.ruleId}`);
    await expect(card).toContainText(`Federal · Rule ${item.ruleId}, version ${item.ruleVersion}`);
    await expect(card).toContainText("Why am I seeing this?");
    await expect(card).toContainText(item.reason);
    await expect(card).toContainText(`Next step: ${item.nextStep}`);
    // It sits under the label the rules gave it.
    await expect(page.getByRole("region", { name: item.label })).toContainText(item.title);
    await expect(result).toContainText("What Valo does not cover yet");
    await expect(result).toContainText("Official sources");
    await expect(result.getByRole("link", { name: "Synthetic official route" })).toHaveAttribute(
      "href",
      "https://example.test/route",
    );
    // The fixture's own names for its rules and its rule are left out: each happens to hold one of
    // the old words.
    const shown = (await result.innerText())
      .replace(/\s+/g, " ")
      .replace(assessment.result.rulesetVersion, "")
      .replace(item.title, "");
    assert.doesNotMatch(
      shown,
      /\bruleset\b|\bas of\b|\bhash\b|coverage unavailable|source-backed|\breleased\b|known coverage gaps|official routes/i,
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// EDT-005's acceptance: "never invent legal names, addresses or signatures".
test("'Make another like this' starts a new document with the saved one's details and its reference and dates left blank, opens it, and waits while there are unsaved changes", async () => {
  const ANOTHER = "00000000-0000-4000-8000-00000000d002";
  type Sent = {
    title: string;
    content: typeof content & { blocks: Parameters<typeof guidedDataFromBlocks>[0] };
  };
  const made: Sent[] = [];
  const saved: Sent[] = [];
  /** The document the page asked to be made, as the API would then hold it. */
  const another = () => ({ ...document(1), id: ANOTHER, ...made.at(-1)! });
  const making =
    (from: Api): Api =>
    async (route, method, path, query) => {
      const json = (status: number, body: unknown) =>
        route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
      if (method === "POST" && path === "/workspace/documents") {
        made.push(route.request().postDataJSON() as Sent);
        return json(201, api.CreateDocumentResponse.parse(another()));
      }
      if (method === "GET" && path === `/workspace/documents/${ANOTHER}`)
        return json(200, api.GetDocumentResponse.parse(another()));
      if (method === "GET" && path === `/workspace/documents/${ANOTHER}/revisions`)
        return json(200, api.ListDocumentRevisionsResponse.parse([another()]));
      if (method === "GET" && path === `/v1/documents/${ANOTHER}/exports`) return json(200, []);
      if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
        saved.push(route.request().postDataJSON() as Sent);
        return json(200, api.SaveDocumentResponse.parse({ ...document(4), ...saved.at(-1)!, id: DOCUMENT }));
      }
      return from(route, method, path, query);
    };

  // A document with details of its own: the copy keeps them all but its reference and its dates.
  {
    const { page, errors, unknown, close } = await desktop(
      `/workspace/documents/${DOCUMENT}`,
      making(answer),
    );
    try {
      await ready(page);
      const card = page.getByTestId("card-make-another");
      const button = page.getByTestId("button-make-another");
      await expect(card).toContainText("Its reference and its dates are left blank for you to fill in.");
      await expect(button).toHaveText("Make another like this");
      await expect(button).toBeEnabled();

      // While a change is not saved, the copy waits, and says why.
      await page.getByTestId("input-title").fill("Synthetic invoice, changed");
      await expect(button).toBeDisabled();
      await expect(card).toContainText("Save your changes first.");
      await expect(page.getByTestId("status-save")).toContainText("Saved", { timeout: 15_000 });
      await expect(button).toBeEnabled();
      assert.equal(saved.length, 1);

      await button.click();
      await page.waitForURL(new RegExp(`/workspace/documents/${ANOTHER}$`));
      assert.equal(made.length, 1);
      const sent = made[0]!;
      // It is made from what was last saved, title included.
      assert.equal(sent.title, "Synthetic invoice, changed");
      assert.deepEqual(sent.content.fields, {
        ...content.fields,
        documentNumber: "",
        issueDate: "",
        dueDate: "",
      });
      assert.deepEqual(sent.content.blocks, content.blocks);
      assert.deepEqual(sent.content.financialInput, content.financialInput);
      // The new document opens, and names what it still needs.
      await expect(page.getByTestId("input-title")).toHaveValue("Synthetic invoice, changed");
      await expect(page.getByTestId("status-save")).toHaveText("Saved · version 1");
      await expect(page.getByTestId("card-missing").locator("li")).toHaveText([
        "Reference number",
        "Issue date",
        "Due date",
      ]);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }

  // An invoice made from questions: the answers are kept, its reference and its dates are not.
  const data = emptyGuidedData("TPL-01");
  Object.assign(data.values, {
    issuerName: "Synthetic Trading Ltd",
    recipientName: "Synthetic Customer Enterprises",
    documentNumber: "INV-0007",
    issueDate: "2026-11-18",
    dueDate: "2026-12-02",
  });
  const answeredInvoice = (revision: number) => ({
    ...invoice(revision),
    content: compileGuidedContent(data),
  });
  const { page, errors, unknown, close } = await desktop(
    `/workspace/documents/${DOCUMENT}`,
    making(
      except({
        [`GET /workspace/documents/${DOCUMENT}`]: api.GetDocumentResponse.parse(answeredInvoice(3)),
        [`GET /workspace/documents/${DOCUMENT}/revisions`]: api.ListDocumentRevisionsResponse.parse([
          answeredInvoice(3),
        ]),
      }),
    ),
  );
  try {
    await ready(page);
    await page.getByTestId("button-make-another").click();
    await page.waitForURL(new RegExp(`/workspace/documents/${ANOTHER}$`));
    assert.equal(made.length, 2);
    const answers = guidedDataFromBlocks(made[1]!.content.blocks)!.values;
    assert.equal(answers.issuerName, "Synthetic Trading Ltd");
    assert.equal(answers.recipientName, "Synthetic Customer Enterprises");
    assert.equal(answers.documentNumber, "");
    assert.equal(answers.issueDate, "");
    assert.equal(answers.dueDate, "");
    await expect(page.locator("#g-issuerName")).toHaveValue("Synthetic Trading Ltd");
    await expect(page.locator("#g-documentNumber")).toHaveValue("");
    await expect(page.getByTestId("mark-needed-g-documentNumber")).toHaveText("Still needed");
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// WEB-001: "both journeys are reachable within one deliberate action from the hero and mobile menu."
test("a visitor who is already signed in is sent on from sign-up and sign-in: to the New document page for what they chose, otherwise to their workspace", async () => {
  for (const [address, lands] of [
    ["/sign-up?start=document", "/workspace/documents/new"],
    ["/sign-up?start=invoice", "/workspace/documents/new?start=invoice"],
    ["/sign-in?start=hire", "/workspace/documents/new?start=hire"],
    ["/sign-up", "/workspace"],
    ["/sign-in", "/workspace"],
    // A choice the site does not offer leads nowhere of its own.
    ["/sign-up?start=%2Fstaff", "/workspace"],
    ["/sign-in?start=https%3A%2F%2Fexample.test%2F", "/workspace"],
  ] as const) {
    const { page, errors, close } = await desktop(address);
    try {
      await page.waitForURL((url) => url.pathname + url.search === lands, { timeout: 15_000 });
      await ready(page);
      if (lands.includes("start=invoice"))
        await expect(page.getByTestId("chosen-task").locator("h2")).toHaveText("Send an invoice");
      assert.deepEqual(errors, [], address);
    } finally {
      await close();
    }
  }
});

// The redesign's word list (docs/architecture/frontend-redesign.md, "Words").
test("no signed-in customer screen shows one of the project's own words that the word list replaced", async () => {
  const problems: string[] = [];
  for (const screen of SIGNED_IN.filter((s) => !s.path.startsWith("/staff"))) {
    const { page, close } = await desktop(screen.path);
    try {
      await ready(page);
      for (const found of oldWordsIn(await page.locator("main").innerText()))
        problems.push(`${screen.path}: ${found}`);
    } finally {
      await close();
    }
  }
  assert.deepEqual(problems, []);
});

// NFR-009: "No silent draft loss". Before anything the customer entered is discarded, the app asks,
// in a dialog of its own whose first button keeps everything.
test("before the editor or the tasks screen discards what the customer entered, it asks in its own dialog; keeping changes nothing, and going ahead does what its button says", async () => {
  const sent: { expectedRevision: number; title: string }[] = [];
  const saving: Api = async (route, method, path, query) => {
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      sent.push(route.request().postDataJSON() as (typeof sent)[number]);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(api.SaveDocumentResponse.parse(document(4))),
      });
    } else await answer(route, method, path, query);
  };
  {
    const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, saving);
    try {
      await ready(page);
      const dialog = page.getByTestId("dialog-confirm");
      const price = page.getByTestId("input-doc-price-0");
      await expect(price).toHaveValue("1500");
      // An amount typed and not applied is something the editor would discard.
      await price.fill("250");
      await expect(page.getByTestId("status-financial-unsaved")).toBeVisible();
      // With nothing to undo, the keyboard's undo asks nothing. Had it asked, its dialog would
      // shut out the click that follows.
      await price.blur();
      await page.keyboard.press("Control+z");

      // Reset: the dialog names what is lost; Escape keeps it.
      await page.getByTestId("button-reset-financial").click();
      await expect(dialog).toBeVisible();
      await expect(dialog.locator("h2")).toHaveText("Discard the amounts you have not applied?");
      await expect(dialog.getByTestId("button-keep")).toHaveText("Keep them");
      await expect(dialog.getByTestId("button-keep")).toBeFocused();
      await expect(dialog.getByTestId("button-confirm")).toHaveText("Discard them");
      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(price).toHaveValue("250");

      // Restore: keeping leaves the typed amount and asks the API for nothing.
      await page.getByTestId("button-restore-2").click();
      await expect(dialog.locator("h2")).toHaveText("Restore version 2?");
      await expect(dialog).toContainText("Restoring version 2 replaces them.");
      await dialog.getByTestId("button-keep").click();
      await expect(dialog).toBeHidden();
      await expect(price).toHaveValue("250");
      assert.equal(sent.length, 0);
      // Going ahead restores it: version 2 is saved over the version that was open.
      await page.getByTestId("button-restore-2").click();
      await expect(dialog.getByTestId("button-confirm")).toHaveText("Replace them with version 2");
      await dialog.getByTestId("button-confirm").click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("status-save")).toHaveText("Saved · version 4");
      await expect(price).toHaveValue("1500");
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.expectedRevision, 3);
      assert.equal(sent[0]!.title, document(2).title);

      // Reset again, and this time go ahead: the amount goes back, with no request.
      await price.fill("300");
      await page.getByTestId("button-reset-financial").click();
      await dialog.getByTestId("button-confirm").click();
      await expect(price).toHaveValue("1500");
      await expect(page.getByTestId("status-financial-unsaved")).toHaveCount(0);
      assert.equal(sent.length, 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }

  // The tasks screen: a task being edited is not thrown away by choosing another view.
  const { page, errors, unknown, close } = await desktop("/workspace/tasks");
  try {
    await ready(page);
    const dialog = page.getByTestId("dialog-confirm");
    const first = tasks[0]!.id;
    await page.getByTestId(`button-edit-${first}`).click();
    await expect(page.getByTestId(`card-task-${first}`)).toContainText("Editing version 1");
    await page.getByTestId("tab-all").click();
    await expect(dialog.locator("h2")).toHaveText("Leave your task edits?");
    await expect(dialog.getByTestId("button-keep")).toHaveText("Stay and save them");
    await expect(dialog.getByTestId("button-keep")).toBeFocused();
    await dialog.getByTestId("button-keep").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(`card-task-${first}`)).toContainText("Editing version 1");
    await expect(page.getByTestId("tab-open")).toHaveAttribute("aria-pressed", "true");
    // Going ahead leaves the edit and shows the view asked for.
    await page.getByTestId("tab-all").click();
    await dialog.getByTestId("button-confirm").click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("tab-all")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`card-task-${first}`)).not.toContainText("Editing version 1");
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// The server refuses a change to a task that was changed somewhere else after it was opened. The
// tasks screen says so itself, in the three places it can happen, and keeps what was typed.
test("when a task was changed somewhere else, the tasks screen says so in plain words for a change of status, an archive and a save, and keeps what was typed", async () => {
  const first = tasks[0]!.id;
  const refusing: Api = async (route, method, path, query) => {
    if ((method === "PATCH" || method === "DELETE") && path === `/workspace/tasks/${first}`)
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error:
            "This task was changed somewhere else after you opened it. Your unsaved notes were not overwritten.",
          currentRevision: 2,
        }),
      });
    else await answer(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop("/workspace/tasks", refusing);
  try {
    await ready(page);
    const card = page.getByTestId(`card-task-${first}`);
    // A change of status.
    await page.getByTestId(`select-state-${first}`).selectOption("in_progress");
    await expect(card.getByRole("alert")).toHaveText(
      "This task was changed somewhere else. The list now shows its newest version. Try again.",
    );
    // An archive.
    await page.getByTestId(`button-archive-${first}`).click();
    await page.getByTestId(`button-confirm-archive-${first}`).click();
    await expect(card.getByRole("alert").last()).toHaveText(
      "This task was changed somewhere else. The list now shows its newest version. Archive it again if you still want to.",
    );
    // A save of edits: what was typed stays in the form.
    await page.getByTestId(`button-edit-${first}`).click();
    const notes = page.getByTestId(`input-edit-${first}-notes`);
    await notes.fill("Synthetic notes typed before the save was refused");
    await page.getByTestId(`button-edit-${first}-submit`).click();
    await expect(card).toContainText("This task was changed somewhere else");
    await expect(card).toContainText("What you typed is still in the form below.");
    await expect(notes).toHaveValue("Synthetic notes typed before the save was refused");
    const said = await card.innerText();
    assert.deepEqual(oldWordsIn(said), []);
    assert.doesNotMatch(said, /elsewhere|refreshed/);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// The browser's own box stopped the page while it asked. The app's dialog does not, so the editor
// holds its autosave and the keyboard's save and undo while a question is open: otherwise a save
// could be on its way when the customer chose, and the choice would do nothing.
test("while the editor asks, nothing is saved underneath the question, and the answer starts the autosave again", async () => {
  const sent: { expectedRevision: number; title: string }[] = [];
  let release = () => {};
  const first = new Promise<void>((resolve) => {
    release = resolve;
  });
  const holding: Api = async (route, method, path, query) => {
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      const body = route.request().postDataJSON() as (typeof sent)[number];
      const version = 3 + sent.push(body);
      // The first save stays on its way until the test lets it finish.
      if (version === 4) await first;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(api.SaveDocumentResponse.parse({ ...document(version), title: body.title })),
      });
    } else await answer(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, holding);
  try {
    await ready(page);
    const dialog = page.getByTestId("dialog-confirm");
    // The newest saved version, as the download panel names it. The save indicator cannot show it
    // here: it reads "Unsaved changes" for as long as an amount is typed and not applied.
    const saved = page.getByTestId("private-exports");
    const price = page.getByTestId("input-doc-price-0");
    // A save is on its way, and more is typed before it finishes.
    await page.getByTestId("input-title").fill("Synthetic invoice, first change");
    await expect.poll(() => sent.length).toBe(1);
    await page.getByTestId("input-title").fill("Synthetic invoice, second change");
    await price.fill("250");
    await page.getByTestId("button-reset-financial").click();
    await expect(dialog.locator("h2")).toHaveText("Discard the amounts you have not applied?");
    // The first save finishes underneath the question, which leaves the second change waiting.
    release();
    await expect(saved).toContainText("Saved version 4");
    // While the question is open the autosave does not save it, and the keyboard neither saves nor
    // undoes. The wait is longer than the autosave's.
    await page.keyboard.press("Control+s");
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(2200);
    assert.equal(sent.length, 1);
    await expect(saved).toContainText("Saved version 4");
    await expect(dialog.locator("h2")).toHaveText("Discard the amounts you have not applied?");
    await expect(page.getByTestId("input-title")).toHaveValue("Synthetic invoice, second change");
    await expect(page.getByTestId("status-financial-unsaved")).toBeVisible();
    // Keeping answers the question. The change that waited is then saved, and the amount that was
    // typed is still there, not applied.
    await dialog.getByTestId("button-keep").click();
    await expect(saved).toContainText("Saved version 5");
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.title, "Synthetic invoice, second change");
    assert.equal(sent[1]!.expectedRevision, 4);
    await expect(price).toHaveValue("250");
    await expect(page.getByTestId("status-financial-unsaved")).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// NFR-009: "No silent draft loss". The browser's Back button leaves a screen as a link does, so a
// screen with something unsaved on it asks first. The router hears of the move only if the screen
// lets it go.
test("the browser's Back button does not take unsaved work away: the screen asks first, staying keeps what was typed, and leaving goes where Back was going", async () => {
  {
    const sent: { content: { financialInput: { lines: { unitPriceKobo: string }[] } } }[] = [];
    const saving: Api = async (route, method, path, query) => {
      if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
        sent.push(route.request().postDataJSON() as (typeof sent)[number]);
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(api.SaveDocumentResponse.parse(document(4))),
        });
      } else await answer(route, method, path, query);
    };
    const { page, errors, unknown, close } = await desktop("/workspace/documents", saving);
    try {
      await ready(page);
      const link = page.getByTestId(`link-doc-${DOCUMENT}`);
      const editor = new RegExp(`/workspace/documents/${DOCUMENT}$`);
      const price = page.getByTestId("input-doc-price-0");
      const question = page.getByTestId("dialog-confirm");
      const stay = page.getByTestId("button-stay-editor");
      await link.click();
      await expect(price).toHaveValue("1500");
      // With nothing unsaved, Back goes back.
      await page.goBack();
      await expect(link).toBeVisible();
      assert.equal(new URL(page.url()).pathname, "/workspace/documents");
      await link.click();
      // An amount typed and not applied is unsaved. Back asks, and the editor is still there.
      await price.fill("250");
      await page.goBack();
      await expect(stay).toBeVisible();
      assert.match(page.url(), editor);
      await stay.click();
      await expect(stay).toBeHidden();
      await expect(price).toHaveValue("250");
      // Leaving asks about everything unsaved, so a question of the editor's own that is still
      // open is answered by keeping.
      await page.getByTestId("button-reset-financial").click();
      await expect(question).toBeVisible();
      await page.goBack();
      await expect(stay).toBeVisible();
      await expect(question).toBeHidden();
      await stay.click();
      await expect(stay).toBeHidden();
      await expect(price).toHaveValue("250");
      await expect(page.getByTestId("status-financial-unsaved")).toBeVisible();
      // Choosing to leave goes where Back was going, and nothing is sent.
      await page.goBack();
      await page.getByTestId("button-discard-leave").click();
      await expect(link).toBeVisible();
      assert.equal(new URL(page.url()).pathname, "/workspace/documents");
      assert.equal(sent.length, 0);
      // "Save and leave" does both, even when a question of the editor's own was open as Back was
      // pressed: the amount is applied and saved, and then the editor is left.
      await link.click();
      await price.fill("250");
      await page.getByTestId("button-reset-financial").click();
      await expect(question).toBeVisible();
      await page.goBack();
      await page.getByTestId("button-save-leave").click();
      await expect(link).toBeVisible();
      assert.equal(new URL(page.url()).pathname, "/workspace/documents");
      assert.equal(sent.length, 1);
      assert.equal(sent[0]!.content.financialInput.lines[0]!.unitPriceKobo, "25000");
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }

  // The business profile and the tasks use the same guard.
  {
    const { page, errors, unknown, close } = await desktop("/workspace");
    try {
      await ready(page);
      await page.getByTestId("link-edit-profile").click();
      const name = page.getByTestId("input-business-name");
      await name.fill("Synthetic Trading Ltd, changed");
      await page.goBack();
      const stay = page.getByTestId("button-stay-editor");
      await expect(stay).toBeVisible();
      assert.equal(new URL(page.url()).pathname, "/workspace/profile");
      await stay.click();
      await expect(stay).toBeHidden();
      await expect(name).toHaveValue("Synthetic Trading Ltd, changed");
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }
  const { page, errors, unknown, close } = await desktop("/workspace");
  try {
    await ready(page);
    await page.locator('header nav a[href="/workspace/tasks"]').click();
    const first = tasks[0]!.id;
    const card = page.getByTestId(`card-task-${first}`);
    const question = page.getByTestId("dialog-confirm");
    const stay = page.getByTestId("button-stay-editor");
    await page.getByTestId(`button-edit-${first}`).click();
    await expect(card).toContainText("Editing version 1");
    // The screen's own question about the view, still open, is answered by staying.
    await page.getByTestId("tab-all").click();
    await expect(question.locator("h2")).toHaveText("Leave your task edits?");
    await page.goBack();
    await expect(stay).toBeVisible();
    await expect(question).toBeHidden();
    assert.equal(new URL(page.url()).pathname, "/workspace/tasks");
    await stay.click();
    await expect(stay).toBeHidden();
    await expect(card).toContainText("Editing version 1");
    await expect(page.getByTestId("tab-open")).toHaveAttribute("aria-pressed", "true");
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// WRK-003: "Offer opt-in email reminders using Africa/Lagos scheduling, configurable offsets and a
// delivery log." The screen says these in the customer's words, and never calls a message the
// email service accepted "sent" or "delivered".
test("the reminders screen says in plain words whether emails are being sent and what has happened to each reminder", async () => {
  const reminder = (n: number, fields: Record<string, unknown>) => ({
    id: `00000000-0000-4000-8000-00000000c10${n}`,
    taskId: tasks[0]!.id,
    scheduledAt: at(25),
    status: "held",
    attempts: 0,
    nextAttemptAt: null,
    lastAttemptAt: null,
    reason: null,
    deliveredAt: null,
    ...fields,
  });
  const records = api.ListRemindersResponse.parse([
    reminder(1, { reason: "EMAIL_PROVIDER_NOT_CONFIGURED", nextAttemptAt: at(26) }),
    reminder(2, { status: "sent", scheduledAt: at(20), attempts: 1, lastAttemptAt: at(20) }),
    reminder(3, {
      status: "failed",
      reason: "EMAIL_ATTEMPT_LIMIT_REACHED",
      scheduledAt: at(21),
      attempts: 5,
      lastAttemptAt: at(21),
    }),
    reminder(4, {
      status: "cancelled",
      reason: "TASK_ARCHIVED",
      taskId: "00000000-0000-4000-8000-00000000ffff",
      scheduledAt: at(22),
    }),
    reminder(5, {
      status: "failed",
      reason: "EMAIL_ACCEPTANCE_UNCONFIRMED",
      scheduledAt: at(23),
      attempts: 2,
      lastAttemptAt: at(23),
      nextAttemptAt: at(24),
    }),
  ]);
  const preferences = (deliveryAvailable: boolean) =>
    api.GetReminderPreferencesResponse.parse({
      enabled: true,
      offsets: [7, 1],
      revision: 1,
      timezone: "Africa/Lagos",
      deliveryAvailable,
      deliveryBlocker: "Synthetic test fixture: a note for operators.",
    });
  const row = (page: Page, n: number) => page.getByTestId(`row-reminder-${records[n - 1]!.id}`);
  {
    const { page, errors, unknown, close } = await desktop(
      "/workspace/reminders",
      except({
        "GET /workspace/reminders": records,
        "GET /workspace/reminder-preferences": preferences(false),
      }),
    );
    try {
      await ready(page);
      // Off unless turned on, and only for a date the customer confirmed.
      await expect(page.locator("main")).toContainText(
        "Reminders are off unless you turn them on. They apply only to tasks with a due date you have confirmed.",
      );
      await expect(page.getByRole("switch")).toHaveAccessibleName(
        /^Send email reminders before a task is due/,
      );
      await expect(page.locator("main")).toContainText("Each reminder is planned for 09:00, Lagos time.");
      // Whether emails are being sent at all, said once and plainly.
      await expect(page.getByTestId("status-delivery")).toHaveText(
        "Reminder emails are not being sent yet" +
          "You can save your choices now. Nothing is sent, and each reminder stays on hold, until sending is switched on.",
      );

      // On hold because nothing is sent yet.
      await expect(row(page, 1)).toContainText("Synthetic task 1");
      await expect(row(page, 1)).toContainText("Planned for 25 Nov 2026, 10:00");
      await expect(row(page, 1)).toContainText(
        "Reminder emails are not being sent yet. Your task and your preferences are saved.",
      );
      await expect(row(page, 1)).toContainText(
        "Valo looks at this again after 26 Nov 2026, 10:00, if reminders are still on.",
      );
      await expect(row(page, 1).locator(".pill")).toHaveText("On hold");
      // The email service took the message. That is not called sent, or delivered.
      await expect(row(page, 2).locator(".pill")).toHaveText("Accepted by email service");
      await expect(row(page, 2)).toContainText(
        "The email service accepted this message. That does not show it reached your inbox.",
      );
      await expect(row(page, 2)).toContainText("Tried once. Last tried 20 Nov 2026, 10:00.");
      assert.doesNotMatch(await row(page, 2).innerText(), /delivered|\bsent\b/i);
      // Five tries and no more: the customer cannot clear this alone, so the way to report it is here.
      await expect(row(page, 3).locator(".pill")).toHaveText("Not confirmed");
      await expect(row(page, 3)).toContainText(
        "Valo tried five times and stopped. Your task and its due date have not changed.",
      );
      await expect(row(page, 3)).toContainText("Tried 5 times. Last tried 21 Nov 2026, 10:00.");
      await expect(row(page, 3).getByRole("link", { name: "Report a problem" })).toHaveAttribute(
        "href",
        "/support",
      );
      // A cancelled reminder of a task that is no longer listed.
      await expect(row(page, 4).locator(".pill")).toHaveText("Cancelled");
      await expect(row(page, 4)).toContainText("A task no longer in your list");
      await expect(row(page, 4)).toContainText("The task was archived.");
      await expect(row(page, 4).getByRole("link")).toHaveCount(0);
      // Not confirmed, and to be tried again.
      await expect(row(page, 5)).toContainText(
        "The email service did not confirm that it accepted this message. If Valo tries again, it asks for this same message to be sent, not a second one.",
      );
      await expect(row(page, 5)).toContainText(
        "Tried 2 times. Last tried 23 Nov 2026, 10:00.Valo tries again after 24 Nov 2026, 10:00, if reminders are still on.",
      );

      // None of the system's own words, and no note written for operators.
      const shown = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      assert.doesNotMatch(
        shown,
        /provider|dispatch|\bserver\b|opt-in|Africa\/Lagos|operators|development|[A-Z]{3,}_[A-Z]/i,
      );
      assert.deepEqual((await wcagFailures(page)).failures, []);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }

  // Where a test email can be sent, the screen says that it is a test, and to whom.
  const { page, errors, unknown, close } = await phone(
    "/workspace/reminders",
    except({
      "GET /workspace/reminders": records,
      "GET /workspace/reminder-preferences": preferences(true),
    }),
  );
  try {
    await ready(page);
    await expect(page.getByTestId("status-delivery")).toHaveText(
      "Test emails only" +
        "Valo is still being built. A reminder is sent only as a test, to the workspace owner's verified email address.",
    );
    assert.deepEqual(await phoneProblems(page, "the reminders, with five in the log"), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// SRV-002: "the user sees “Enquiry received”, not “Appointment booked”". The receipt and the
// customer's own requests say what has happened, and what has not, in words a customer is not asked
// to learn.
test("a saved request reads 'Enquiry received' with what has not happened, and the customer's own requests read in plain words", async () => {
  const CASE = "00000000-0000-4000-8000-0000000051a1";
  const request = {
    id: CASE,
    sourceKind: "workspace",
    reference: "VALO-SUP-SYNTHETIC-1",
    category: "support",
    status: "awaiting_customer",
    version: 4,
    updatedAt: at(19),
  };
  const sent: unknown[] = [];
  const how: Api = async (route, method, path, query) => {
    if (method === "POST" && path === "/workspace/support") {
      sent.push(route.request().postDataJSON());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          api.CreateSupportTicketResponse.parse({
            reference: "VALO-SUP-SYNTHETIC-2",
            message: "Synthetic test fixture: a note in the server's own words.",
            dispatchStatus: "awaiting_staff",
          }),
        ),
      });
    } else
      await except({
        "GET /workspace/support-cases": api.ListCustomerSupportCasesResponse.parse({
          cases: [request],
          page: 1,
          pageSize: 25,
          hasMore: false,
          notice: "Synthetic test fixture: a note in the server's own words.",
        }),
        [`GET /workspace/support-cases/${CASE}`]: api.GetCustomerSupportCaseResponse.parse({
          case: {
            ...request,
            scope: "Synthetic request: the download did not start.",
            contactEmail: "synthetic-accessibility@example.test",
            sharingConsent: false,
            createdAt: at(18),
          },
          messages: [
            {
              id: "00000000-0000-4000-8000-0000000051b1",
              body: "Synthetic reply from staff.",
              createdAt: at(19),
              authorKind: "staff",
              visibility: "customer",
            },
            {
              id: "00000000-0000-4000-8000-0000000051b2",
              body: "Synthetic note from the customer.",
              createdAt: at(18),
              authorKind: "customer",
              visibility: "customer",
            },
          ],
          messagesPage: 1,
          messagePageSize: 25,
          moreMessages: false,
          notice: "Synthetic test fixture: a note in the server's own words.",
        }),
      })(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop("/support", how);
  try {
    await ready(page);
    // The customer's own requests.
    const requests = page.getByTestId("customer-support-cases");
    await expect(page.locator("#customer-support-heading")).toHaveText("Your support requests");
    await expect(requests).toContainText(
      "Replies are kept on this page. Valo does not email them yet, so come back here to read them.",
    );
    await expect(requests).toContainText("Valo product support · Staff have replied");
    await requests.getByRole("button", { name: "View conversation" }).click();
    await expect(requests).toContainText("Synthetic request: the download did not start.");
    await expect(requests).toContainText(
      "A reply here is not an appointment or a professional review. Nothing is emailed, and your request is not passed to anyone outside Valo.",
    );
    await expect(requests).toContainText("Valo staff · 19 Nov 2026, 10:00");
    await expect(requests).toContainText("You · 18 Nov 2026, 10:00");
    await expect(requests.getByRole("button", { name: "Save reply", exact: true })).toBeDisabled();
    const read = (await requests.innerText()).replace(/\s+/g, " ");
    // The request's state and topic are words, not the system's names, and no note of the server's
    // own is shown.
    assert.doesNotMatch(
      read,
      /awaiting_customer|awaiting customer|\bversion\b|portal|\bcase\b|durabl|dispatch|server's own words/i,
    );

    // The form, and its receipt.
    await page.getByTestId("input-scope").fill("Synthetic request: the file would not open.");
    await page.getByTestId("button-submit-ticket").click();
    const receipt = page.getByTestId("ticket-receipt");
    await expect(receipt).toHaveAttribute("role", "status");
    await expect(receipt).toContainText("Enquiry received");
    await expect(receipt).toContainText(
      "It is saved for a member of Valo's staff to read. No appointment has been made, and no time for a reply has been set. Nothing has been sent to anyone outside Valo.",
    );
    await expect(page.getByTestId("text-ticket-reference")).toHaveText("VALO-SUP-SYNTHETIC-2");
    await expect(receipt).toContainText("Waiting for staff");
    assert.doesNotMatch(
      (await receipt.innerText()).replace(/\s+/g, " "),
      /appointment booked|durabl|provider|dispatch|server's own words/i,
    );
    assert.equal(sent.length, 1);
    assert.deepEqual((await wcagFailures(page)).failures, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// PRV-003: "Provide request verification, correction/export/deletion and legal-hold handling." The
// customer reads where a request stands in words, and every limit the screen stated is still
// stated: a request that is received or partly done is not a deletion, or a complete copy.
test("a privacy request reads in words: its kind, its state, each step and who did what; and the screen still says what a request is not", async () => {
  const asked = { ...privacyCase, status: "needs_information", version: 3, assigned: true };
  const fresh = {
    ...privacyCase,
    id: "00000000-0000-4000-8000-00000000b002",
    reference: "PRV-SYNTH-2",
    kind: "correction",
    status: "awaiting_verification",
    version: 1,
    verifiedAt: null,
    createdAt: at(16),
    updatedAt: at(16),
  };
  const step = (system: string, status: string) => ({ system, status, detail: "Synthetic step detail." });
  const how = except({
    "GET /workspace/privacy-cases": api.ListPrivacyCasesResponse.parse([asked, fresh]),
    [`GET /workspace/privacy-cases/${asked.id}`]: api.GetPrivacyCaseResponse.parse({
      request: asked,
      mayRespond: true,
      messages: [
        {
          id: "00000000-0000-4000-8000-00000000b0a1",
          body: "Synthetic information from the customer.",
          createdAt: at(16),
        },
      ],
      events: [
        {
          sequence: 1,
          action: "request_received",
          actorType: "customer",
          reason: "Synthetic reason one.",
          createdAt: at(14),
        },
        {
          sequence: 2,
          action: "information_requested",
          actorType: "staff",
          reason: "Synthetic question from staff.",
          createdAt: at(16),
        },
        {
          sequence: 3,
          action: "export_prepared",
          actorType: "worker",
          reason: "Synthetic reason three.",
          createdAt: at(17),
        },
      ],
      steps: [
        step("identity_verification", "confirmed"),
        step("application", "running"),
        step("private_files", "pending"),
        step("managed_identity", "not_applicable"),
        step("external_processors", "held"),
        step("retention_and_recovery", "failed"),
      ],
    }),
    [`GET /workspace/privacy-cases/${fresh.id}`]: api.GetPrivacyCaseResponse.parse({
      request: fresh,
      mayRespond: false,
      messages: [],
      events: [
        {
          sequence: 1,
          action: "request_received",
          actorType: "customer",
          reason: "Synthetic reason one.",
          createdAt: at(16),
        },
      ],
      steps: [step("identity_verification", "pending")],
    }),
  });
  const { page, errors, unknown, close } = await desktop("/workspace/privacy", how);
  try {
    await ready(page);
    const main = page.locator("main");
    // What a request is not, said before any request is read.
    await expect(page.locator("#privacy-cases-heading")).toHaveText("Your privacy requests");
    await expect(main).toContainText(
      "A request that is received, or partly done, is not a confirmed deletion, and is not a complete copy from every service Valo uses.",
    );
    await expect(main).toContainText(
      "You can still read and answer your own requests after a deletion has restricted your workspace. That does not give back access to your business data.",
    );
    // The download's own scope keeps its words.
    await expect(page.getByTestId("workspace-export-scope")).toContainText("export/file metadata");
    await expect(page.getByTestId("workspace-export-scope")).toContainText("not complete privacy fulfilment");

    // A request staff have a question about.
    const first = page.getByTestId("privacy-case").filter({ hasText: asked.reference });
    await expect(first).toContainText("Full data request · Staff need more information");
    await expect(first).toContainText("Made 14 Nov 2026, 10:00 · With privacy staff");
    await first.getByRole("button", { name: "View request" }).click();
    await expect(first.getByLabel("Steps of this request").locator("strong")).toHaveText([
      "Confirming it is you: Confirmed",
      "Your Valo workspace: In progress",
      "Your files: Not started",
      "Your sign-in account: Not needed",
      "Other services Valo uses: On hold",
      "Records Valo must keep, and backups: Failed",
    ]);
    await expect(first.getByLabel("Request history").locator("li")).toContainText([
      "Request received · You · 14 Nov 2026, 10:00",
      "Information requested · Valo staff · 16 Nov 2026, 10:00",
      "Export prepared · Valo's system · 17 Nov 2026, 10:00",
    ]);
    await expect(first.getByLabel("More information for this request")).toBeVisible();
    await expect(first).toContainText(
      "A reply does not confirm who you are, or that the request is done. Do not include passwords or identity documents.",
    );

    // A request the customer has still to confirm.
    const second = page.getByTestId("privacy-case").filter({ hasText: fresh.reference });
    await expect(second).toContainText("Correct something · Waiting for you to confirm it");
    await expect(second).toContainText("Not yet with staff");
    await second.getByRole("button", { name: "View request" }).click();
    await expect(second).toContainText(
      "I confirm that this is my business's request, and I want Valo to check that I am the signed-in owner. This does not confirm that the request is done.",
    );
    await expect(second.getByRole("button", { name: "Confirm my request" })).toBeDisabled();
    await expect(second.getByRole("button", { name: "Cancel before work begins" })).toBeEnabled();

    // The older support references.
    await expect(main).toContainText(
      "They are not the results of a privacy request. A newer request has its history and its result above. An older one listed here has still to be taken up by staff.",
    );
    // None of the system's own names for a state, a step, an actor or a version.
    const shown = (await main.innerText()).replace(/\s+/g, " ");
    assert.doesNotMatch(
      shown,
      /[a-z]_[a-z]|awaiting verification|needs information|not applicable|\bworker\b|\bversion \d|provider-wide|privacy-fulfilment|\bintake\b/i,
    );
    assert.deepEqual((await wcagFailures(page)).failures, []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// A sentence that shows only once a list is empty, or a form is opened, is read here: the tests
// that read each screen as it opens do not see it.
test("an empty list of tasks or reminders says what to do next in the customer's words, and the new-task form's hint names a saved result", async () => {
  {
    const { page, errors, unknown, close } = await desktop(
      "/workspace/tasks",
      except({
        "GET /workspace/tasks/page": api.ListTasksPageResponse.parse({
          items: [],
          total: 0,
          openCount: 0,
          filteredTotal: 0,
          page: 1,
          pageSize: 20,
          hasNext: false,
        }),
      }),
    );
    try {
      await ready(page);
      const empty = page.getByTestId("status-empty");
      await expect(empty).toContainText("No tasks yet");
      await expect(empty).toContainText(
        "Add anything you need to remember. Tasks work even where no published rule covers your situation.",
      );
      await expect(empty.getByRole("link", { name: "From a saved result" })).toHaveAttribute(
        "href",
        "/workspace/assessments",
      );
      await empty.getByRole("button", { name: "Write a task" }).click();
      await expect(page.locator("main")).toContainText(
        'To link a task to a rule, open a saved result and use "Add task" on an item marked "Likely relevant".',
      );
      assert.deepEqual(oldWordsIn(await page.locator("main").innerText()), []);
      assert.deepEqual(errors, []);
      assert.deepEqual(unknown, []);
    } finally {
      await close();
    }
  }
  const { page, errors, unknown, close } = await desktop(
    "/workspace/reminders",
    except({ "GET /workspace/reminders": [] }),
  );
  try {
    await ready(page);
    const empty = page.getByTestId("status-empty");
    await expect(empty).toContainText("No reminders yet");
    await expect(empty).toContainText(
      "A reminder appears here once reminders are on and a task has a due date you have confirmed.",
    );
    await expect(empty.getByRole("link", { name: "Go to your tasks" })).toHaveAttribute(
      "href",
      "/workspace/tasks",
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("the account screen names the sign-in service as the contact page does, and still says that Valo never sees the password", async () => {
  const { page, errors, unknown, close } = await desktop("/workspace/account");
  try {
    await ready(page);
    const main = page.locator("main");
    await expect(main).toContainText(
      "Your email, password, other ways of signing in and the devices you are signed in on are managed by our sign-in provider. Valo never sees your password.",
    );
    // What deleting the sign-in account does not do is still said.
    await expect(main).toContainText("Deleting your sign-in account is not a Valo data deletion");
    assert.doesNotMatch((await main.innerText()).replace(/\s+/g, " "), /authentication provider/i);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("a direct checkout shows only the chosen price and leaves an obsolete link unavailable", async () => {
  const id = "4dad9357-4a4f-409f-aebf-96b997932d0a";
  const otherId = "6e9721a8-eee0-41c1-a4dc-6285e5afcd73";
  const retiredId = "3125e6de-b202-41f2-b3f5-c480a0d2c53a";
  const ownedEdition = "be90d48c-0192-4f5e-9bed-989f5781dfc5";
  const downloadPath = "/api/workspace/manual-premium-templates/" + ownedEdition + "/download";
  const offer = {
    id,
    title: "Synthetic service agreement",
    currency: "NGN",
    amountKobo: 400000,
    licenceVersion: "1.0",
    licenceText: "Synthetic single-business licence.",
    taxTreatment: "Final test price.",
  };
  const { page, errors, unknown, close } = await phone(
    "/workspace/purchases?offer=" + id,
    except({
      "GET /workspace/purchases": api.GetCustomerPurchasesResponse.parse({
        available: true,
        message: "Synthetic checkout.",
        ownedDownloads: [
          { offerId: retiredId, edition: ownedEdition, title: "Previously purchased template", downloadPath },
        ],
        livePaymentsEnabled: false,
        orders: [],
        products: [offer, { ...offer, id: otherId, title: "Other synthetic template" }],
      }),
    }),
  );
  try {
    await ready(page);
    await expect(page.getByRole("heading", { name: "Template checkout" })).toBeVisible();
    await expect(page.getByRole("region", { name: "My Templates" })).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "Synthetic service agreement · ₦4,000.00" }),
    ).toBeVisible();
    await expect(page.getByText("Other synthetic template", { exact: false })).toHaveCount(0);
    await page.getByText("Licence · 1.0", { exact: true }).click();
    await expect(page.getByText(offer.licenceText, { exact: true })).toBeVisible();
    const save = page.getByRole("button", { name: "Save test order" });
    await expect(save).toBeDisabled();
    await page
      .getByRole("checkbox", { name: "I accept this version of the licence for this business." })
      .check();
    await expect(save).toBeEnabled();
    await page.goto(new URL("/workspace/purchases?offer=" + retiredId, page.url()).href);
    await expect(page.getByRole("heading", { name: "Previously purchased template" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download", exact: true })).toHaveAttribute(
      "href",
      downloadPath,
    );
    await expect(save).toHaveCount(0);
    await page.goto(new URL("/workspace/purchases?offer=unavailable", page.url()).href);
    await expect(page.getByTestId("text-nothing-to-buy")).toContainText("This offer is unavailable");
    await expect(save).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("My Templates lists owned editions once, including older purchases and closed offers", async () => {
  const id = (suffix: number) => "00000000-0000-4000-8000-" + String(suffix).padStart(12, "0");
  const edition = (n: number, title: string, reviewed = false) => ({
    offerId: id(100 + n),
    edition: id(n),
    title,
    downloadPath: reviewed
      ? "/api/workspace/templates/" + id(n) + "/files/docx"
      : "/api/workspace/manual-premium-templates/" + id(n) + "/download",
  });
  const letter = edition(1, "Engagement letter");
  const budget = edition(2, "Budget planner", true);
  const otherLetter = edition(3, "Engagement letter");
  const current = {
    id: letter.offerId,
    title: letter.title,
    currency: "NGN",
    amountKobo: 250000,
    licenceVersion: "1.0",
    licenceText: "Synthetic licence.",
    taxTreatment: "Synthetic price.",
  };
  const listing = api.GetCustomerPurchasesResponse.parse({
    available: true,
    message: "Test purchases.",
    livePaymentsEnabled: false,
    orders: [],
    products: [current, { ...current, id: id(200), title: "Another template" }],
    ownedDownloads: [
      otherLetter,
      letter,
      budget,
      { ...letter, offerId: id(300), title: "Old listing title" },
    ],
  });
  const { page, errors, unknown, close } = await phone(
    "/workspace/purchases",
    except({ "GET /workspace/purchases": listing }),
  );
  try {
    await ready(page);
    const mine = page.getByRole("region", { name: "My Templates", exact: true });
    const shop = page.getByRole("region", { name: "Documents you can buy" });
    const links = mine.getByRole("link");
    await expect(links).toHaveCount(3);
    assert.deepEqual(await mine.getByRole("heading", { level: 3 }).allTextContents(), [
      budget.title,
      letter.title,
      otherLetter.title,
    ]);
    assert.deepEqual(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href"))), [
      budget.downloadPath,
      letter.downloadPath,
      otherLetter.downloadPath,
    ]);
    await expect(mine.getByRole("link", { name: "Download Budget planner" })).toBeVisible();
    await expect(shop.getByRole("heading", { level: 3 })).toHaveCount(1);
    await expect(shop.getByRole("heading", { name: /Another template/ })).toBeVisible();
    const search = mine.getByRole("searchbox", { name: "Search by title" });
    const clear = mine.getByRole("button", { name: "Clear search" });
    await search.fill("  GaGeMeNt  ");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute("href", letter.downloadPath);
    await expect(links.nth(1)).toHaveAttribute("href", otherLetter.downloadPath);
    await expect(mine.getByRole("status")).toHaveText("2 editions available to download.");
    await search.fill("PLANNER");
    await expect(links).toHaveCount(1);
    await expect(links).toHaveAttribute("href", budget.downloadPath);
    await expect(mine.getByRole("status")).toHaveText("1 edition available to download.");
    await search.fill("Another template");
    await expect(links).toHaveCount(0);
    await expect(mine.getByRole("status")).toHaveText("No owned editions match your search.");
    await expect(shop.getByRole("heading", { name: /Another template/ })).toBeVisible();
    await clear.focus();
    await clear.press("Enter");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(links).toHaveCount(3);
    await search.fill("   ");
    await expect(links).toHaveCount(3);
    await clear.click();
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "My Templates with several owned editions"), []);
    listing.products = [listing.products[0]!];
    await page.reload();
    await expect(shop).toContainText("Your workspace owns every template currently on sale.");
    listing.ownedDownloads = [];
    await page.reload();
    await search.fill("Engagement letter");
    await expect(mine).toContainText("Your workspace has no premium templates available to download.");
    await expect(links).toHaveCount(0);
    await expect(shop.getByRole("heading", { name: /Engagement letter/ })).toBeVisible();
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("purchase history offers the exact owned file on a verified order and keeps its receipt after access ends", async () => {
  const listing = api.GetCustomerPurchasesResponse.parse(answers["GET /workspace/purchases"]);
  const paid = listing.orders[0]!;
  const edition = paid.contentVersionId;
  const downloadPath = "/api/workspace/manual-premium-templates/" + edition + "/download";
  listing.ownedDownloads = [
    "00000000-0000-4000-8000-00000000a301",
    "00000000-0000-4000-8000-00000000a302",
  ].map((offerId) => ({ offerId, edition, title: paid.title, downloadPath }));
  listing.orders.push(
    {
      ...paid,
      id: "00000000-0000-4000-8000-00000000a102",
      reference: "ORD-SYNTH-2",
      contentVersionId: "00000000-0000-4000-8000-00000000a202",
    },
    { ...paid, id: "00000000-0000-4000-8000-00000000a103", reference: "ORD-SYNTH-3", status: "reversed" },
    {
      ...paid,
      id: "00000000-0000-4000-8000-00000000a104",
      reference: "ORD-SYNTH-4",
      status: "created",
      receiptReference: null,
    },
  );
  const { page, errors, unknown, close } = await phone(
    "/workspace/purchases",
    except({ "GET /workspace/purchases": listing }),
  );
  try {
    const history = page.getByRole("region", { name: "Your orders" });
    const order = history
      .getByRole("article")
      .filter({ has: page.getByText(paid.reference, { exact: true }) });
    const download = history.getByRole("link", { name: "Download " + paid.title, exact: true });
    const receipt = order.getByRole("button", { name: "Download test purchase receipt" });
    await expect(download).toHaveCount(1);
    await expect(order.getByRole("link", { name: "Download " + paid.title })).toHaveAttribute(
      "href",
      downloadPath,
    );
    await expect(receipt).toBeVisible();
    listing.ownedDownloads = [];
    await page.reload();
    await expect(receipt).toBeVisible();
    await expect(download).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// The purchases screen with nothing for sale and nothing ordered, which is how it opens while no
// document is published with a price. The other tests give the screen an order, so its list with
// no order had never been drawn.
test("with nothing for sale and no order, the purchases screen says so in plain words, keeps what a saved order and a checkout here do not mean, and fits a phone", async () => {
  const { page, errors, unknown, close } = await phone(
    "/workspace/purchases",
    except({
      "GET /workspace/purchases": api.GetCustomerPurchasesResponse.parse({
        available: true,
        message: "Synthetic test fixture: a note in the server's own words.",
        ownedDownloads: [],
        livePaymentsEnabled: false,
        orders: [],
        products: [],
      }),
    }),
  );
  try {
    await ready(page);
    const main = page.locator("main");
    // PAY-003: "a browser success URL alone cannot unlock a template".
    await expect(page.getByTestId("text-purchases-message")).toHaveText(
      "Your orders, their receipts and the licences you accepted are listed here. A saved order is not proof of payment, and neither is coming back from the payment page.",
    );
    // What is switched off, and what a checkout on this screen is.
    await expect(main).toContainText("Real payments are switched off");
    await expect(main).toContainText(
      "Where a checkout is offered here, it is a test, in Paystack's test mode. Do not enter a real card, or real or confidential customer details. A receipt sent by email is not shown as delivered unless its delivery is confirmed.",
    );
    await expect(page.getByRole("heading", { name: "Documents you can buy" })).toBeVisible();
    await expect(page.getByTestId("text-nothing-to-buy")).toHaveText(
      "Nothing can be bought yet. A document is listed here once it is published with a price and a licence. The documents you have made, and their files, stay in your workspace.",
    );
    await expect(page.getByRole("heading", { name: "Your orders" })).toBeVisible();
    const empty = page.getByTestId("status-empty");
    await expect(empty).toContainText("No orders yet");
    await expect(empty).toContainText(
      "An order appears here once you choose a document to buy and accept its licence. Saving an order does not pay for it.",
    );
    await expect(empty.getByRole("link", { name: "Back to Home" })).toHaveAttribute("href", "/workspace");
    // The system's own words for these are gone, and the server's note is not printed.
    const shown = (await main.innerText()).replace(/\s+/g, " ");
    assert.doesNotMatch(
      shown,
      /released documents|approved prices|commercial licences|private exports|test-mode|delivery evidence|checkout return|server's own words/i,
    );
    assert.deepEqual(oldWordsIn(shown), []);
    assert.deepEqual((await wcagFailures(page)).failures, []);
    await settled(page);
    assert.deepEqual(await phoneProblems(page, "the purchases screen with nothing on it"), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// AI-001: "unsupported customer legal requests are directed to a scoped published resource, official
// authority or independent adviser; no adviser availability is implied." The sentence is the one the
// server adds to such a reply (its database test shows that); the screen shows it and offers no save.
test("a drafting request the assistant does not take says so, shows where to go instead, offers no adviser and no save, and leads to a new request", async () => {
  const redirect =
    "This request exceeds the four bounded business tasks. Use a scoped published resource, official authority or independent adviser; no adviser availability is implied.";
  const unsupported = api.GetCustomerAIDraftResponse.parse({
    ...(answers[`GET /workspace/ai-drafts/${DRAFT}`] as object),
    status: "unsupported",
    limitations: ["Synthetic test fixture limitation.", redirect],
  });
  const { page, errors, unknown, close } = await desktop(
    `/workspace/ai/${DRAFT}`,
    except({ [`GET /workspace/ai-drafts/${DRAFT}`]: unsupported }),
  );
  try {
    await ready(page);
    const main = page.locator("main");
    await expect(main).toContainText("Unsupported");
    await expect(main).toContainText("This request cannot be drafted by Valo. Nothing was generated.");
    await expect(main.getByText(redirect)).toBeVisible();
    await expect(page.getByTestId("button-accept-draft")).toHaveCount(0);
    const next = page.getByTestId("link-new-request");
    await expect(next).toHaveText("Start a new request");
    await expect(next).toHaveAttribute("href", "/workspace/ai");
    const shown = (await main.innerText()).replace(/\s+/g, " ");
    assert.doesNotMatch(
      shown,
      /\b(book|contact|call|speak|talk)\b.{0,25}\b(adviser|advisor|lawyer)|\b(adviser|advisor|lawyer)s? (is|are) (available|ready|on hand)/i,
    );
    assert.deepEqual((await wcagFailures(page)).failures, []);
    await next.click();
    await expect(page).toHaveURL(/\/workspace\/ai$/);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

/** A server for the editor's saves: it holds `held()` and refuses a save made from an older version
 * with 409 and the version it holds, as the API does (EDT-004). `GET` answers with the version it
 * holds, under `titleAt(version)`. Every save it is sent is kept in `sent`. */
function documentServer(titleAt: (version: number) => string = () => "Synthetic invoice") {
  const sent: { expectedRevision: number; title: string }[] = [];
  const state = { held: 3, down: false };
  const json = (route: Parameters<Api>[0], status: number, body: unknown) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const serve: Api = async (route, method, path, query) => {
    // With the connection down nothing reaches the server.
    if (state.down) return route.abort("internetdisconnected");
    if (method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      const body = route.request().postDataJSON() as (typeof sent)[number];
      sent.push(body);
      if (body.expectedRevision !== state.held)
        return json(route, 409, {
          error: "This document was saved somewhere else after you opened it. Your text here was not saved.",
          currentRevision: state.held,
        });
      state.held += 1;
      return json(route, 200, api.SaveDocumentResponse.parse({ ...document(state.held), title: body.title }));
    }
    if (method === "GET" && path === `/workspace/documents/${DOCUMENT}`)
      return json(
        route,
        200,
        api.GetDocumentResponse.parse({ ...document(state.held), title: titleAt(state.held) }),
      );
    await answer(route, method, path, query);
  };
  return { sent, state, serve };
}

// EDT-004: "two open tabs cannot silently overwrite each other". The server refuses a save made from
// an older version. The editor says so with the version now saved, stops saving, keeps what was
// typed, and saves it as the newest version only when the customer asks.
test("when the document was saved somewhere else, the editor says so with the version now saved, stops saving, keeps what was typed, and saves it as the newest version only when asked", async () => {
  const server = documentServer((v) =>
    v > 3 ? "Synthetic invoice, saved in another tab" : "Synthetic invoice",
  );
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, server.serve);
  try {
    await ready(page);
    const title = page.getByTestId("input-title"),
      status = page.getByTestId("status-save"),
      conflict = page.getByTestId("notice").filter({ hasText: "Changed somewhere else" });
    await expect(status).toHaveText("Saved · version 3");
    // Another tab saves twice after this one opened version 3.
    server.state.held = 5;
    await title.fill("Synthetic invoice, typed here");
    await expect.poll(() => server.sent.length).toBe(1);
    assert.equal(server.sent[0]!.expectedRevision, 3);
    await expect(status).toHaveText("Not saved — changed somewhere else");
    await expect(conflict.locator("p").first()).toHaveText("Changed somewhere else — now at version 5");
    await expect(conflict).toContainText("What you typed here is still on the screen and has not been lost.");
    await expect(title).toHaveValue("Synthetic invoice, typed here");
    // Nothing more is saved on its own while the two versions differ. The wait is longer than the
    // autosave's.
    await title.fill("Synthetic invoice, typed here, and more");
    await page.waitForTimeout(2200);
    assert.equal(server.sent.length, 1);
    await expect(status).toHaveText("Not saved — changed somewhere else");
    // Asked to, the editor saves what was typed over the newest version, and says so.
    await conflict.getByTestId("button-keep-mine").click();
    await expect(status).toHaveText("Saved · version 6");
    assert.equal(server.sent.length, 2);
    assert.deepEqual(
      { expectedRevision: server.sent[1]!.expectedRevision, title: server.sent[1]!.title },
      { expectedRevision: 5, title: "Synthetic invoice, typed here, and more" },
    );
    await expect(title).toHaveValue("Synthetic invoice, typed here, and more");
    await expect(conflict).toHaveCount(0);
    assert.deepEqual(oldWordsIn(await page.locator("main").innerText()), []);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

test("when the document was saved somewhere else, the customer can load the newest version instead: the editor asks first, keeping changes nothing, and going ahead shows the newest version without saving anything", async () => {
  const server = documentServer((v) =>
    v > 3 ? "Synthetic invoice, saved in another tab" : "Synthetic invoice",
  );
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, server.serve);
  try {
    await ready(page);
    const title = page.getByTestId("input-title"),
      status = page.getByTestId("status-save"),
      dialog = page.getByTestId("dialog-confirm");
    server.state.held = 5;
    await title.fill("Synthetic invoice, typed here");
    await expect(status).toHaveText("Not saved — changed somewhere else");
    await page.getByTestId("button-load-theirs").click();
    await expect(dialog.locator("h2")).toHaveText("Discard what you typed here?");
    await dialog.getByTestId("button-keep").click();
    await expect(dialog).toBeHidden();
    await expect(title).toHaveValue("Synthetic invoice, typed here");
    await expect(status).toHaveText("Not saved — changed somewhere else");
    await page.getByTestId("button-load-theirs").click();
    await dialog.getByTestId("button-confirm").click();
    await expect(title).toHaveValue("Synthetic invoice, saved in another tab");
    await expect(status).toHaveText("Saved · version 5");
    await page.waitForTimeout(2200);
    assert.equal(server.sent.length, 1, "loading the newest version saves nothing");
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// EDT-004: "show saving/saved/offline states". The editor's saves go out even offline, so a save
// made then fails, and the editor saves again on its own when the connection returns.
test("offline, the editor says so; a save that cannot go out says it is not saved and keeps what was typed; and when the connection returns the editor saves what was typed on its own", async () => {
  const server = documentServer();
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, server.serve);
  try {
    await ready(page);
    const title = page.getByTestId("input-title"),
      status = page.getByTestId("status-save"),
      offline = page.getByTestId("notice").filter({ hasText: "You are offline" }),
      failed = page.locator('p[role="alert"]', { hasText: "What you typed is still here." });
    await expect(status).toHaveText("Saved · version 3");
    server.state.down = true;
    await page.context().setOffline(true);
    await expect(offline).toContainText(
      "Keep editing — your changes stay in this browser tab and will save automatically when your connection returns.",
    );
    await title.fill("Synthetic invoice, typed offline");
    await expect(status).toHaveText("Not saved");
    await expect(failed).toHaveText(
      "You seem to be offline. Reconnect and try again. What you typed is still here.",
    );
    await expect(title).toHaveValue("Synthetic invoice, typed offline");
    assert.equal(server.sent.length, 0);
    server.state.down = false;
    await page.context().setOffline(false);
    await expect(status).toHaveText("Saved · version 4");
    assert.deepEqual(server.sent, [
      { ...server.sent[0]!, expectedRevision: 3, title: "Synthetic invoice, typed offline" },
    ]);
    await expect(offline).toHaveCount(0);
    await expect(failed).toHaveCount(0);
    await expect(title).toHaveValue("Synthetic invoice, typed offline");
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// EDT-004: "retry preserves unsaved text in memory".
test("a save the server could not take says what happened, keeps what was typed, and Retry sends exactly what is on the screen", async () => {
  const server = documentServer();
  let refuse = true;
  const serve: Api = async (route, method, path, query) => {
    if (refuse && method === "PATCH" && path === `/workspace/documents/${DOCUMENT}`) {
      refuse = false;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "Synthetic test fixture: saving is briefly unavailable." }),
      });
    }
    await server.serve(route, method, path, query);
  };
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, serve);
  try {
    await ready(page);
    const title = page.getByTestId("input-title"),
      status = page.getByTestId("status-save");
    await title.fill("Synthetic invoice, kept through a failed save");
    await expect(status).toHaveText("Not saved");
    await expect(page.locator('p[role="alert"]', { hasText: "What you typed is still here." })).toHaveText(
      "Synthetic test fixture: saving is briefly unavailable. What you typed is still here.",
    );
    await expect(title).toHaveValue("Synthetic invoice, kept through a failed save");
    assert.equal(server.sent.length, 0);
    await page.getByTestId("button-retry-save").click();
    await expect(status).toHaveText("Saved · version 4");
    assert.equal(server.sent.length, 1);
    assert.equal(server.sent[0]!.title, "Synthetic invoice, kept through a failed save");
    assert.equal(server.sent[0]!.expectedRevision, 3);
    await expect(page.getByTestId("button-retry-save")).toHaveCount(0);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});

// EDT-003: "Support section-level text editing, undo, preview and a clear draft status."
test("undo and redo step back and forward through the editor's changes, with the buttons and with the keyboard outside a text box, and each step is saved as shown", async () => {
  const server = documentServer();
  const { page, errors, unknown, close } = await desktop(`/workspace/documents/${DOCUMENT}`, server.serve);
  try {
    await ready(page);
    const title = page.getByTestId("input-title"),
      status = page.getByTestId("status-save"),
      undo = page.getByTestId("button-undo"),
      redo = page.getByTestId("button-redo");
    await expect(undo).toBeDisabled();
    await expect(redo).toBeDisabled();
    // Two changes, far enough apart to be two steps.
    await title.fill("Synthetic invoice, first change");
    await page.waitForTimeout(900);
    await title.fill("Synthetic invoice, second change");
    await undo.click();
    await expect(title).toHaveValue("Synthetic invoice, first change");
    await expect(redo).toBeEnabled();
    await redo.click();
    await expect(title).toHaveValue("Synthetic invoice, second change");
    // The keyboard, with focus outside a text box, where the browser's own undo does not apply.
    await page.getByTestId("status-save").click();
    await page.keyboard.press("Control+z");
    await expect(title).toHaveValue("Synthetic invoice, first change");
    await page.keyboard.press("Control+z");
    await expect(title).toHaveValue("Synthetic invoice");
    await expect(undo).toBeDisabled();
    await page.keyboard.press("Control+Shift+z");
    await expect(title).toHaveValue("Synthetic invoice, first change");
    // What is saved is what the screen shows.
    await expect(status).toHaveText(/^Saved · version \d+$/);
    assert.equal(server.sent.at(-1)!.title, "Synthetic invoice, first change");
    assert.equal(server.sent.at(-1)!.expectedRevision, server.state.held - 1);
    assert.deepEqual(errors, []);
    assert.deepEqual(unknown, []);
  } finally {
    await close();
  }
});
