import { lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useAuth, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { AccountStateBoundary } from "@/components/account-state-boundary";
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SiteShell } from "@/components/site-shell";
import { RequireAuth } from "@/components/require-auth";
import { Wordmark } from "@/components/brand";
import { basePath } from "@/lib/env";
import { useDocumentTitle } from "@/lib/document-title";
import { publicPages } from "@/lib/public-pages";
import NotFound from "@/screens/not-found";

// Each screen is its own chunk, so a page downloads only the screens it shows, not the whole
// workspace and staff app (NFR-002).
const Home = lazy(() => import("@/screens/home"));
const Library = lazy(() => import("@/screens/library"));
const TemplateDetail = lazy(() => import("@/screens/template-detail"));
const Compliance = lazy(() => import("@/screens/compliance"));
const Industries = lazy(() => import("@/screens/industries"));
const IndustryDetail = lazy(() =>
  import("@/screens/industries").then((m) => ({ default: m.IndustryDetail })),
);
const Resources = lazy(() => import("@/screens/resources"));
const ResourceDetail = lazy(() => import("@/screens/resources").then((m) => ({ default: m.ResourceDetail })));
const About = lazy(() => import("@/screens/about"));
const Contact = lazy(() => import("@/screens/contact").then((m) => ({ default: m.Contact })));
const AccountAccess = lazy(() => import("@/screens/contact").then((m) => ({ default: m.AccountAccess })));
const AccountPage = lazy(() => import("@/screens/account").then((m) => ({ default: m.AccountPage })));
const PrivacyPage = lazy(() => import("@/screens/account").then((m) => ({ default: m.PrivacyPage })));
const PurchasesPage = lazy(() => import("@/screens/account").then((m) => ({ default: m.PurchasesPage })));
const StaffPage = lazy(() => import("@/screens/staff"));
const PrivacyOperations = lazy(() => import("@/screens/privacy-operations"));
const Services = lazy(() => import("@/screens/services"));
const Pricing = lazy(() => import("@/screens/pricing"));
const Help = lazy(() => import("@/screens/help"));
const Support = lazy(() => import("@/screens/support"));
const Privacy = lazy(() => import("@/screens/privacy"));
const Terms = lazy(() => import("@/screens/terms"));
const Development = lazy(() => import("@/screens/development"));
const WorkspaceHome = lazy(() => import("@/screens/workspace"));
const ProfilePage = lazy(() => import("@/screens/profile"));
const DocumentEditor = lazy(() => import("@/screens/document-editor"));
const Checker = lazy(() => import("@/screens/checker"));
const AssessmentsList = lazy(() =>
  import("@/screens/assessments").then((m) => ({ default: m.AssessmentsList })),
);
const AssessmentDetail = lazy(() =>
  import("@/screens/assessments").then((m) => ({ default: m.AssessmentDetail })),
);
const TasksPage = lazy(() => import("@/screens/tasks"));
const RemindersPage = lazy(() => import("@/screens/reminders"));
const AIDraftCompose = lazy(() => import("@/screens/ai-drafts").then((m) => ({ default: m.AIDraftCompose })));
const AIDraftPreview = lazy(() => import("@/screens/ai-drafts").then((m) => ({ default: m.AIDraftPreview })));

// Canonical Clerk wiring; only the env adapter differs (Next exposes NEXT_PUBLIC_*).
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev, auto-set in prod. Not gated on environment.
const clerkProxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || "/" : path;
}

if (!clerkPubKey) {
  throw new Error("Missing Clerk publishable key (VITE_CLERK_PUBLISHABLE_KEY / CLERK_PUBLISHABLE_KEY).");
}

/** The theme type @clerk/react accepts, which @clerk/themes' own type does not match exactly. */
type ClerkTheme = NonNullable<NonNullable<ComponentProps<typeof ClerkProvider>["appearance"]>["theme"]>;
const clerkAppearance = {
  // @clerk/themes types cssLayerName as string | undefined, which @clerk/react's theme type does
  // not accept under exactOptionalPropertyTypes. It is the same object.
  theme: shadcn as ClerkTheme,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(155 42% 21%)",
    colorForeground: "hsl(30 8% 14%)",
    colorMutedForeground: "hsl(30 6% 38%)",
    colorDanger: "hsl(6 58% 40%)",
    colorBackground: "hsl(40 40% 99%)",
    colorInput: "hsl(40 40% 99%)",
    colorInputForeground: "hsl(30 8% 14%)",
    colorNeutral: "hsl(30 8% 14%)",
    fontFamily: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[hsl(40_40%_99%)] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[hsl(36_18%_86%)] shadow-[0_28px_60px_-28px_hsl(30_10%_20%/0.25)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-[hsl(30_8%_14%)] font-['Newsreader'] text-2xl font-medium",
    headerSubtitle: "text-[hsl(30_6%_38%)]",
    socialButtonsBlockButtonText: "text-[hsl(30_8%_14%)] font-medium",
    formFieldLabel: "text-[hsl(30_8%_14%)] font-medium",
    footerActionLink: "text-[hsl(155_42%_21%)] font-semibold",
    footerActionText: "text-[hsl(30_6%_38%)]",
    dividerText: "text-[hsl(30_6%_38%)]",
    identityPreviewEditButton: "text-[hsl(155_42%_21%)]",
    formFieldSuccessText: "text-[hsl(155_42%_21%)]",
    alertText: "text-[hsl(30_8%_14%)]",
    logoBox: "h-12 justify-center",
    logoImage: "h-12 w-12",
    socialButtonsBlockButton: "border border-[hsl(36_16%_80%)] bg-[hsl(40_40%_99%)] rounded-xl",
    formButtonPrimary:
      "bg-[hsl(155_42%_21%)] text-[hsl(40_33%_97%)] rounded-full min-h-11 normal-case text-sm font-medium",
    formFieldInput:
      "border border-[hsl(36_16%_80%)] bg-[hsl(40_40%_99%)] text-[hsl(30_8%_14%)] rounded-xl min-h-11",
    footerAction: "bg-[hsl(40_28%_95%)] py-4 justify-center",
    dividerLine: "bg-[hsl(36_18%_86%)]",
    alert: "border border-[hsl(38_50%_80%)] bg-[hsl(40_60%_93%)] rounded-xl",
    otpCodeFieldInput: "border border-[hsl(36_16%_80%)] text-[hsl(30_8%_14%)]",
    formFieldRow: "gap-2",
    main: "gap-5",
  },
};

function AuthFrame({ children, side }: { children: ReactNode; side: "in" | "up" }) {
  return (
    <div className="grid min-h-[100dvh] min-w-0 w-full bg-background lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div className="[&_a]:text-primary-foreground">
          <Wordmark />
        </div>
        <div className="max-w-md">
          <p className="eyebrow !text-primary-foreground/60">
            {side === "in" ? "Welcome back" : "A private workspace"}
          </p>
          <p className="font-display mt-4 text-4xl leading-tight">
            Your drafts stay yours. The rules stay sourced.
          </p>
          <p className="mt-5 text-primary-foreground/75 leading-relaxed">
            Email sign-in with verification and recovery is handled by our authentication provider. Valo never
            sees your password.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">Development build. Use test details only.</p>
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full border border-primary-foreground/10"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-8 top-24 h-64 w-64 rounded-full border border-primary-foreground/10"
        />
      </aside>
      <div className="valo-auth-panel flex min-w-0 w-full flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="lg:hidden">
          <Wordmark />
        </div>
        {children}
        <p className="w-full max-w-[440px] break-words text-center text-sm text-muted-foreground">
          Cannot sign in, unverified or suspended?{" "}
          <Link
            href="/account-access"
            className="font-medium text-primary underline underline-offset-4"
            data-testid="link-auth-access-help"
          >
            Get account access help
          </Link>
        </p>
      </div>
    </div>
  );
}

function SignInPage() {
  useDocumentTitle("Sign in — Valo");
  return (
    <AuthFrame side="in">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  useDocumentTitle("Open a workspace — Valo");
  return (
    <AuthFrame side="up">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function ClerkAccountState({ children }: { children: ReactNode }) {
  const auth = useAuth(),
    user = useUser();
  const coherent =
    auth.isLoaded && user.isLoaded && (auth.userId ? user.user?.id === auth.userId : user.user === null);
  // Initial SDK loading must not block free public content. Known incoherent
  // account state is different: hide it until both identity views agree.
  const publicOnlyLoading = (!auth.isLoaded || !user.isLoaded) && !auth.userId && !user.user;
  const key = coherent
    ? `${auth.userId ?? "anonymous"}/${auth.sessionId ?? "none"}/${user.user?.primaryEmailAddress?.verification.status ?? "none"}`
    : publicOnlyLoading
      ? "unresolved"
      : null;
  return (
    <AccountStateBoundary
      identityKey={key}
      sessionKey={auth.userId && auth.sessionId ? `${auth.userId}/${auth.sessionId}` : null}
    >
      {children}
    </AccountStateBoundary>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/workspace" />
      </Show>
      <Show when="signed-out">
        <Home />
      </Show>
    </>
  );
}

/** Holds a screen's place while its chunk loads: a full screen tall, so nothing below it moves. */
function ScreenLoading() {
  return <div className="min-h-screen" aria-busy="true" aria-label="Loading" />;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  // A fixed public page takes its title from the same list as its server metadata. Signed-in
  // screens and released items' pages set their own.
  useDocumentTitle(publicPages[location]?.title ?? null);
  return (
    <SiteShell>
      <ErrorBoundary resetKey={location}>
        <Suspense fallback={<ScreenLoading />}>{children}</Suspense>
      </ErrorBoundary>
    </SiteShell>
  );
}

function ShellRoutes() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/library" component={Library} />
        <Route path="/library/:slug">{(p) => <TemplateDetail slug={p.slug} />}</Route>
        <Route path="/compliance" component={Compliance} />
        <Route path="/industries" component={Industries} />
        <Route path="/industries/:slug">{(p) => <IndustryDetail slug={p.slug} />}</Route>
        <Route path="/resources" component={Resources} />
        <Route path="/resources/:slug">{(p) => <ResourceDetail slug={p.slug} />}</Route>
        <Route path="/about" component={About} />
        <Route path="/contact" component={Contact} />
        <Route path="/account-access" component={AccountAccess} />
        <Route path="/services" component={Services} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/help" component={Help} />
        <Route path="/support" component={Support} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/development" component={Development} />
        <Route path="/checker" component={Checker} />
        <Route path="/workspace/assessments">
          {() => (
            <RequireAuth title="Assessment history">
              <AssessmentsList />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/assessments/:id">
          {(p) => (
            <RequireAuth title="Assessment">
              <AssessmentDetail id={p.id} />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/ai">
          {() => (
            <RequireAuth title="Drafting assistant">
              <AIDraftCompose />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/ai/:id">
          {(p) => (
            <RequireAuth title="Draft preview">
              <AIDraftPreview id={p.id} />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/tasks">
          {() => (
            <RequireAuth title="Tasks">
              <TasksPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/reminders">
          {() => (
            <RequireAuth title="Reminders">
              <RemindersPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace">
          {() => (
            <RequireAuth title="Your workspace">
              <WorkspaceHome />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/profile">
          {() => (
            <RequireAuth title="Business profile">
              <ProfilePage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/checker">
          {() => (
            <RequireAuth title="Business requirements checker">
              <Checker />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/notifications">
          {() => (
            <RequireAuth title="Reminders">
              <RemindersPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/purchases">
          {() => (
            <RequireAuth title="Purchases and licences">
              <PurchasesPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/account">
          {() => (
            <RequireAuth title="Sign-in and security">
              <AccountPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/privacy">
          {() => (
            <RequireAuth title="Your data and privacy requests">
              <PrivacyPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/staff/privacy">
          {() => (
            <RequireAuth title="Privacy request operations">
              <PrivacyOperations />
            </RequireAuth>
          )}
        </Route>
        <Route path="/staff">
          {() => (
            <RequireAuth title="Staff operations">
              <StaffPage />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/documents/:id">
          {(p) => (
            <RequireAuth title="Document editor">
              <DocumentEditor id={p.id} />
            </RequireAuth>
          )}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function ClerkProviderWithRoutes({ nonce }: { nonce?: string | undefined }) {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      {...(nonce !== undefined ? { nonce } : {})}
      publishableKey={clerkPubKey}
      {...(clerkProxyUrl !== undefined ? { proxyUrl: clerkProxyUrl } : {})}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Sign in to Valo", subtitle: "Your private business workspace" } },
        signUp: {
          start: { title: "Open your workspace", subtitle: "Verify your email to keep drafts private" },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <ClerkAccountState>
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ShellRoutes} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </ClerkAccountState>
    </ClerkProvider>
  );
}

function App({ nonce }: { nonce?: string | undefined } = {}) {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes nonce={nonce} />
    </WouterRouter>
  );
}

export default App;
