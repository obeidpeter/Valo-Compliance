# Phase 2: real MFA and browser/request boundaries

This slice follows merged PR #30 (`1b2627b9e24379e7d3080b056cb32cf7a0142a89`). It fixes a launch-blocking MFA downgrade found while testing a real development sign-in, then addresses the outstanding trusted-proxy and frontend CSP controls. It changes no SQL, queue schema, staff assignment or provider execution switch. Migration 0032 remains the development schema baseline; do not rerun it or the full migrator against the unadopted development ledger.

## MFA acceptance contract

The pinned Clerk authorization helper accepts `strict_mfa` when the first factor is recent but the second factor is absent (`fva: [0, -1]`). This is documented provider behavior, not proof of two factors. A regression test invokes the real pinned helper to reproduce it. Valo now requires all of:

- Clerk-validated session claims with exactly two nonnegative integer factor ages, each less than ten minutes, and the provider's `strict_mfa` check;
- a live active session bound to that same user;
- a live unlocked, unbanned user with a verified primary email and `twoFactorEnabled === true`;
- the existing separate, current application role and its expiry/freshness checks for staff operations.

Missing/malformed/negative/stale ages and removed enrollment cannot establish MFA. Ordinary customer privacy-case access still uses live identity checks without requiring a staff role or MFA.

`GET /api/session/mfa` is a read-only, non-cacheable check returning only a boolean and check time. Unenrolled users receive setup guidance; enrolled users with stale factors receive Clerk's reverification hint. The account/staff interface can open the provider challenge and retry this read. It never replays a role grant, refund or other mutation. Successful verification grants no role. No token, factor seed, verification code, identity ID or recovery code is returned by this endpoint.

The development provider instance initially had authenticator enrollment disabled. Authenticator application and backup-code options were enabled for **development only** during the real-user check. Requiring MFA for every customer was not enabled. The account holder must enroll and enter verification/recovery codes directly in the provider UI. Neither a successful Google sign-in nor a controlled fixture establishes real MFA acceptance.

## Trusted proxy configuration

`VALO_TRUSTED_PROXY_CIDRS` is an optional comma-separated list of exact proxy addresses/CIDRs (maximum 16). The default trusts no forwarding headers. Boolean/hop-count configuration, named subnet shortcuts, malformed addresses and universal `/0` ranges are rejected at startup. Express walks from the socket toward the client and stops at the first untrusted hop. Anonymous quotas, checker preview and access support use that validated address, falling back to the socket for malformed values.

The Clerk proxy discards incoming `Forwarded`, `X-Real-IP` and `X-Forwarded-*` routing headers, then supplies the validated address and the separately configured trusted site origin. Client Host/forwarded headers never select the auth origin. Development-origin fallbacks are disabled when any nonempty `REPLIT_DEPLOYMENT*` marker exists, including the literal value `false`.

Before staging/production, observe every permitted ingress path, obtain the provider's supported proxy address contract and configure only those ranges. Verify requests through every path and a direct/short path if reachable; prove that a forged leftmost address cannot choose a quota bucket or identity-provider IP. Do not use `trust proxy=true`, a hop count or a broad private range to make the check pass. Until topology is proven, the conservative shared-socket anonymous limit remains in effect. No production ingress claim follows from the localhost regression tests.

## Frontend policy and deployment checks

Next middleware generates an unpredictable nonce per HTML response, overwrites any supplied nonce/policy request headers, and forwards it to Next rendering and Clerk's script loader. HTML is private/no-store. The enforced policy limits script execution through nonces and `strict-dynamic`, blocks objects and framing in production, and restricts provider/font/image/connect origins. Inline **styles** remain allowed for the current UI/provider; inline **scripts** and eval are not allowed in production. Development-only eval/WebSocket and Replit-frame allowances cannot activate in a marked deployment. No request Host or forwarded header adds a CSP origin.

The compiled-Next browser proof checks unique nonces, ignored injected policy headers, real application hydration, nonced Next bootstrap/flight scripts, and Chromium rejecting a parser-inserted untrusted script while executing the nonced canary. It uses no provider or database credentials and blocks external requests. It does not establish deployed Clerk/Social OAuth compatibility; that needs the real development check and a separate staging check on the final custom domain/proxy.

Deploy the reviewed code to development while preserving its native preview overrides. No database migration is needed. Rebuild/restart API and frontend, check health, use the real account's **Verify MFA**, and verify a customer still cannot use staff operations after completing MFA. Exercise stale-factor challenge and cancellation without creating role mutations. Keep checkout, refunds, disputes and paid AI disabled. A regression should be fixed forward or held behind denied staff access; reverting to the old one-factor acceptance is not a safe operational rollback.

## Remaining launch gates

After this slice, finish production-capable private object storage and separate durable workers, document retention enforcement, externally delivered alerts with a named responder, and deployed backup/restore with deletion-journal replay. Preserve private-download ownership/revocation and worker restart proofs. Integrate #31/#29 only after they use this shared identity/role boundary and reconcile migration numbering. Content acceptance and the end-to-end customer create/save/export/download journey remain separate evidence requirements. #2 is still the final promotion PR, not an authorization to launch now.

Provider/framework references: [Clerk reverification caveats](https://clerk.com/docs/guides/secure/reverification), [React reverification hook](https://clerk.com/docs/react/reference/hooks/use-reverification), [Clerk CSP](https://clerk.com/docs/guides/secure/best-practices/csp-headers), [Next CSP and dynamic rendering](https://nextjs.org/docs/app/guides/content-security-policy), [Express proxy trust](https://expressjs.com/en/guide/behind-proxies/).
