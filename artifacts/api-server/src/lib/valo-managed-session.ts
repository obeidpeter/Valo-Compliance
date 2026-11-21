import { clerkClient, getAuth } from "@clerk/express";
import type { Request } from "express";
import { ValoProblem } from "../platform/valo-problem";

export type ManagedSessionDependencies = {
  auth: (req: Request) => {
    userId: string | null;
    sessionId: string | null;
    sessionClaims?: { fva?: unknown } | null;
    has: (check: { reverification: "strict_mfa" }) => boolean;
  };
  session: (id: string) => Promise<{ status: string; userId: string }>;
  user: (id: string) => Promise<{
    id: string;
    banned: boolean;
    locked: boolean;
    twoFactorEnabled?: boolean;
    primaryEmailAddressId: string | null;
    emailAddresses: { id: string; verification: { status: string } | null }[];
  }>;
};

/** Clerk's strict_mfa deliberately falls back to one factor for unenrolled users.
 * Staff access must not downgrade. Only verified token claims and the live user
 * record can establish both factors; request headers/body are never consulted. */
export function hasRecentBothFactors(ages: unknown): boolean {
  return (
    Array.isArray(ages) &&
    ages.length === 2 &&
    ages.every((age) => Number.isInteger(age) && age >= 0 && age < 10)
  );
}

export function makeVerifiedStaffSession(
  deps: ManagedSessionDependencies = {
    auth: getAuth,
    session: (id) => clerkClient.sessions.getSession(id),
    user: (id) => clerkClient.users.getUser(id),
  },
) {
  return async (req: Request) => {
    const auth = deps.auth(req);
    if (!auth.userId || !auth.sessionId) throw new ValoProblem(401, "Sign in to a verified account.");
    const [session, user] = await Promise.all([deps.session(auth.sessionId), deps.user(auth.userId)]);
    const primary = user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId);
    if (
      session.status !== "active" ||
      session.userId !== auth.userId ||
      user.id !== auth.userId ||
      user.banned ||
      user.locked ||
      primary?.verification?.status !== "verified"
    )
      throw new ValoProblem(403, "An active verified session is required.");
    const mfaEnrolled = user.twoFactorEnabled === true;
    return {
      identityId: user.id,
      mfaEnrolled,
      verifiedAt: Date.now(),
      recentMfa:
        mfaEnrolled &&
        hasRecentBothFactors(auth.sessionClaims?.fva) &&
        auth.has({ reverification: "strict_mfa" }),
    };
  };
}
export const verifiedStaffSession = makeVerifiedStaffSession();
