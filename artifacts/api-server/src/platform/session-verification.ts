/**
 * Session verification for private customer requests (decision 0003).
 *
 * Clerk's middleware verifies the session token itself (signature, expiry and
 * authorised party) on every request. On top of that this module checks the
 * provider's live state: the session is still active, the account is neither
 * banned nor locked, and the primary email is verified.
 *
 * - Routes on the CACHED_ROUTES list below (everyday document, task and profile
 *   work) reuse a passing result for at most one minute per session.
 * - Every other route checks live on every request: payments, file downloads,
 *   privacy, the account page, AI drafts, and any route added later until it is
 *   deliberately listed. A missing entry costs speed, never safety.
 *
 * Only passing results are cached, so an account that has just verified its email
 * is not kept waiting. A refusal on any route removes the cached result, so the
 * next everyday request checks live again. A provider failure leaves the cache
 * unchanged and fails the request.
 */

export type ProviderSession = { status: string; userId: string };
export type ProviderUser = {
  id: string;
  banned: boolean;
  locked: boolean;
  primaryEmailAddressId: string | null;
  emailAddresses: { id: string; emailAddress: string; verification: { status: string } | null }[];
};
export type VerifiedAccount = { identityId: string; contactEmail: string };
export type SessionCheck =
  | { ok: true; account: VerifiedAccount; source: "live" | "cache" }
  | { ok: false; status: 401 | 403; error: string };

export const SESSION_CACHE_TTL_MS = 60_000;

const CACHED_ROUTES = [
  /^\/workspace\/?$/,
  /^\/workspace\/profile\/?$/,
  /^\/workspace\/documents(\/[^/]+(\/revisions)?)?\/?$/,
  /^\/workspace\/templates\/[^/]+\/draft\/?$/,
  /^\/workspace\/saved-templates(\/by-template)?(\/[^/]+)?\/?$/,
  /^\/workspace\/checker\/preview\/?$/,
  /^\/workspace\/assessments(\/[^/]+(\/compare\/[^/]+)?)?\/?$/,
  /^\/workspace\/tasks(\/[^/]+)?\/?$/,
  /^\/workspace\/reminder-preferences\/?$/,
  /^\/workspace\/reminders\/?$/,
  /^\/workspace\/support\/?$/,
  /^\/workspace\/ai-usage\/?$/,
  /^\/v1\/documents\/[^/]+\/exports\/?$/,
  /^\/v1\/exports\/[^/]+\/retry\/?$/,
].map((route) => new RegExp(route.source, "i")); // Express matches routes case-insensitively.

/** Whether a request path (Express `req.baseUrl + req.path`) may use a cached check. */
export function routeUsesCachedCheck(path: string): boolean {
  const normalised = path.replace(/\/{2,}/g, "/").replace(/^\/api(?=\/|$)/i, "");
  return CACHED_ROUTES.some((route) => route.test(normalised));
}

type Refusal = Extract<SessionCheck, { ok: false }>;

function evaluate(
  identity: { userId: string },
  session: ProviderSession,
  user: ProviderUser,
): Refusal | { ok: true; account: VerifiedAccount } {
  if (session.status !== "active" || session.userId !== identity.userId || user.id !== identity.userId)
    return { ok: false, status: 401, error: "Session is no longer active. Sign in again." };
  if (user.banned || user.locked) return { ok: false, status: 403, error: "Account is suspended or locked" };
  const primary = user.emailAddresses.find((email) => email.id === user.primaryEmailAddressId);
  if (primary?.verification?.status !== "verified")
    return {
      ok: false,
      status: 403,
      error: "Verify your primary email address before saving business data",
    };
  return { ok: true, account: { identityId: user.id, contactEmail: primary.emailAddress } };
}

export function makeSessionVerifier(deps: {
  session: (sessionId: string) => Promise<ProviderSession>;
  user: (userId: string) => Promise<ProviderUser>;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}) {
  const now = deps.now ?? Date.now;
  const ttlMs = deps.ttlMs ?? SESSION_CACHE_TTL_MS;
  const maxEntries = deps.maxEntries ?? 10_000;
  const passed = new Map<string, { account: VerifiedAccount; expiresAt: number }>();
  const inFlight = new Map<string, Promise<SessionCheck>>();

  async function checkLive(identity: { userId: string; sessionId: string }, key: string) {
    const [session, user] = await Promise.all([deps.session(identity.sessionId), deps.user(identity.userId)]);
    const result = evaluate(identity, session, user);
    passed.delete(key);
    if (!result.ok) return result;
    if (passed.size >= maxEntries) passed.delete(passed.keys().next().value!);
    passed.set(key, { account: result.account, expiresAt: now() + ttlMs });
    return { ...result, source: "live" as const };
  }

  return {
    async verify(
      identity: { userId: string; sessionId: string },
      mode: "cached" | "live",
    ): Promise<SessionCheck> {
      const key = `${identity.userId}\u0000${identity.sessionId}`;
      if (mode === "cached") {
        const hit = passed.get(key);
        if (hit && hit.expiresAt > now()) return { ok: true, account: hit.account, source: "cache" };
        // Parallel requests from one page share a single provider check.
        const pending = inFlight.get(key);
        if (pending) return pending;
      }
      const check = checkLive(identity, key);
      inFlight.set(key, check);
      try {
        return await check;
      } finally {
        if (inFlight.get(key) === check) inFlight.delete(key);
      }
    },
    cachedSessions: () => passed.size,
  };
}
