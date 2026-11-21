import { AsyncResource } from "node:async_hooks";
import type { RequestHandler } from "express";
import {
  recordSecuritySignal,
  schedulePurgeExpiredSecuritySignals,
  securitySubjectHash,
  type SecuritySignalKind,
} from "../lib/valo-security-signals";
import { clientAddress } from "../lib/valo-proxy-boundary";
import { setting } from "../platform/settings";

declare global {
  namespace Express {
    interface Locals {
      /** Set by a route whose refusal is a more specific security event than denied access. */
      valoSecuritySignal?: SecuritySignalKind;
    }
  }
}

type Options = {
  record?: (kind: SecuritySignalKind, subjectHash: string) => Promise<void>;
  subject?: (req: Parameters<RequestHandler>[0]) => string | null;
};

const addressSubject: NonNullable<Options["subject"]> = (req) => {
  const address = clientAddress(req);
  return address ? securitySubjectHash(setting("SESSION_SECRET"), "ip", address) : null;
};

/**
 * SEC-008: counts every refused request (401 or 403) as denied access, or as the more specific event
 * its route names, by the caller's pseudonymous address, after the response has been sent. The
 * listener is bound here, before any workspace scope begins, so the count is written on the
 * application's own connection even when the response ends inside a customer's scope. A failure
 * to count is logged and never changes a response.
 */
export function securitySignals(options: Options = {}): RequestHandler {
  const record = options.record ?? recordSecuritySignal;
  const subject = options.subject ?? addressSubject;
  return (req, res, next) => {
    const finished = AsyncResource.bind(() => {
      const kind =
        res.locals.valoSecuritySignal ??
        (res.statusCode === 401 || res.statusCode === 403 ? "denied_access" : undefined);
      if (!kind) return;
      let hash: string | null;
      try {
        hash = subject(req);
      } catch {
        req.log?.warn({ event: "security_signal.unavailable", kind });
        return;
      }
      if (!hash) return;
      schedulePurgeExpiredSecuritySignals();
      void record(kind, hash).catch((error: unknown) =>
        req.log?.warn({
          event: "security_signal.failed",
          kind,
          errorType: error instanceof Error ? error.name : "unknown",
        }),
      );
    });
    res.once("finish", finished);
    next();
  };
}
