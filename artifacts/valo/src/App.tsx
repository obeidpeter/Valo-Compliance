import { useEffect, useRef, type ReactNode } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteShell } from '@/components/site-shell';
import { RequireAuth } from '@/components/require-auth';
import { Wordmark } from '@/components/brand';
import { basePath } from '@/lib/env';
import NotFound from '@/screens/not-found';
import Home from '@/screens/home';
import Library from '@/screens/library';
import Compliance from '@/screens/compliance';
import Industries from '@/screens/industries';
import Resources from '@/screens/resources';
import Services from '@/screens/services';
import Pricing from '@/screens/pricing';
import Help from '@/screens/help';
import Support from '@/screens/support';
import Privacy from '@/screens/privacy';
import Terms from '@/screens/terms';
import Development from '@/screens/development';
import WorkspaceHome from '@/screens/workspace';
import ProfilePage from '@/screens/profile';
import DocumentEditor from '@/screens/document-editor';
import Checker from '@/screens/checker';
import { AssessmentsList, AssessmentDetail } from '@/screens/assessments';
import TasksPage from '@/screens/tasks';
import RemindersPage from '@/screens/reminders';
import { AIDraftCompose, AIDraftPreview } from '@/screens/ai-drafts';

// Canonical Clerk wiring; only the env adapter differs (Next exposes NEXT_PUBLIC_*).
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
);

// Empty in dev, auto-set in prod. Not gated on environment.
const clerkProxyUrl = process.env.NEXT_PUBLIC_CLERK_PROXY_URL;

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

if (!clerkPubKey) {
  throw new Error('Missing Clerk publishable key (VITE_CLERK_PUBLISHABLE_KEY / CLERK_PUBLISHABLE_KEY).');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (count, err) => {
        const s = (err as { status?: number })?.status;
        if (s && s >= 400 && s < 500) return false;
        return count < 2;
      },
    },
  },
});

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: 'hsl(155 42% 21%)',
    colorForeground: 'hsl(30 8% 14%)',
    colorMutedForeground: 'hsl(30 6% 38%)',
    colorDanger: 'hsl(6 58% 40%)',
    colorBackground: 'hsl(40 40% 99%)',
    colorInput: 'hsl(40 40% 99%)',
    colorInputForeground: 'hsl(30 8% 14%)',
    colorNeutral: 'hsl(30 8% 14%)',
    fontFamily: "'Instrument Sans', ui-sans-serif, system-ui, sans-serif",
    borderRadius: '0.75rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'bg-[hsl(40_40%_99%)] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[hsl(36_18%_86%)] shadow-[0_28px_60px_-28px_hsl(30_10%_20%/0.25)]',
    card: '!shadow-none !border-0 !bg-transparent !rounded-none',
    footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
    headerTitle: "text-[hsl(30_8%_14%)] font-['Newsreader'] text-2xl font-medium",
    headerSubtitle: 'text-[hsl(30_6%_38%)]',
    socialButtonsBlockButtonText: 'text-[hsl(30_8%_14%)] font-medium',
    formFieldLabel: 'text-[hsl(30_8%_14%)] font-medium',
    footerActionLink: 'text-[hsl(155_42%_21%)] font-semibold',
    footerActionText: 'text-[hsl(30_6%_38%)]',
    dividerText: 'text-[hsl(30_6%_38%)]',
    identityPreviewEditButton: 'text-[hsl(155_42%_21%)]',
    formFieldSuccessText: 'text-[hsl(155_42%_21%)]',
    alertText: 'text-[hsl(30_8%_14%)]',
    logoBox: 'h-12 justify-center',
    logoImage: 'h-12 w-12',
    socialButtonsBlockButton: 'border border-[hsl(36_16%_80%)] bg-[hsl(40_40%_99%)] rounded-xl',
    formButtonPrimary: 'bg-[hsl(155_42%_21%)] text-[hsl(40_33%_97%)] rounded-full min-h-11 normal-case text-sm font-medium',
    formFieldInput: 'border border-[hsl(36_16%_80%)] bg-[hsl(40_40%_99%)] text-[hsl(30_8%_14%)] rounded-xl min-h-11',
    footerAction: 'bg-[hsl(40_28%_95%)] py-4 justify-center',
    dividerLine: 'bg-[hsl(36_18%_86%)]',
    alert: 'border border-[hsl(38_50%_80%)] bg-[hsl(40_60%_93%)] rounded-xl',
    otpCodeFieldInput: 'border border-[hsl(36_16%_80%)] text-[hsl(30_8%_14%)]',
    formFieldRow: 'gap-2',
    main: 'gap-5',
  },
};

function AuthFrame({ children, side }: { children: ReactNode; side: 'in' | 'up' }) {
  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[1fr_1.1fr]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div className="[&_a]:text-primary-foreground"><Wordmark /></div>
        <div className="max-w-md">
          <p className="eyebrow !text-primary-foreground/60">{side === 'in' ? 'Welcome back' : 'A private workspace'}</p>
          <p className="font-display mt-4 text-4xl leading-tight">Your drafts stay yours. The rules stay sourced.</p>
          <p className="mt-5 text-primary-foreground/75 leading-relaxed">Email sign-in with verification and recovery is handled by our authentication provider. Valo never sees your password.</p>
        </div>
        <p className="text-xs text-primary-foreground/60">Development build. Use test details only.</p>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full border border-primary-foreground/10" />
        <div aria-hidden className="pointer-events-none absolute -right-8 top-24 h-64 w-64 rounded-full border border-primary-foreground/10" />
      </aside>
      <div className="flex flex-col items-center justify-center gap-6 px-4 py-12">
        <div className="lg:hidden"><Wordmark /></div>
        {children}
      </div>
    </div>
  );
}

function SignInPage() {
  return (
    <AuthFrame side="in">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </AuthFrame>
  );
}

function SignUpPage() {
  return (
    <AuthFrame side="up">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </AuthFrame>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (prevUserIdRef.current !== undefined && prevUserIdRef.current !== userId) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  return null;
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in"><Redirect to="/workspace" /></Show>
      <Show when="signed-out"><Home /></Show>
    </>
  );
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <SiteShell>
      <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>
    </SiteShell>
  );
}

function ShellRoutes() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/library" component={Library} />
        <Route path="/compliance" component={Compliance} />
        <Route path="/industries" component={Industries} />
        <Route path="/resources" component={Resources} />
        <Route path="/services" component={Services} />
        <Route path="/pricing" component={Pricing} />
        <Route path="/help" component={Help} />
        <Route path="/support" component={Support} />
        <Route path="/privacy" component={Privacy} />
        <Route path="/terms" component={Terms} />
        <Route path="/development" component={Development} />
        <Route path="/checker" component={Checker} />
        <Route path="/workspace/assessments">{() => <RequireAuth><AssessmentsList /></RequireAuth>}</Route>
        <Route path="/workspace/assessments/:id">{(p) => <RequireAuth><AssessmentDetail id={p.id} /></RequireAuth>}</Route>
        <Route path="/workspace/ai">{() => <RequireAuth><AIDraftCompose /></RequireAuth>}</Route>
        <Route path="/workspace/ai/:id">{(p) => <RequireAuth><AIDraftPreview id={p.id} /></RequireAuth>}</Route>
        <Route path="/workspace/tasks">{() => <RequireAuth><TasksPage /></RequireAuth>}</Route>
        <Route path="/workspace/reminders">{() => <RequireAuth><RemindersPage /></RequireAuth>}</Route>
        <Route path="/workspace">{() => <RequireAuth><WorkspaceHome /></RequireAuth>}</Route>
        <Route path="/workspace/profile">{() => <RequireAuth><ProfilePage /></RequireAuth>}</Route>
        <Route path="/workspace/documents/:id">{(p) => <RequireAuth><DocumentEditor id={p.id} /></RequireAuth>}</Route>
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: 'Sign in to Valo', subtitle: 'Your private business workspace' } },
        signUp: { start: { title: 'Open your workspace', subtitle: 'Verify your email to keep drafts private' } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TooltipProvider>
          <Switch>
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            <Route component={ShellRoutes} />
          </Switch>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
