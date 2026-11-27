/**
 * The single place API and worker code reads environment variables.
 *
 * Every variable is registered here with its purpose. Product code reads a value
 * with `setting("NAME")` (typed: an unregistered name does not compile) or, for
 * validators that check several related values together, `environment()`.
 * Values are read at call time, so tests that change process.env still work.
 *
 * `.env.example` at the repository root is generated from this registry by
 * `pnpm --filter @workspace/api-server settings:env-example`; a test fails when it
 * is stale or when product code reads an unregistered variable.
 */

type Group =
  | "Runtime"
  | "Identity and request security"
  | "Request limits"
  | "Database"
  | "Files and exports"
  | "Payments (test mode only)"
  | "AI"
  | "Email"
  | "Worker and monitoring"
  | "Production rehearsal"
  | "Recovery"
  | "Editorial"
  | "Operator commands"
  | "Test harness";

export type SettingDefinition = {
  group: Group;
  description: string;
  /** Never commit a value; configure it in the server secret store. */
  secret?: boolean;
  /** Value shown in .env.example. Omitted for secrets. */
  example?: string;
  /** Set by the platform or another process rather than configured by hand. */
  setBy?: string;
};

export const SETTINGS = {
  NODE_ENV: {
    group: "Runtime",
    description:
      "`development` enables development-only features. `production` serves only GET /api/healthz (private rehearsal).",
    example: "development",
  },
  REPLIT_DEPLOYMENT: {
    group: "Runtime",
    description: "Any non-empty value disables development-only features.",
    setBy: "Replit deployments",
  },
  REPLIT_DEV_DOMAIN: {
    group: "Runtime",
    description: "Workspace preview domain; the default trusted origin in development.",
    setBy: "Replit workspace",
  },
  PORT: { group: "Runtime", description: "HTTP port the API listens on.", example: "8080" },
  LOG_LEVEL: { group: "Runtime", description: "pino log level.", example: "info" },
  VALO_PRETTY_LOGS: { group: "Runtime", description: "Set to 1 for human-readable development logs." },

  CLERK_SECRET_KEY: {
    group: "Identity and request security",
    description: "Clerk backend key.",
    secret: true,
  },
  CLERK_PUBLISHABLE_KEY: {
    group: "Identity and request security",
    description: "Clerk publishable key (also used by the web app).",
  },
  SESSION_SECRET: {
    group: "Identity and request security",
    description:
      "At least 32 characters. Keys rate-limit pseudonyms, the default privacy signing key and the recovery journal MAC.",
    secret: true,
  },
  VALO_PRIVACY_KEYRING: {
    group: "Identity and request security",
    description: "JSON keyring of current and historical privacy signing keys, for key rotation.",
    secret: true,
  },
  VALO_TRUSTED_ORIGIN: {
    group: "Identity and request security",
    description: "Exact origin (scheme, host, port) allowed to send writes. Writes return 503 when unset.",
    example: "https://valo.example",
  },
  VALO_TRUSTED_PROXY_CIDRS: {
    group: "Identity and request security",
    description: "Comma-separated CIDRs of reverse proxies whose forwarding headers are trusted.",
  },

  // Each request limit, with today's ceiling as its default (SEC-005: configurable ceilings). A value must
  // be a whole number from 1 to 10,000; the API and the worker refuse to start on any other.
  VALO_LIMIT_PUBLIC_SUPPORT: {
    group: "Request limits",
    description:
      "Support requests from people not signed in, from one contact address a minute (1-10000, default 3).",
    example: "3",
  },
  VALO_LIMIT_PUBLIC_SUPPORT_DAY: {
    group: "Request limits",
    description:
      "Support requests from people not signed in, from one contact address a day (1-10000, default 20).",
    example: "20",
  },
  VALO_LIMIT_PUBLIC_SUPPORT_SOCKET: {
    group: "Request limits",
    description:
      "Support requests from people not signed in, from one network address a minute (1-10000, default 20).",
    example: "20",
  },
  VALO_LIMIT_PUBLIC_SUPPORT_SOCKET_DAY: {
    group: "Request limits",
    description:
      "Support requests from people not signed in, from one network address a day (1-10000, default 100).",
    example: "100",
  },
  VALO_LIMIT_PUBLIC_SUPPORT_ALL: {
    group: "Request limits",
    description:
      "Support requests from people not signed in, from everyone together a minute (1-10000, default 100).",
    example: "100",
  },
  VALO_LIMIT_PUBLIC_SUPPORT_ALL_DAY: {
    group: "Request limits",
    description:
      "Support requests from people not signed in, from everyone together a day (1-10000, default 1000).",
    example: "1000",
  },
  VALO_LIMIT_ANONYMOUS_READ: {
    group: "Request limits",
    description: "Reads by one visitor or address not signed in, a minute (1-10000, default 60).",
    example: "60",
  },
  VALO_LIMIT_AUTHENTICATED_READ: {
    group: "Request limits",
    description: "Reads by one signed-in account a minute (1-10000, default 120).",
    example: "120",
  },
  VALO_LIMIT_PAGE_RENDER_READ: {
    group: "Request limits",
    description:
      "Reads by every page the web server renders, for all visitors together, a minute (1-10000, default 600).",
    example: "600",
  },
  VALO_LIMIT_CUSTOMER_AI: {
    group: "Request limits",
    description: "Drafting assistant requests by one account a minute (1-10000, default 5).",
    example: "5",
  },
  VALO_LIMIT_CHECKOUT_CREATE: {
    group: "Request limits",
    description: "Checkouts begun by one account a minute (1-10000, default 10).",
    example: "10",
  },
  VALO_LIMIT_CHECKOUT_CREATE_DAY: {
    group: "Request limits",
    description: "Checkouts begun by one account a day (1-10000, default 100).",
    example: "100",
  },
  VALO_LIMIT_EXPORT_CREATE: {
    group: "Request limits",
    description: "Document exports asked for by one account a minute (1-10000, default 10).",
    example: "10",
  },
  VALO_LIMIT_PROFILE_WRITE: {
    group: "Request limits",
    description: "Business profile changes by one account a minute (1-10000, default 20).",
    example: "20",
  },
  VALO_LIMIT_PROFILE_WRITE_DAY: {
    group: "Request limits",
    description: "Business profile changes by one account a day (1-10000, default 200).",
    example: "200",
  },
  VALO_LIMIT_DOCUMENT_WRITE: {
    group: "Request limits",
    description: "Document changes by one account a minute (1-10000, default 30).",
    example: "30",
  },
  VALO_LIMIT_DOCUMENT_WRITE_DAY: {
    group: "Request limits",
    description: "Document changes by one account a day (1-10000, default 600).",
    example: "600",
  },
  VALO_LIMIT_SUPPORT_WRITE: {
    group: "Request limits",
    description: "Support messages by one signed-in customer a minute (1-10000, default 3).",
    example: "3",
  },
  VALO_LIMIT_SUPPORT_WRITE_DAY: {
    group: "Request limits",
    description: "Support messages by one signed-in customer a day (1-10000, default 20).",
    example: "20",
  },
  VALO_LIMIT_STAFF_SUPPORT_WRITE: {
    group: "Request limits",
    description: "Support actions by one member of staff a minute (1-10000, default 20).",
    example: "20",
  },
  VALO_LIMIT_STAFF_SUPPORT_WRITE_DAY: {
    group: "Request limits",
    description: "Support actions by one member of staff a day (1-10000, default 200).",
    example: "200",
  },
  VALO_LIMIT_REFUND_CREATE: {
    group: "Request limits",
    description: "Refund requests by one account a minute (1-10000, default 10).",
    example: "10",
  },
  VALO_LIMIT_REFUND_CREATE_DAY: {
    group: "Request limits",
    description: "Refund requests by one account a day (1-10000, default 50).",
    example: "50",
  },

  DATABASE_URL: { group: "Database", description: "PostgreSQL connection string.", secret: true },

  PRIVATE_OBJECT_DIR: {
    group: "Files and exports",
    description: "Replit App Storage private directory for development exports.",
  },
  VALO_PRODUCTION_PRIVATE_OBJECT_DIR: {
    group: "Files and exports",
    description: "Separate, non-overlapping private directory for the production rehearsal.",
  },
  CHROMIUM_EXECUTABLE_PATH: {
    group: "Files and exports",
    description: "Chromium used to render PDFs.",
    example: "/repl/tools/bin/chromium",
  },
  VALO_EXPORT_RETENTION_DAYS: {
    group: "Files and exports",
    description: "Days a generated export stays downloadable (1-365).",
    example: "30",
  },

  PAYSTACK_SECRET_KEY: {
    group: "Payments (test mode only)",
    description: "Paystack key. Must start with sk_test_; live keys are refused.",
    secret: true,
  },
  PAYSTACK_WEBHOOK_MODE: {
    group: "Payments (test mode only)",
    description: "`timestamped` or `legacy` webhook signature mode.",
  },
  PAYSTACK_WEBHOOK_SECRET: {
    group: "Payments (test mode only)",
    description: "Secret for timestamped webhook signatures.",
    secret: true,
  },
  VALO_SANDBOX_CHECKOUT_ENABLED: {
    group: "Payments (test mode only)",
    description: "`true` enables test-mode checkout and webhooks in development.",
    example: "false",
  },
  VALO_SANDBOX_REFUNDS_ENABLED: {
    group: "Payments (test mode only)",
    description: "`true` enables test-mode refunds.",
    example: "false",
  },
  VALO_SANDBOX_DISPUTES_ENABLED: {
    group: "Payments (test mode only)",
    description: "`true` enables test-mode dispute actions.",
    example: "false",
  },

  VALO_CUSTOMER_AI_ENABLED: {
    group: "AI",
    description:
      "Must be `false` in the production rehearsal. Customer AI otherwise runs only inside an owner-approved finite budget context.",
    example: "false",
  },

  VALO_EMAIL_MODE: {
    group: "Email",
    description: "`development-test` enables the single-recipient test mailer.",
  },
  VALO_EMAIL_OUTBOX_ENABLED: {
    group: "Email",
    description: "`development-test` lets the reminder worker send through the test mailer.",
  },
  VALO_EMAIL_FROM: { group: "Email", description: "Verified sender address for test email." },
  VALO_EMAIL_TEST_RECIPIENT: {
    group: "Email",
    description: "The only recipient test email may reach; must match the user's verified address.",
  },
  VALO_MESSAGE_SENDER: {
    group: "Email",
    description:
      "`stand-in` lets the worker hand each message Valo owes, such as a receipt, to the stand-in, which sends nothing. Unset, every message waits. Refused in production.",
  },

  VALO_WORKER_HEALTH_PORT: {
    group: "Worker and monitoring",
    description: "Loopback port for the worker's /healthz and /readyz.",
  },
  VALO_SUPERVISED_WORKER: {
    group: "Worker and monitoring",
    description: "`ipc-v1` when the worker runs under the supervisor.",
    setBy: "export supervisor",
  },
  VALO_WORKER_TOPOLOGY: {
    group: "Worker and monitoring",
    description: "Must be `replit-reserved-vm-same-app` for the production rehearsal.",
  },
  VALO_WORKER_REPLICAS: {
    group: "Worker and monitoring",
    description: "Number of worker processes (the rehearsal requires 1).",
  },
  VALO_EXPORT_CONCURRENCY: {
    group: "Worker and monitoring",
    description:
      "Concurrent document export jobs per worker (1-5). Bounded by VALO_DB_POOL_MAX minus reserved operational slots.",
    example: "1",
  },
  VALO_EXTERNAL_MONITORING: {
    group: "Worker and monitoring",
    description: "`healthchecks` enables external heartbeat pings.",
  },
  VALO_WORKER_MONITOR_URL: {
    group: "Worker and monitoring",
    description: "Healthchecks ping URL for the worker.",
    secret: true,
  },
  VALO_OPERATIONS_MONITOR_URL: {
    group: "Worker and monitoring",
    description: "Healthchecks ping URL for operations alerts.",
    secret: true,
  },
  VALO_FRONTEND_PORT: {
    group: "Worker and monitoring",
    description: "Web app port; must differ from the API and worker health ports.",
  },

  VALO_RUNTIME_ACTIVATION: {
    group: "Production rehearsal",
    description: "`private-rehearsal-v1` to start API and worker in the private production rehearsal.",
  },
  VALO_RELEASE_SHA: {
    group: "Production rehearsal",
    description: "Commit the release manifest was built from.",
  },
  VALO_PRODUCTION_DATABASE_ID: {
    group: "Production rehearsal",
    description: "Expected instance UUID in the rehearsal database's valo_runtime_identity row.",
  },
  VALO_EMPTY_DATABASE_BOOTSTRAP: {
    group: "Production rehearsal",
    description: "`approved-empty-rehearsal` for the one-time bootstrap of an empty rehearsal database.",
  },

  VALO_ISOLATED_RECOVERY: {
    group: "Recovery",
    description: "Set during isolated recovery drills; any value blocks Paystack and email effects.",
  },
  VALO_RECOVERY_WINDOWS_ROOT: {
    group: "Recovery",
    description: "Restore root for the separate-host (Windows) recovery replay.",
  },

  VALO_OPERATIONAL_AUTHORING: {
    group: "Editorial",
    description: "`recorded` reuses the recorded original authoring run instead of new drafting.",
  },
  VALO_MANUAL_OFFICIAL_CAPTURE_DIR: {
    group: "Editorial",
    description:
      "Private development directory for operator-retained NDPC PDFs and their dated official retrieval receipts.",
  },
  VALO_EDITORIAL_LIFECYCLE_DATABASE_URL: {
    group: "Editorial",
    description:
      "Separately prepared genuine-evidence seed database that editorial lifecycle cases clone into a disposable database (development only).",
    secret: true,
  },
  VALO_EDITORIAL_LIFECYCLE_PUBLISHER_DATABASE_URL: {
    group: "Editorial",
    description:
      "The lifecycle seed database's server, logged in as valo_publisher_login. A lifecycle case that releases a version does so on its disposable copy through this login; without it such a case fails as the publisher login is unavailable (development only).",
    secret: true,
  },
  VALO_RUN_EDITORIAL_PROOF: {
    group: "Editorial",
    description: "`official-development-only` to run the development editorial proof.",
  },

  VALO_RETENTION_INSPECTION: {
    group: "Operator commands",
    description: "`read-only` to run the legacy export retention inventory.",
  },
  VALO_PRODUCTION_STORAGE_PROBE: {
    group: "Operator commands",
    description: "Opt-in for the production storage isolation probe.",
  },
  VALO_STAFF_BOOTSTRAP: {
    group: "Operator commands",
    description: "`first-system-administrator` to confirm the one-time first administrator bootstrap.",
  },
  VALO_MONITORING_PROBE: {
    group: "Operator commands",
    description: "Opt-in for the external monitoring delivery probe.",
  },

  VALO_RUN_DB_TESTS: { group: "Test harness", description: "Opt-in for synthetic database tests." },
  VALO_RUN_DISPUTE_TESTS: { group: "Test harness", description: "Opt-in for dispute fault-injection tests." },
  VALO_RUN_REFUND_TESTS: { group: "Test harness", description: "Opt-in for refund fault-injection tests." },
  VALO_RUN_EXPORT_CRASH_TESTS: { group: "Test harness", description: "Opt-in for export crash tests." },
  VALO_EXPORT_CRASH_JOB: { group: "Test harness", description: "Export job the crash harness interrupts." },
  VALO_EXPORT_CRASH_STAGE: {
    group: "Test harness",
    description: "Export stage the crash harness interrupts.",
  },
  VALO_DISPUTE_CRASH: {
    group: "Test harness",
    description: "JSON instructions for the dispute crash child.",
  },
  VALO_SYNTHETIC_RECEIPT_RECOVERY: {
    group: "Test harness",
    description: "`owned-recorded-fixtures-only` for the synthetic receipt recovery maintenance run.",
  },
} as const satisfies Record<string, SettingDefinition>;

export type SettingName = keyof typeof SETTINGS;

/** Current raw value of a registered variable, or undefined when unset. */
export function setting(name: SettingName): string | undefined {
  return process.env[name];
}

/** The whole environment, for validators that check several registered values together. */
export function environment(): NodeJS.ProcessEnv {
  return process.env;
}

/** Variables read by other workspace packages and the web app, listed in .env.example. */
export const OTHER_PACKAGE_SETTINGS: Record<string, SettingDefinition> = {
  AI_INTEGRATIONS_OPENAI_BASE_URL: {
    group: "AI",
    description: "Replit AI Integrations base URL (read by lib/integrations-openai-ai-server).",
  },
  AI_INTEGRATIONS_OPENAI_API_KEY: {
    group: "AI",
    description: "Replit AI Integrations key (read by lib/integrations-openai-ai-server).",
    secret: true,
  },
  CLERK_PROXY_URL: {
    group: "Identity and request security",
    description: "Clerk proxy URL for the web app.",
  },
  BASE_PATH: { group: "Runtime", description: "Path prefix the web app is served under.", example: "/" },
  VALO_API_INTERNAL_ORIGIN: {
    group: "Runtime",
    description:
      "The API's address on this machine for the web server's page renders, plain http to loopback or https (read by the web app). Unset, they use the configured public origin; dev:compiled sets http://127.0.0.1:8080.",
    example: "http://127.0.0.1:8080",
  },
  VALO_DEVELOPMENT_SITE: {
    group: "Runtime",
    description:
      "`compiled` marks the compiled development site, which the Replit workspace's preview may show (read by the web app). Ignored in a deployment.",
    setBy: "the web app's dev:compiled command",
  },
  VALO_CUSTOMER_DATABASE_URL: {
    group: "Database",
    description:
      "The same database, logged in as valo_workspace_login, for customer requests and the worker's jobs for one workspace (read by lib/db; lib/db/scripts/workspace-login.mjs prints it). Direct or through a session pooler, not a transaction pooler. Both fail while it is unset.",
    secret: true,
  },
  VALO_DB_POOL_MAX: {
    group: "Database",
    description:
      "Maximum application PostgreSQL pool connections per process (1-100, default 10; read by lib/db).",
    example: "10",
  },
  VALO_CUSTOMER_DB_POOL_MAX: {
    group: "Database",
    description:
      "Maximum workspace-scoped PostgreSQL pool connections per process (1-100, default 10; read by lib/db).",
    example: "10",
  },
  VALO_WORKSPACE_LOGIN_PASSWORD: {
    group: "Database",
    description:
      "Password lib/db/scripts/workspace-login.mjs gives valo_workspace_login when an operator enables it; at least 24 printable ASCII characters. The application never reads it.",
    secret: true,
  },
  VALO_PUBLISHER_DATABASE_URL: {
    group: "Database",
    description:
      "The same database, logged in as valo_publisher_login, for releasing a content version (read by lib/db; lib/db/scripts/publisher-login.mjs prints it). The database publishes a version only in a session that logged in as this login, so a release fails while it is unset. Give it only to the process that publishes.",
    secret: true,
  },
  VALO_PUBLISHER_LOGIN_PASSWORD: {
    group: "Database",
    description:
      "Password lib/db/scripts/publisher-login.mjs gives valo_publisher_login when an operator enables it; at least 24 printable ASCII characters. The application never reads it.",
    secret: true,
  },
  VALO_DRAFTER_DATABASE_URL: {
    group: "Database",
    description:
      "The same database, logged in as valo_drafter_login, for adding a content version or a prepared candidate (read by lib/db; lib/db/scripts/drafter-login.mjs prints it). The database adds content only in a session that logged in as this login, so preparing a candidate fails while it is unset. Give it only to the commands that prepare and to the worker, never to the API.",
    secret: true,
  },
  VALO_DRAFTER_LOGIN_PASSWORD: {
    group: "Database",
    description:
      "Password lib/db/scripts/drafter-login.mjs gives valo_drafter_login when an operator enables it; at least 24 printable ASCII characters. The application never reads it.",
    secret: true,
  },
  VALO_REVIEWER_DATABASE_URL: {
    group: "Database",
    description:
      "The same database, logged in as valo_reviewer_login, for recording an AI review's attempt (read by lib/db; lib/db/scripts/reviewer-login.mjs prints it). The database records a review's attempt only in a session that logged in as this login, so a review fails while it is unset. Give it only to the commands that run reviews, never to the API or the worker.",
    secret: true,
  },
  VALO_REVIEWER_LOGIN_PASSWORD: {
    group: "Database",
    description:
      "Password lib/db/scripts/reviewer-login.mjs gives valo_reviewer_login when an operator enables it; at least 24 printable ASCII characters. The application never reads it.",
    secret: true,
  },
};

export function renderEnvExample(): string {
  const all = { ...SETTINGS, ...OTHER_PACKAGE_SETTINGS } as Record<string, SettingDefinition>;
  const groups = new Map<Group, [string, SettingDefinition][]>();
  for (const [name, definition] of Object.entries(all)) {
    if (definition.group === "Test harness") continue;
    groups.set(definition.group, [...(groups.get(definition.group) ?? []), [name, definition]]);
  }
  const lines = [
    "# Generated by `pnpm --filter @workspace/api-server settings:env-example`. Do not edit by hand.",
    "# Never commit real values. Secrets belong in the server secret store.",
    "",
  ];
  for (const [group, entries] of groups) {
    lines.push(`# --- ${group} ---`);
    for (const [name, definition] of entries) {
      const notes = [definition.description];
      if (definition.secret) notes.push("Secret.");
      if (definition.setBy) notes.push(`Set by ${definition.setBy}.`);
      lines.push(`# ${notes.join(" ")}`);
      lines.push(
        `${definition.setBy ? "# " : ""}${name}=${definition.secret ? "" : (definition.example ?? "")}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}
