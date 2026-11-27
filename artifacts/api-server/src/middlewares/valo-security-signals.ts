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
import { pageRenderVisitor } from "./valo-quota";

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

/**
 * The caller's address, as the read limit takes it: for a page the web server renders on this machine,
 * the visitor's address it passes on, so that one visitor's refusals are never counted as every
 * visitor's (`pageRenderVisitor`); otherwise the address the request came from.
 */
const addressSubject: NonNullable<Options["subject"]> = (req) => {
  const address = pageRenderVisitor(req) ?? clientAddress(req);
  return address ? securitySubjectHash(setting("SESSION_SECRET"), "ip", address) : null;
};

/**
 * The answers that refuse a request's input: a body that is not JSON (400), too large or too complex
 * (413), compressed (415), or details that are not accepted (422).
 */
const REFUSED_INPUT = new Set([400, 413, 415, 422]);

/** The event a finished answer is, by its status, where it is one. */
function signalOf(status: number): SecuritySignalKind | undefined {
  if (status === 401 || status === 403) return "denied_access";
  if (status === 429) return "limit_refusal";
  return REFUSED_INPUT.has(status) ? "refused_input" : undefined;
}

/**
 * SEC-008: counts every refused request after the response has been sent, by the caller's pseudonymous
 * address: a refusal of access (401 or 403) as denied access, a refusal by a limit (429) as one of its own
 * (SEC-005), and an answer refusing the request's input as refused input; or as the more specific event
 * its route names. The listener is bound here, before any workspace scope begins, so the count is written
 * on the application's own connection even when the response ends inside a customer's scope. A failure
 * to count is logged and never changes a response.
 */
export function securitySignals(options: Options = {}): RequestHandler {
  const record = options.record ?? recordSecuritySignal;
  const subject = options.subject ?? addressSubject;
  return (req, res, next) => {
    const finished = AsyncResource.bind(() => {
      const kind = res.locals.valoSecuritySignal ?? signalOf(res.statusCode);
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
