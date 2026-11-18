/**
 * NFR-011 asks for "80% branch coverage in payment/auth/rules modules". These are the three
 * areas: their product source files, the tests that exercise them, and the file names that
 * belong to each area, so a new payment, sign-in or checker file cannot fall outside its area
 * unnoticed. code-coverage.ts runs an area's tests in one Node test run in CI's database job, where
 * every one of them can run. Paths are relative to the repository root.
 */
export type CoverageArea = {
  /** What the area is, in the words of the requirement. */
  title: string;
  sources: string[];
  /** Files with a name that belongs to the area but that are not product code, and why. */
  excluded: Record<string, string>;
  /** File names that belong to the area. */
  pattern: RegExp;
  tests: string[];
  /** Tests of the area that the coverage run cannot run a second time, and why. */
  notRerun: Record<string, string>;
};

const api = (path: string) => `artifacts/api-server/src/${path}`;

export const COVERAGE_AREAS = {
  payment: {
    title: "payment",
    sources: [
      api("modules/commerce/valo-commerce.ts"),
      api("modules/commerce/valo-dispute-actions.ts"),
      api("modules/commerce/valo-dispute-provider.ts"),
      api("modules/commerce/valo-dispute-schema.ts"),
      api("modules/commerce/valo-payment-concerns.ts"),
      api("modules/commerce/valo-payment-disputes.ts"),
      api("modules/commerce/valo-paystack-contract.ts"),
      api("modules/commerce/valo-receipt-provenance.ts"),
      api("modules/commerce/valo-receipt-recovery-report.ts"),
      api("modules/commerce/valo-refund-provider.ts"),
      api("modules/commerce/valo-refunds.ts"),
      api("routes/valo-commerce.ts"),
      api("routes/valo-payment-concerns.ts"),
      api("routes/valo-paystack-webhook.ts"),
    ],
    excluded: {
      [api("modules/commerce/valo-dispute-workflow-fixture.ts")]:
        "synthetic disputes for the browser checks, not product code",
      [api("modules/commerce/valo-dispute-action-crash.ts")]:
        "crash injection for the recovery tests, not product code",
    },
    pattern:
      /^artifacts\/api-server\/src\/(lib|routes|middlewares|platform|modules\/commerce)\/valo-(commerce|refund|dispute|paystack|payment|receipt|checkout|order|entitlement)[a-z-]*\.ts$/,
    tests: [
      api("modules/commerce/valo-commerce.integration.test.ts"),
      api("modules/commerce/valo-refunds.integration.test.ts"),
      api("modules/commerce/valo-refund-provider.test.ts"),
      api("modules/commerce/valo-dispute-provider.test.ts"),
      api("modules/commerce/valo-dispute-actions.integration.test.ts"),
      api("routes/valo-disputes-http.integration.test.ts"),
      api("modules/commerce/valo-paystack-http.integration.test.ts"),
      api("modules/commerce/valo-paystack-contract.test.ts"),
      api("modules/commerce/valo-receipt-recovery-report.test.ts"),
      api("modules/commerce/valo-receipt-recovery.integration.test.ts"),
      api("lib/valo-recovery-effects.test.ts"),
      api("lib/valo-template-entitlement.integration.test.ts"),
    ],
    notRerun: {},
  },
  auth: {
    title: "auth",
    sources: [
      api("lib/valo-download-session.ts"),
      api("lib/valo-managed-session.ts"),
      api("lib/valo-proxy-boundary.ts"),
      api("lib/valo-staff-authority.ts"),
      api("lib/valo-staff-roles.ts"),
      api("middlewares/clerkProxyMiddleware.ts"),
      api("middlewares/valo-identity.ts"),
      api("middlewares/valo-staff-gate.ts"),
      api("platform/session-verification.ts"),
      api("platform/workspace-context.ts"),
      api("routes/valo-session-verification.ts"),
      api("routes/valo-staff-roles.ts"),
    ],
    excluded: {},
    pattern:
      /^artifacts\/api-server\/src\/(lib|routes|middlewares|platform)\/(valo-(managed-session|download-session|proxy-boundary|staff-authority|staff-roles|staff-gate|identity|session-verification)|clerkProxyMiddleware|session-verification|workspace-context)\.ts$/,
    tests: [
      api("lib/valo-managed-session.test.ts"),
      api("lib/valo-proxy-boundary.test.ts"),
      api("middlewares/clerkProxyMiddleware.test.ts"),
      api("platform/session-verification.test.ts"),
      api("lib/valo-download-session.test.ts"),
      api("routes/valo-tenant-substitution.integration.test.ts"),
      api("platform/workspace-row-security.integration.test.ts"),
      api("lib/valo-staff-bootstrap.integration.test.ts"),
    ],
    notRerun: {
      [api("lib/valo-staff-roles.integration.test.ts")]:
        "refuses a database that already holds an administrator, and the job has already run it once",
    },
  },
  rules: {
    title: "rules",
    sources: [
      "lib/valo-core/src/checker.ts",
      "lib/valo-core/src/checker-rich.ts",
      "lib/valo-core/src/checker-business-name.ts",
      "lib/valo-core/src/checker-source-candidates.ts",
      api("modules/rules/valo-assessments.ts"),
    ],
    excluded: {},
    pattern:
      /^(lib\/valo-core\/src\/checker[a-z-]*|artifacts\/api-server\/src\/modules\/rules\/valo-assessments)\.ts$/,
    tests: [
      api("modules/rules/valo-checker-rich.test.ts"),
      "artifacts/valo/src/lib/rich-checker.test.ts",
      api("routes/valo-checker-http.integration.test.ts"),
      api("modules/sources/business-name-candidate-evaluation.test.ts"),
      api("modules/sources/source-candidate-evaluation.test.ts"),
      api("lib/valo-requirements.integration.test.ts"),
      api("lib/valo-task-source-guard.integration.test.ts"),
    ],
    notRerun: {},
  },
} satisfies Record<string, CoverageArea>;

export type CoverageAreaName = keyof typeof COVERAGE_AREAS;
export const NFR_011_MINIMUM_BRANCH_PERCENT = 80;
