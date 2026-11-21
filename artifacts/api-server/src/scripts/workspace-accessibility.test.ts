import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { expect, type Page } from "@playwright/test";
import * as api from "@workspace/api-zod";
import { GUIDED_TEMPLATE_IDS } from "@workspace/valo-core/guided";
import { compileGuidedContent, emptyGuidedData } from "@workspace/valo-core/guided-runtime";
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
  [`GET /workspace`]: api.GetWorkspaceResponse.parse({
    id: WORKSPACE,
    profileRevision: 3,
    profile,
    documentCount: 1,
  }),
  [`GET /workspace/documents`]: api.ListDocumentsResponse.parse([document(3)]),
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
  [`GET /v1/exports`]: api.ListWorkspaceExportsResponse.parse([
    {
      id: "00000000-0000-4000-8000-00000000a601",
      documentId: DOCUMENT,
      documentTitle: "Synthetic invoice",
      revisionId: document(3).revisionId,
      revision: 3,
      format: "pdf",
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

/** Each signed-in screen, the title it gives the page, and for the staff screen the area shown. */
const SIGNED_IN: { path: string; title: string; area?: string }[] = [
  { path: "/workspace", title: "Your workspace" },
  { path: "/workspace/documents", title: "Your documents" },
  { path: "/workspace/documents/new", title: "New document" },
  { path: `/workspace/documents/${DOCUMENT}`, title: "Document editor" },
  { path: "/workspace/checker", title: "Check your requirements" },
  { path: "/workspace/assessments", title: "Assessment history" },
  { path: `/workspace/assessments/${ASSESSMENT}`, title: "Assessment" },
  { path: "/workspace/ai", title: "Drafting assistant" },
  { path: `/workspace/ai/${DRAFT}`, title: "Draft preview" },
  { path: "/workspace/tasks", title: "Tasks" },
  { path: "/workspace/reminders", title: "Reminders" },
  { path: "/workspace/notifications", title: "Reminders" },
  { path: "/workspace/profile", title: "Business profile" },
  { path: "/workspace/purchases", title: "Purchases and licences" },
  { path: "/workspace/account", title: "Sign-in and security" },
  { path: "/workspace/privacy", title: "Your data and privacy requests" },
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

test("the account menu lists the account's three pages, closes with Escape, a click elsewhere or focus moving on, returns focus to its button, and leaves sign out beside it", async () => {
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
  // the account's three pages and sign out. Inside the workspace it has help, those pages and sign out.
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
    const { page, errors, close } = await open("/workspace/checker");
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

  // Each way to start saves a new document, named for what was chosen, and opens its editor.
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
    await expect(page.getByTestId("preview-doc")).toContainText(
      /Draft · version 3 · your own document, not reviewed/i,
    );
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
          ...table.columns
            .filter((c) => c.required && !c.when)
            .map((c) => `${table.label}, row 1: ${c.label}`),
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
      assert.doesNotMatch(shown, /TPL-\d+|Guided form|\brev\b|\brevisions?\b|business draft|\bexports?\b/i);
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
