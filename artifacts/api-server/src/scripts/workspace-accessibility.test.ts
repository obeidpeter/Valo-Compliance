import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { expect, type Page } from "@playwright/test";
import * as api from "@workspace/api-zod";
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
  { path: `/workspace/documents/${DOCUMENT}`, title: "Document editor" },
  { path: "/workspace/checker", title: "Business requirements checker" },
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
