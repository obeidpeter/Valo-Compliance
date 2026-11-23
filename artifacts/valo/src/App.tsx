import { lazy, Suspense, useState, type ComponentProps, type ReactNode } from "react";
import { ClerkProvider, Show, SignIn, SignUp, useAuth, useUser } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { AccountStateBoundary } from "@/components/account-state-boundary";
import { Link, Redirect, Route, Switch, useLocation, Router as WouterRouter } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SiteShell } from "@/components/site-shell";
import { ServerPage } from "@/components/server-page";
import { RequireAuth } from "@/components/require-auth";
import { Wordmark } from "@/components/brand";
import { basePath } from "@/lib/env";
import { useDocumentTitle } from "@/lib/document-title";
import { publicPages } from "@/lib/public-pages";
import { startPath } from "@/lib/landing-tasks";
import { isServerPage } from "@/lib/server-pages";
import { watchBackAndForward } from "@/lib/use-unsaved-navigation";
import NotFound from "@/screens/not-found";

// Before the router renders, so that a screen with unsaved changes is asked first.
watchBackAndForward();

// Each screen is its own chunk, so a page downloads only the screens it shows, not the whole
// workspace and staff app (NFR-002).
const AccountAccess = lazy(() => import("@/screens/contact").then((m) => ({ default: m.AccountAccess })));
const AccountPage = lazy(() => import("@/screens/account").then((m) => ({ default: m.AccountPage })));
const PrivacyPage = lazy(() => import("@/screens/account").then((m) => ({ default: m.PrivacyPage })));
const PurchasesPage = lazy(() => import("@/screens/account").then((m) => ({ default: m.PurchasesPage })));
const StaffPage = lazy(() => import("@/screens/staff"));
const PrivacyOperations = lazy(() => import("@/screens/privacy-operations"));
const Support = lazy(() => import("@/screens/support"));
const Development = lazy(() => import("@/screens/development"));
const WorkspaceHome = lazy(() => import("@/screens/workspace"));
const DocumentsPage = lazy(() => import("@/screens/documents"));
const NewDocumentPage = lazy(() => import("@/screens/new-document"));
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
      "bg-[hsl(40_40%_99%)] rounded-2xl max-w-full border border-[hsl(36_18%_86%)] shadow-[0_28px_60px_-28px_hsl(30_10%_20%/0.25)]",
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
            Signing in, confirming your email address and recovering your account are handled by our sign-in
            provider. Valo never sees your password.
          </p>
        </div>
        <p className="text-xs text-primary-foreground/60">Development build. Use made-up details only.</p>
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
          Cannot sign in, or is your account unverified or suspended? See{" "}
          <Link
            href="/account-access"
            className="font-medium text-primary underline underline-offset-4"
            data-testid="link-auth-access-help"
          >
            Trouble signing in
          </Link>
          .
        </p>
      </div>
    </div>
  );
}

/**
 * What the visitor chose before signing in or up (`?start=` on the address), kept for as long as
 * the page is open: the identity provider moves through steps of its own, which drop it from the
 * address. `after` is where the visitor then starts, handed to the provider; `carry` passes the
 * choice between the sign-in and the sign-up page. Both are empty for a choice the site does not
 * offer, so the provider is never handed an address that came from outside.
 */
function useChosenStart() {
  const [start] = useState(() => new URLSearchParams(window.location.search).get("start"));
  const path = startPath(start);
  return path && start
    ? {
        path,
        after: { forceRedirectUrl: basePath + path },
        carry: "?start=" + encodeURIComponent(start),
      }
    : { path: "/workspace", after: {}, carry: "" };
}

/**
 * A visitor who is already signed in has no use for a sign-in or sign-up form. They go on to where
 * the form would have sent them: the page for what they chose, or their workspace. A link that
 * leads through sign-up, such as "Create a document" on a public page, so works for them too.
 */
function PastTheForm({ to }: { to: string }) {
  return (
    <Show when="signed-in">
      <Redirect to={to} />
    </Show>
  );
}

function SignInPage() {
  useDocumentTitle("Sign in — Valo");
  const { path, after, carry } = useChosenStart();
  return (
    <>
      <PastTheForm to={path} />
      <AuthFrame side="in">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up${carry}`}
          {...after}
        />
      </AuthFrame>
    </>
  );
}

function SignUpPage() {
  useDocumentTitle("Create account — Valo");
  const { path, after, carry } = useChosenStart();
  return (
    <>
      <PastTheForm to={path} />
      <AuthFrame side="up">
        <SignUp
          routing="path"
          path={`${basePath}/sign-up`}
          signInUrl={`${basePath}/sign-in${carry}`}
          {...after}
        />
      </AuthFrame>
    </>
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
  const [location] = useLocation();
  // The pages the server renders (decision 0011) are handed to it, from the one list in
  // lib/server-pages.ts; the browser app keeps routes only for its own pages.
  if (isServerPage(location))
    return (
      <Shell>
        <ServerPage />
      </Shell>
    );
  return (
    <Shell>
      <Switch>
        <Route path="/account-access" component={AccountAccess} />
        <Route path="/support" component={Support} />
        <Route path="/development" component={Development} />
        <Route path="/checker" component={Checker} />
        <Route path="/workspace/assessments">
          {() => (
            <RequireAuth title="Saved results">
              <AssessmentsList />
            </RequireAuth>
          )}
        </Route>
        <Route path="/workspace/assessments/:id">
          {(p) => (
            <RequireAuth title="Saved result">
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
        <Route path="/workspace/documents">
          {() => (
            <RequireAuth title="Your documents">
              <DocumentsPage />
            </RequireAuth>
          )}
        </Route>
        {/* Before the editor's route below, which would take "new" for a document's id. */}
        <Route path="/workspace/documents/new">
          {() => (
            <RequireAuth title="New document">
              <NewDocumentPage />
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
            <RequireAuth title="Check your requirements">
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
          start: { title: "Create your account", subtitle: "You will be asked to verify your email" },
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
