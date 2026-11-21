import type { RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, valoStaffAssignments } from "@workspace/db";
import { verifiedStaffSession } from "../lib/valo-managed-session";
import { activeStaffAssignment } from "../modules/staff";
import { ValoProblem } from "../platform/valo-problem";

/**
 * Every staff route first requires a verified session that holds at least one active
 * staff assignment, before any staff input is read. A customer therefore learns nothing
 * about a staff operation's input rules. Each operation still checks its own role,
 * assignment currency and recent MFA, exactly as before.
 */
export function makeStaffGate(authenticate = verifiedStaffSession): RequestHandler {
  return async (req, _res, next) => {
    try {
      const actor = await authenticate(req);
      const [assignment] = await db
        .select({ id: valoStaffAssignments.id })
        .from(valoStaffAssignments)
        .where(and(eq(valoStaffAssignments.identityId, actor.identityId), activeStaffAssignment()))
        .limit(1);
      if (!assignment)
        throw new ValoProblem(
          403,
          "Staff permission is required. Customer sign-in does not grant staff access.",
        );
      next();
    } catch (error) {
      next(error);
    }
  };
}
