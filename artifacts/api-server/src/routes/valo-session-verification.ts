import { Router } from "express";
import { reverificationError } from "@clerk/shared/authorization-errors";
import { verifiedStaffSession } from "../lib/valo-managed-session";

/** A read-only provider check. It grants no application role and returns no
 * identity, token or session identifier. Reverification retries only this read. */
export function createSessionVerificationRouter(authenticate = verifiedStaffSession) {
  const router = Router();
  router.get("/session/mfa", async (req, res) => {
    res.set("Cache-Control", "private, no-store, max-age=0");
    res.vary("Cookie");
    res.vary("Authorization");
    const actor = await authenticate(req);
    if (!actor.mfaEnrolled) {
      res.status(403).json({
        code: "MFA_ENROLLMENT_REQUIRED",
        error: "Set up a second factor in Sign-in and security before verifying MFA.",
      });
      return;
    }
    if (!actor.recentMfa) {
      res.status(403).json({
        ...reverificationError("strict_mfa"),
        code: "MFA_REVERIFICATION_REQUIRED",
        error: "Verify both sign-in factors to continue.",
      });
      return;
    }
    res.json({ verified: true, checkedAt: new Date(actor.verifiedAt).toISOString() });
  });
  return router;
}
